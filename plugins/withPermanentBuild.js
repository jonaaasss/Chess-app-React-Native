const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// The app is installed twice on the phone: the development version (debug
// build, loads its code from Metro) and the permanent one (release build,
// code inside the app). They can only sit side by side with different package
// names, and android/ is regenerated on every `expo prebuild` (gitignored), so
// both changes are re-applied here rather than edited into android/ by hand.
//
// - The permanent app keeps the original package name (and so the data that
//   was already on the phone) and is called "Permanent" — its own app_name,
//   which only the release build sees.
// - The development app gets the package name suffix ".dev" and keeps the
//   normal app name. Start it with `npm run android` (the --app-id there tells
//   Expo which package to launch).
const DEV_SUFFIX = '.dev';
const PERMANENT_NAME = 'Permanent';

function withDevPackageSuffix(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (gradle.includes('applicationIdSuffix')) return config;
    config.modResults.contents = gradle.replace(
      /(buildTypes\s*\{\s*debug\s*\{)/,
      (match) => `${match}\n            applicationIdSuffix "${DEV_SUFFIX}"`
    );
    return config;
  });
}

function withPermanentName(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'release', 'res', 'values');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'strings.xml'),
        `<resources>\n  <string name="app_name">${PERMANENT_NAME}</string>\n</resources>\n`
      );
      return config;
    }
  ]);
}

module.exports = function withPermanentBuild(config) {
  return withPermanentName(withDevPackageSuffix(config));
};
