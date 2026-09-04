import { existsSync } from "fs";
import * as path from "path";

/**
 * The dictionary databases are build artifacts (`yarn build:db`, `yarn
 * build:extended`) or are downloaded on first run — they are far too large to
 * commit, so a fresh checkout and CI do not have them.
 *
 * Tests that query them are real integration tests and worth keeping, so they
 * gate on these flags with `describe.skipIf(...)` rather than throwing. Skipped
 * is honest: the check did not run. Failing would say the code is broken.
 */
export const DICT_DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary.db");
export const EXT_DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary-extended.db");

export const hasDictDb = existsSync(DICT_DB_PATH);
export const hasExtDb = existsSync(EXT_DB_PATH);
export const hasBothDbs = hasDictDb && hasExtDb;
