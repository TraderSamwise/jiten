# @tradersamwise/japanese-reader

Reusable Jiten-compatible Japanese ebook reader controller.

This package contains the high-level reader session logic extracted from Jiten:

- `useJapaneseReader`
- tap, selection, auto word/name lookup orchestration
- furigana and bookmark-highlight transform ordering
- reader slice caching and reload behavior
- `ReaderView` host component for React Native WebView and web iframe

It is intentionally Jiten-compatible, not schema-agnostic. Full lookup and
furigana features expect dictionary and extended databases with the Jiten reader
schema, provided through the `ReaderSqlDb` adapter contract.

The package does not include dictionary databases, book content, user data,
navigation chrome, settings UI, dictionary popup UI, sync, auth, or backend
services.

This package targets React Native and React Native Web applications. The headless
controller imports React and React Native primitives, and consumers are expected
to provide a compatible React Native / React Native Web runtime.

## Platform Host

Import `ReaderView` from `@tradersamwise/japanese-reader/reader-view`.

- React Native resolves the `react-native` export to `react-native-webview`.
- Web resolves the default export to a sandboxed iframe host with the same bridge.

## Data Contract

The reader accepts SQL-shaped adapters:

```ts
interface ReaderSqlDb {
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync?(sql: string, params?: unknown[]): Promise<unknown>;
}
```

That shape preserves Jiten's batching and query behavior. It is not a promise that
arbitrary dictionary schemas will work.

License: AGPL-3.0-only. See `LICENSE` and `NOTICE.md`.
