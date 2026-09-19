const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// android/ is regenerated on every `expo prebuild`/`expo run:android` (it's
// gitignored — see PROJECT_CONTEXT.md), so anything the WebView-based
// Stockfish engine needs on disk has to be re-copied into the fresh native
// project every time rather than committed there directly. This copies
// assets/engine/* (the WASM engine + its bridge HTML) into
// android/app/src/main/assets/engine, where react-native-webview can load
// it via a plain file:///android_asset/ URL.
function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

module.exports = function withStockfishAssets(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const src = path.join(config.modRequest.projectRoot, 'assets', 'engine');
      const dest = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'engine');
      copyRecursive(src, dest);
      return config;
    }
  ]);
};
