export interface ReaderSqlDb {
  getAllAsync<T = unknown>(sql: string, params?: any): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: any): Promise<T | null>;
  runAsync?(sql: string, params?: any): Promise<unknown>;
}

export interface ReaderBookSource {
  loadBook(bookId: string): Promise<import("./types").ReaderBookRecord | null>;
  saveProgress(input: {
    bookId: string;
    scrollPosition: number;
    charOffset: number;
    totalChars?: number;
  }): Promise<void>;
  savePreferences?(input: { bookId: string; fontSize?: number }): Promise<void>;
  markOpened?(bookId: string): Promise<void>;
}

export interface JapaneseReaderBackend {
  dictDb: ReaderSqlDb;
  extendedDb?: ReaderSqlDb | null;
  bookmarks?: import("./types").ReaderBookmarkMembership;
}
