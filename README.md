# Jiten

Japanese ebook reader and dictionary app. Built with Expo (React Native) targeting iOS, Android, and web.

## Development

```bash
yarn            # install dependencies
yarn web        # start web dev server
yarn ios        # run on iOS
yarn android    # run on Android
yarn test       # run tests
yarn lint       # check for lint errors
yarn lint:fix   # auto-fix lint errors
yarn format     # format all files with prettier
```

## Platform Polymorphism

This project runs on both native (iOS/Android) and web. React Native's `Alert.alert`, gesture handlers, and filesystem APIs behave differently (or don't work at all) across platforms.

**Rule: use polymorphic modules instead of `Platform.OS` switches.**

Polymorphic modules use Metro/webpack's platform extension resolution (`.web.ts` / `.native.ts`). The bundler picks the right file automatically — no runtime branching needed.

### Existing polymorphic modules

| Module                                   | Purpose                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `lib/confirm.{web,native}.ts`            | `confirm(title, msg)` and `alert(title, msg)` — wraps `window.confirm`/`window.alert` on web, `Alert.alert` on native |
| `db/user-provider.{web,native}.tsx`      | SQLite database provider — uses `expo-sqlite` web adapter vs native                                                   |
| `components/ReaderView.{web,native}.tsx` | WebView reader component                                                                                              |

### ESLint enforcement

Importing `Alert` from `react-native` is banned via `no-restricted-imports`. Use `confirm()` or `alert()` from `@/lib/confirm` instead. The polymorphic wrapper (`lib/confirm.native.ts`) is exempted from this rule.

## Linting and Formatting

- **ESLint** with TypeScript, React Hooks (exhaustive-deps), and Prettier rules
- **Prettier** for consistent formatting
- **Pre-commit hook** (husky + lint-staged) runs eslint and prettier on staged files automatically

Config files: `eslint.config.mjs`, `.prettierrc`

## Reader Architecture

The ebook reader uses **JS-measured virtualized pagination** (not CSS columns):

1. Full HTML content is embedded in a hidden `<div id="raw">` element
2. On init, JS extracts child elements into a `blockHtmls[]` array
3. `paginate()` measures which blocks fit per page using an off-screen div
4. `renderPage(n)` swaps only the current page's blocks into the DOM
5. Hidden buffer divs (`#buf-prev`, `#buf-next`) hold adjacent page text for word lookup at boundaries

No scrolling is involved — page navigation directly swaps DOM content.
