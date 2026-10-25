# Chess Playbook — Project Context

## What this app is

"Chess Playbook" (formerly "Chess Opening Flashcards"; the package id and slug are unchanged) is a React Native / Expo app for studying chess opening repertoires as flashcards. The user (Jonas) builds a repertoire per color (White/Black): **Repertoires → Openings → Cards**. Each card has one of three modes (see Data model). Personal project under active development; a Play Store release is planned but nothing is published yet.

## Environment

- **Location**: `C:\Dev\ChessApp-ReactNative` (Windows; PowerShell primary, Git Bash works). **Repo**: `https://github.com/jonaaasss/Chess-app-React-Native`.
- **Branches** (each created from the previous): `repertoire-page-finished` (tag `version-before-ux-laws` = `db495ae`) → `ux-laws` (UX audit, 3 phases) → `account-backup` (current; Google sign-in + cloud backup, import, summaries). Always verify the current branch before assuming.
- **Stack**: Expo SDK ~57, React Native 0.86, React 19.2, TypeScript (strict), `react-native-svg` (all board/piece/arrow drawing), `@react-navigation/native-stack`, `@react-native-async-storage/async-storage` (the local store is the source of truth, works fully offline), Firebase Auth + Firestore (optional cloud backup only).
- **Two apps on Jonas's OnePlus 6T** (package ids differ, so they live side by side with separate data):
  - **"Chess Playbook"** — release build, package `com.jonas.chessopeningflashcards`, holds the real repertoires. Build/update: `npm run android:permanent` (pick the OnePlus). Never wipe its data or uninstall it.
  - **"Chess Playbook DEV"** — debug build, package `com.jonas.chessopeningflashcards.dev`, loads its code from Metro, starts empty. Start with `npm run android`; JS changes: press `r` in Metro. Open it from the phone — plain `npx expo run:android` and Metro's `a` key open the *other* package.
  - `plugins/withPermanentBuild.js` re-applies the `.dev` suffix and both app names on every `expo prebuild` (`android/` is gitignored and regenerated). `plugins/withStockfishAssets.js` copies `assets/engine/` into the native project.
  - Both are signed with the standard debug keystore (its SHA-1 is registered in Firebase). A Play Store release needs its own keystore and that SHA-1 added to Firebase.
- **No test framework.** Verification = `tsc` + a Metro export (see below). Claude cannot run the app; Jonas tests on the phone. `adb` works from this PC (`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`) for installs, screenshots and logcat.
- **Recurring gotchas** (diagnose before assuming a code regression):
  - adb port forward drops after a USB re-enumeration → "Unable to load script". Fix: `adb reverse tcp:8081 tcp:8081`; also check `adb devices -l` (a phone showing "unauthorized" needs USB debugging re-authorized).
  - `android/local.properties` is wiped by every prebuild; if Gradle says "SDK location not found": `sdk.dir=C:\\Users\\jonas\\AppData\\Local\\Android\\Sdk`.
  - Metro "Failed to start watch mode" that survives `-c`: Windows-level (stuck watcher handle after force-killing node → reboot; or Defender → exclude the project and `node.exe`).
  - Ctrl+C on `npx` commands may prompt `Terminate batch job (Y/N)?` off-screen. Release builds take 5–10 minutes and fail at `:app:packageRelease` when the phone is not authorized; `.\gradlew.bat --stop` first.

## Data model (src/types.ts)

- `Repertoire` (`GroupId` `'white' | 'black'`) → `Opening` → `Card`. `Card.mode`: `'reactions' | 'plan' | 'others'` (**"Others" is shown to the user as "Front & back"**; the key stays `others`). All modes use `Card.boards: ReactionBoard[]` (1–6 boards).
- `Opening` also has `startPosition?` (chosen once when the opening is created, via `OpeningStartPositionOverlay`; every new board starts there) and `summary?` (free text shown blurred at the start of studying; syntax in `docs/IMPORT_REGELS.md`). `Card` also has `fastRevision?` (part of the quick daily run) and `overviewText?` (shown after the last board; auto-generated from the board descriptions when blank).
- **Study text lives on each board**, in one "Description" field: `board.front.text` for Reactions, `board.back.text` for Plan, and for Others whichever face is being viewed. `descriptionFace()` in `CardEditorOverlay.tsx` carries it over when the mode changes.
  - **Reactions**: a rules-accurate recorded game (`chessEngine.ts`) stored as a branching tree (`MoveNode`; `children[0]` = main line). In Study the opponent's moves are auto-played and you find your own; branches get a numbered-arrow walkthrough. No front/back split.
  - **Plan**: one position on `back`, with arrows (and circles). Needs at least one arrow. In Study the board is bare and you draw the arrows yourself; colors are cycled green → orange → red → blue; order inside one color doesn't matter. Arrows can carry `notes` (`ArrowNotes`: `reason`, `next`, `responses[{trigger, text, kind: 'reaction' | 'exception'}]`, cleaned by `arrowNotes.ts`) that appear as a popup in Study.
  - **Others / Front & back**: independent `front` and `back` faces (position, annotations, text); the only mode with a flip button.
  - Others/Plan keep a linear move history per face (`BoardFace.moves`); rewinding and playing another move truncates it.
