const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// assets/engine/ ships the Stockfish WASM engine's own raw JS glue code
// (loaded at runtime from the WebView via file:///android_asset/, never
// `require()`d from app code) and its ~7MB .wasm binary. Metro otherwise
// watches and crawls every file outside node_modules looking for modules
// to add to its dependency graph — the huge binary and heavily-minified,
// non-RN-module JS crash that (a "Failed to start watch mode" /
// "DependencyGraph.js ... reading 'get'/'exists'" internal error, not
// fixed by just clearing the cache). Excluding the whole folder from
// blockList is what actually stops Metro from touching it.
//
// `metro-config/src/defaults/exclusionList` isn't a stable export in this
// Metro version (throws ERR_PACKAGE_PATH_NOT_EXPORTED), so this merges the
// pattern in by hand instead of using that helper.
const enginePattern = /assets[\\/]engine[\\/].*/;
const existingBlockList = config.resolver.blockList;
config.resolver.blockList =
  existingBlockList instanceof RegExp
    ? new RegExp(`(${existingBlockList.source})|(${enginePattern.source})`)
    : Array.isArray(existingBlockList)
      ? [...existingBlockList, enginePattern]
      : enginePattern;

// Web test build only (`npx expo export --platform web`, used by Claude to
// test screens in a browser): react-native-webview has no web version, so on
// the web it is swapped for a shim that runs the same Stockfish file in a Web
// Worker. Android and iOS resolve every module exactly as before.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-webview') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src', 'web', 'WebViewShim.tsx') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
