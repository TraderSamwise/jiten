#!/usr/bin/env node

// An OTA ships JS only. If a native module's JS has moved since the build it is
// landing on, the JS talks to native code that isn't there — which surfaces as
// unexplained native crashes rather than anything traceable to the update.
//
// The check that matters is therefore against the NATIVE BUILD, not against
// Expo's recommended versions: a project can legitimately sit on a version the
// SDK doesn't bless, and pinning "back" to the blessed one is what breaks it.
//
// Builds are made by EAS from the committed tree (`.easignore` excludes /ios and
// /android, so EAS prebuilds), so the versions compiled into build N are the ones
// in yarn.lock at the commit that set `buildNumber: N`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const appRoot = path.join(__dirname, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(lines) {
  console.error("OTA native dependency check FAILED\n");
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: appRoot, encoding: "utf8" }).trim();
}

/** Every version yarn.lock resolves for a package (a package can appear twice). */
function lockVersions(lockfile) {
  const versions = new Map();
  const blocks = lockfile.split(/\n(?=\S)/);
  for (const block of blocks) {
    const header = block.split("\n")[0];
    const version = block.match(/\n {2}version "([^"]+)"/);
    if (!version) continue;
    for (const spec of header.split(",")) {
      const name = spec
        .trim()
        .replace(/^"/, "")
        .replace(/@[^@]*:?$/, "");
      if (!name) continue;
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(version[1]);
    }
  }
  return versions;
}

/** A dependency shipping a podspec or an Expo module config contains native code. */
function isNativePackage(name) {
  const dir = path.join(appRoot, "node_modules", name);
  if (!fs.existsSync(dir)) return false;
  if (fs.existsSync(path.join(dir, "expo-module.config.json"))) return true;
  try {
    return fs.readdirSync(dir).some((entry) => entry.endsWith(".podspec"));
  } catch {
    return false;
  }
}

const buildNumber = Number(
  fs.readFileSync(path.join(appRoot, "lib/version.ts"), "utf8").match(/buildNumber:\s*(\d+)/)?.[1],
);
if (!Number.isFinite(buildNumber)) fail(["Could not read buildNumber from lib/version.ts"]);

// -S lists every commit where the string's count changed, newest first: the one
// that set this build number is the oldest of them.
let releaseCommit;
try {
  const commits = git([
    "log",
    "-S",
    `buildNumber: ${buildNumber},`,
    "--format=%H",
    "--",
    "lib/version.ts",
  ])
    .split("\n")
    .filter(Boolean);
  releaseCommit = commits[commits.length - 1];
} catch {
  /* handled below */
}

if (!releaseCommit) {
  fail([
    `No commit sets \`buildNumber: ${buildNumber}\` in lib/version.ts.`,
    "An OTA can only be verified against a build that was cut from a commit.",
    "Cut the native build first, or correct lib/version.ts.",
  ]);
}

const buildLock = lockVersions(git(["show", `${releaseCommit}:yarn.lock`]));
const packageJson = readJson(path.join(appRoot, "package.json"));
const drift = [];

for (const name of Object.keys(packageJson.dependencies ?? {})) {
  if (!isNativePackage(name)) continue;

  const installedPath = path.join(appRoot, "node_modules", name, "package.json");
  if (!fs.existsSync(installedPath)) continue;
  const installed = readJson(installedPath).version;

  const inBuild = buildLock.get(name);
  if (!inBuild) {
    drift.push(
      `${name}: not present in build ${buildNumber} — it has no native code on the device`,
    );
    continue;
  }
  if (!inBuild.has(installed)) {
    drift.push(
      `${name}: build ${buildNumber} has ${[...inBuild].join(", ")}, about to ship ${installed}`,
    );
  }
}

if (drift.length) {
  fail([
    `JS about to be shipped does not match the native code in build ${buildNumber}`,
    `(build commit ${releaseCommit.slice(0, 8)}):`,
    "",
    ...drift,
    "",
    "An OTA cannot carry native code. Either restore these to the build's versions,",
    "or cut a new native build so the two sides match.",
  ]);
}

console.log(
  `OTA native dependency check passed — native modules match build ${buildNumber} (${releaseCommit.slice(0, 8)})`,
);