- **Board style** is one global setting. **Orientation**: a Black repertoire renders boards flipped everywhere via `flipIndex` (display layer only; never change `squareIndex`/`squareFromIndex`).
- **Example repertoire**: seeded per color by `exampleContent.ts` (always derived through the real engine, never hand-written), shown/hidden from Home, restorable from its row menu. **Repertoire list auto-skip** when there's one visible repertoire (Settings toggle overrides).
- **Migration**: `storage.ts` `migrate()` backfills fields added later. When changing the data shape, always add a backfill there and keep old data (and old backups) loadable.

## Import and AI import

- `src/importOpening.ts` (`parseOpeningImport`): turns pasted JSON (`format: "chess-playbook-import"`, `version: 1`) into an opening with Plan cards. Every move is replayed through `chessEngine`, every arrow and note is validated; one error = nothing is created. Entered via "Import PGN" behind **Add opening** (`ImportPgnOverlay`).
- `src/aiImport.ts` + `AiImportOverlay`: sends a pasted PGN to Gemini, runs the answer through the same checker and asks the model to fix errors (2 rounds). **Testing only**: the API key is typed in and stored on the phone; before other people get the app, these calls must move to a small server that holds the key.
- Format, limits, summary syntax, card styles and arrow rules: **`docs/IMPORT_REGELS.md`** (read it before making or reviewing opening content).
- Dev aid: Settings → Developer toggle enables `DevExportOverlay`/`devExport.ts`, which dumps a repertoire as plain text.

## Account and backup (Firebase)

- Firebase project `chess-app-3c7e6` (Spark plan, free; no card). Firestore in `europe-west1`; Firebase Auth itself is US-only (a Google restriction). Public config and the Google Web client ID live in `src/firebaseConfig.ts` (identifiers, not secrets). Firestore rules: only `users/{uid}/**` for that same uid.
- Sign-in: `@react-native-google-signin/google-signin` → Firebase credential (`account.ts`); the session persists in AsyncStorage. Email + password is **not built yet**. In-app "Delete account and backups" exists (Play also requires a web page for deletion requests).
- Backup (`backup.ts`): the whole store as JSON → gzip (`pako`) → base64, at `users/{uid}/backups/{ms}` (payload over ~100 KB is split into `chunks/` documents). The last 10 are kept. Each carries device name, counts and a hash.
- Phone-side state is in its own AsyncStorage key `chess-flashcards-backup-meta` (not in the store, so the data format is untouched).
- Auto backup (`autoBackup.ts`): 60 s after a change (max one per 10 min), when the app goes to the background, shortly after start/sign-in, with retries; skipped when nothing changed. **Nothing is uploaded until the account's existing-backup question is settled** (`resolvedUid`; `backupFlow.ts`), and a phone with only the example repertoire never uploads.
- Restore replaces the local store; the previous store is kept under `chess-flashcards-data.before-restore` for Undo. UI: `AccountSection` at the top of Settings; a reminder on Home after 3 own cards when signed out.

## Engine (Stockfish)

