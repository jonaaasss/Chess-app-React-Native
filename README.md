# Chess Opening Flashcards (React Native)

React Native / Expo port of the [web PWA version](../Code) — same data model and features, rebuilt for Android using Expo, AsyncStorage, and native gestures. Personal, offline-only, single-user.

## Prerequisites

- [Node.js](https://nodejs.org) (already installed if you've used the web version)
- [Android Studio](https://developer.android.com/studio), with an Android Virtual Device (AVD) created via its Device Manager, **or** a physical Android phone with USB debugging enabled

## Run it

```bash
cd "Code-ReactNative"
npm install
npx expo run:android
```

The first run builds the native Android project (creates an `/android` folder) and installs it on whichever emulator/device is running — start your AVD in Android Studio first, or plug in your phone. After that, you can also just use:

```bash
npm run android
```

which starts the Metro bundler and reuses the existing native build (much faster).

## Opening it directly in Android Studio

After the first `npx expo run:android`, an `android/` folder appears in this project — open **that folder** (not the repo root) in Android Studio to run/debug it like a normal native project, or to launch it on a specific emulator from Android Studio's device dropdown.

## What's different from the web PWA

- **Storage**: AsyncStorage instead of IndexedDB (React Native has no IndexedDB). Data lives only on the device you run it on — same "offline, single device" scope as before, just no longer inside a browser.
- **Board editor gestures**: rebuilt with React Native's `PanResponder` instead of pointer events, using the board's known grid geometry rather than DOM hit-testing.
- **Piece rendering**: React Native's `Text` has no equivalent of `-webkit-text-stroke`, so the outlined piece glyphs are approximated by layering the glyph 8 times in the outline color behind the filled glyph. Close visually, but not pixel-identical to the web version.
- **Card reorder**: drag-to-reorder estimates position from an approximate row height rather than continuously re-measuring every row; functional, but may feel slightly less precise than the web version on very long lists.

## Status

Type-checks cleanly (`npx tsc --noEmit`) and bundles successfully via Metro (`npx expo export --platform android`), but has **not** been run on an actual emulator/device yet — please report anything broken so it can be fixed.
