#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const appRoot = path.join(__dirname, "..");
const packageJsonPath = path.join(appRoot, "package.json");

const nativeDeps = [
  {
    packageName: "react-native-svg",
    podName: "RNSVG",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findUp(relativePath) {
  let current = appRoot;
  for (;;) {
    const candidate = path.join(current, relativePath);
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) return null;
    current = next;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lockVersionsFor(lockfile, packageName) {
  const packagePattern = escapeRegExp(packageName);
  const blockPattern = new RegExp(`(^|\\n)${packagePattern}@[^\\n]*:\\n(?:  .+\\n)+`, "g");
  const versions = new Set();
  let match;
  while ((match = blockPattern.exec(lockfile))) {
    const versionMatch = match[0].match(/\n  version "([^"]+)"/);
    if (versionMatch) versions.add(versionMatch[1]);
  }
  return [...versions].sort();
}

function fail(errors) {
  console.error("OTA native dependency check failed");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const packageJson = readJson(packageJsonPath);
const bundledNativeModulesPath = findUp("node_modules/expo/bundledNativeModules.json");
const yarnLockPath = findUp("yarn.lock");
const podfileLockPath = findUp("ios/Podfile.lock");
const errors = [];

if (!bundledNativeModulesPath) errors.push("Missing node_modules/expo/bundledNativeModules.json");
if (!yarnLockPath) errors.push("Missing yarn.lock");
if (errors.length) fail(errors);

const bundledNativeModules = readJson(bundledNativeModulesPath);
const yarnLock = fs.readFileSync(yarnLockPath, "utf8");
const podfileLock = podfileLockPath ? fs.readFileSync(podfileLockPath, "utf8") : "";

for (const dep of nativeDeps) {
  const expected = bundledNativeModules[dep.packageName];
  const declared = packageJson.dependencies?.[dep.packageName];

  if (!expected) {
    errors.push(`${dep.packageName} is missing from Expo bundledNativeModules.json`);
    continue;
  }

  if (declared !== expected) {
    errors.push(
      `${dep.packageName} must be pinned to ${expected} for OTA; package.json declares ${declared ?? "missing"}`,
    );
  }

  const lockVersions = lockVersionsFor(yarnLock, dep.packageName);
  if (!lockVersions.includes(expected)) {
    errors.push(`${dep.packageName}@${expected} is missing from yarn.lock`);
  }
  for (const version of lockVersions.filter((version) => version !== expected)) {
    errors.push(`${dep.packageName}@${version} is still present in yarn.lock`);
  }

  const installedPackageJsonPath = findUp(`node_modules/${dep.packageName}/package.json`);
  if (installedPackageJsonPath) {
    const installed = readJson(installedPackageJsonPath).version;
    if (installed !== expected) {
      errors.push(`${dep.packageName} installed version is ${installed}; expected ${expected}`);
    }
  }

  if (podfileLock && !podfileLock.includes(`- ${dep.podName} (${expected})`)) {
    errors.push(`${dep.podName} pod is not locked to ${expected} in ${podfileLockPath}`);
  }
}

if (errors.length) fail(errors);

console.log("OTA native dependency check passed");
