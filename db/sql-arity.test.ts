/**
 * Every literal SQL call must bind as many values as it has placeholders.
 *
 * op-sqlite does not check the count: a short args array binds NULL for the
 * missing tail, so `SET a = ?, b = ?` with one value writes the timestamp into
 * `a` and NULL into the WHERE id — zero rows, no error, and the store still
 * mutates so the UI looks saved. That shipped once in the flashcard settings
 * modal, which is why this gate counts them instead of a reviewer.
 *
 * What it cannot see, so that nobody reads a pass as more than it is: args
 * assembled in a variable rather than written inline, and arrays carrying a
 * spread — which is every scoped query in the study screen, `[...scope.args,
 * x]`, because the spread's length is not knowable here. Interpolated SQL is
 * skipped too, since a fragment helper may bring placeholders of its own.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const QUERY_METHODS = new Set(["runAsync", "getAllAsync", "getFirstAsync", "execAsync"]);

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

function sourceFiles(): string[] {
  return execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "app", "components", "db", "lib", "stores", "hooks"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
}

/** `?` placeholders in a SQL string, ignoring any inside a quoted literal. */
/** Drop `--` and block comments, so a `don't` in one cannot open quote state. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function countPlaceholders(raw: string): number {
  const sql = stripComments(raw);
  let count = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "?") count++;
  }
  return count;
}

type Mismatch = { file: string; line: number; sql: number; args: number };

function mismatchesIn(file: string): Mismatch[] {
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Mismatch[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [sqlArg, argsArg] = node.arguments;
      if (
        QUERY_METHODS.has(method) &&
        sqlArg &&
        argsArg &&
        ts.isArrayLiteralExpression(argsArg) &&
        !argsArg.elements.some((e) => ts.isSpreadElement(e))
      ) {
        // Only a literal SQL string can be counted; an interpolated one may
        // carry placeholders from a fragment helper.
        const sql = ts.isStringLiteralLike(sqlArg)
          ? sqlArg.text
          : ts.isNoSubstitutionTemplateLiteral(sqlArg)
            ? sqlArg.text
            : null;
        if (sql != null) {
          const placeholders = countPlaceholders(sql);
          if (placeholders !== argsArg.elements.length) {
            found.push({
              file,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              sql: placeholders,
              args: argsArg.elements.length,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("SQL placeholder arity", () => {
  it("binds one value per placeholder in every literal query", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const mismatches = files.flatMap(mismatchesIn);
    expect(
      mismatches.map((m) => `${m.file}:${m.line} ${m.sql} placeholders, ${m.args} args`),
    ).toEqual([]);
  });

  it("counts placeholders outside quoted literals and comments only", () => {
    expect(countPlaceholders("SET a = ?, b = ? WHERE id = ?")).toBe(3);
    expect(countPlaceholders("SET note = 'what? why?' WHERE id = ?")).toBe(1);
    expect(countPlaceholders("-- don't ask why?\nSET a = ?")).toBe(1);
    expect(countPlaceholders("/* why? */ SET a = ?")).toBe(1);
  });
});