The board editor shows an eval bar, a top-3 moves panel (tap a move to play it) and best-move arrows (hidden where the recorded line branches). Hard-won constraints — read before touching:
- Hermes has no WebAssembly → the engine runs in a hidden `react-native-webview` page (`assets/engine/index.html`), talking UCI over `postMessage` (`src/engine/useStockfishEngine.tsx`).
- Android's WebView can't start a Worker from `file://`; `index.html` fetches the engine with `XMLHttpRequest` (success reports status 0; `fetch()` hangs), wraps it in a Blob and starts the Worker from that.
- WASM NNUE builds need SIMD, which faults on this phone. The engine is `stockfish-18-asm.js` (ASM.js, ~10.5 MB). Don't "upgrade" to WASM.
- These single-threaded builds crash if `position`/`go` arrives before the previous search's `bestmove`; the hook queues (`searchingRef`/`pendingRef`). Don't simplify it.
- `assets/engine/*.js` must stay in `metro.config.js`'s `blockList`; editing `assets/engine/` needs a native rebuild. UCI `MultiPV 3`; evals are flipped to White's perspective.

## Key files

- `src/chessEngine.ts` (full rules, SAN), `src/chess.ts` (squares, board/face construction and cloning, move-tree helpers), `src/types.ts`, `src/theme.ts` (colors, `touchTarget` = 48, `arrowColors`, `variationColor`, `boardStyles`).
- `src/storage.ts` — whole persistence layer (one AsyncStorage key, in-memory cache, CRUD, settings, migration, backup export/replace, restore helpers for Undo).
- `src/overlay.tsx` — modal/dialog system (`showOverlay`, `confirmDialog`, `choiceDialog`, `promptDialog`, menus), `useOverlayBack` (per-window Android back handling) and the snackbar (`showSnackbar`, `SnackbarLayer`).
- Navigation stack: `HomeScreen` → `RepertoiresScreen` → `OpeningsScreen` → `CardsScreen` (routing in `App.tsx`); `SettingsScreen` + `AccountSection`. Full-screen editors are overlays, not navigation screens: `CardEditorOverlay`, `ReactionBoardEditorOverlay` (the one board editor for all modes; the most complex screen), `MoveDuplicateOverlay`, `ArrowNotesOverlay`, `OpeningSummaryOverlay`, `OpeningStartPositionOverlay`.
- Study: `StudySessionOverlay` (queue, rounds, routing; Others rendered inline), `ReactionStudy`, `PlanStudy`, `SummaryText`/`MoveText` (summary tables and colored moves), `ArrowNoteBody`.
- Components: `ChessBoard.tsx` (`PieceGlyph`, `ArrowsSvg`, `NumberedArrowsSvg`/`NumberedArrowBadges`, `ChessBoardView`), `PieceAnimation.tsx`, `Common.tsx` (`Screen`, `TopBar`, tappable `Breadcrumb`, buttons), `ToggleRow.tsx`, `ModeTip.tsx`, `pieceArt.tsx`.
- Guide and tutorial: `guideContent.ts` + `GuideCoach.tsx` ("Study Your First Opening"), `tutorial.tsx` + `tutorialContent.ts` ("Make Your First Card"); both are started from Home buttons that can be hidden in Settings.

## UI/UX conventions

- Draw icons as `react-native-svg` paths, not Unicode glyphs (they don't center reliably).
- Boards inside a `ScrollView` use `PanResponder`, not `Pressable` (see `measureGrid`/`squareFromPage`/`arrowStartRef`).
- `useLayoutEffect` for anything that must apply before paint. Never call a hook after a conditional early return.
- Color language: `colors.primary` green = correct/yours; `colors.danger` red = wrong/destructive (`colors.dangerText` for red text); `colors.gold` = retry/warning. Opponent turn text is neutral grey.
- Touch targets are at least 48dp (`touchTarget`). Deleting is done without a dialog: a snackbar with **Undo** (6 s). Leaving an editor with changes asks "Discard your changes?". Every overlay handles the Android back button via `useOverlayBack`. Full-screen editors open without a fade.
- Numbered arrows: same-color arrows are numbered in the editor. Where a recorded Reactions line branches, the editor draws purple (`variationColor`) numbered arrows (1 = main line, which › plays; tap or play a move to follow it). In Study the variant arrows are numbered in walking order (main line last).
- Any new board-rendering code takes `flipped` and applies `flipIndex` to squares and every arrow/circle. Drawing: drag = arrow, tap = circle; the same arrow again in the same color removes it.
- When asked for UX feedback, cite the specific law from lawsofux.com and present findings as discussion points, not silent fixes.

## Verification workflow (Claude has no device access)

```bash
npx tsc --noEmit
npx expo export --platform android
rm -rf dist
```

Both must be clean. They only catch type and bundling errors: never claim a UI change "works", only that it compiles and bundles. Jonas verifies on the phone.
