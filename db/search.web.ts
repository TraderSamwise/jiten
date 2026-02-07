import type { DictEntry } from "./types";

export async function searchDictionary(
  _db: any,
  _query: string,
  _limit?: number
): Promise<DictEntry[]> {
  console.log("[Search] Web mode — search not available");
  return [];
}

export async function getEntry(
  _db: any,
  _entryId: number
): Promise<DictEntry | null> {
  console.log("[Search] Web mode — getEntry not available");
  return null;
}
