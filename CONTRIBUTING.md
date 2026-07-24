# Contributing to Jiten

Thanks for your interest in improving Jiten! This guide covers local setup, the
development workflow, and the conventions the codebase follows.

By contributing, you agree that your contributions are licensed under the project's
license — **AGPL-3.0** for the app, and **MIT** for the reusable reader packages under
`packages/reader-webview` and `packages/japanese-reader-core`.

## Prerequisites

- **Node.js 20+**
- **Yarn** (Yarn 1 / classic — the repo uses `yarn.lock`). Please don't use npm.

## Setup

```bash
yarn                  # install dependencies (Yarn workspaces)
cp .env.example .env  # every key is optional; blank = local-only mode
yarn web              # start the web dev server
```

The app runs fully **local-only** with an empty `.env` — no accounts, no backend, no
network. This is the easiest way to develop most features. Cloud sync and AI features
require your own third-party keys (Clerk, Turso, OpenAI) — see the
[Cloud Sync](docs/ARCHITECTURE.md#cloud-sync) section of the architecture doc.

Native development requires your **own** Expo/EAS project (the committed EAS project ID,
Apple App Store ID, and bundle identifiers point at the maintainer's accounts — swap in
your own in `app.config.js` / `eas.json`):

```bash
yarn ios       # build/install/open the iOS simulator dev build
yarn android   # build/install/open the Android emulator dev build
```

## Development workflow

```bash
yarn test        # run the test suite (vitest)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
yarn lint:fix    # eslint --fix
yarn format      # prettier --write .
```

A **pre-commit hook** (husky + lint-staged) runs `tsc`, ESLint, and Prettier on staged
files automatically. Please keep `yarn typecheck`, `yarn lint`, and `yarn test` green.

## Codebase conventions

Before making changes, skim [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — it's the
canonical reference. A few load-bearing rules that are easy to trip over:

- **Platform polymorphism** — prefer `.web.ts` / `.native.ts` modules over `Platform.OS`
  branching. Importing `Alert` directly from `react-native` is banned by ESLint; use
  `alert()` / `confirm()` from `@/lib/confirm`.
- **Lists** — always use `@shopify/flash-list`, never `FlatList`/`SectionList`, and follow
  the web pagination rules in the architecture doc.
- **Web navigation** — never call `router.back()` on web; use `useSafeGoBack()`.
- **Comments** — keep them for non-obvious decisions and invariants; prefer
  self-documenting names.
- **Packages** — `packages/*` must not import app stores, Expo Router screens, or concrete
  database modules. Keep them decoupled via adapter interfaces.

## Pull requests

1. Fork and branch from `master` (`feat/…`, `fix/…`, `chore/…`).
2. Make your change with tests where it makes sense.
3. Ensure `yarn typecheck && yarn lint && yarn test` pass.
4. Open a PR describing the change and the motivation. Screenshots help for UI changes.

## Reporting bugs / requesting features

Use the GitHub issue templates. For security-sensitive reports, see
[SECURITY.md](SECURITY.md) — please don't file those as public issues.
