# @jiten/japanese-reader-core

Pure Japanese reader helpers shared by the Jiten app and future standalone reader integrations.

This package owns logic that does not require React Native, Expo Router, app stores, or concrete SQLite modules:

- Reader HTML generation
- Visible text counting and content slicing
- Reader progress flush policy
- Selection toolbar positioning
- Kanji reading-pattern classification

Dictionary, name, kanji, and furigana data access should stay outside this package. Add adapter interfaces here when reusable code needs data, then let the app provide concrete implementations.
