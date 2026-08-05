# @tradersamwise/japanese-reader-core

Japanese reader helpers shared by the Jiten app and standalone Jiten-compatible
reader integrations.

This package owns reader construction logic that does not require Expo Router,
app stores, sync, auth, or concrete SQLite modules:

- Aozora and plain-text parsing
- Reader HTML generation
- Visible text counting and content slicing
- Reader progress flush policy
- Selection toolbar positioning
- Kanji reading-pattern classification

`generateReaderHtml` embeds the runtime bundle from
`@tradersamwise/reader-webview`. Dictionary, name, kanji, and furigana data access
stay outside this package. Add adapter interfaces in the high-level reader package
when reusable code needs data, then let the host app provide concrete
implementations.

License: AGPL-3.0-only. See `LICENSE` and `NOTICE.md`.
