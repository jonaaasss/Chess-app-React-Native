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
// - The development app gets the package name suffix ".dev" and is called
//   "Chess DEV", so the two can't be mistaken for each other on the phone. Open
//   it from the phone (or `npm run android`, whose --app-id names the package
//   to launch) — Metro's "a" key opens the other one.
const DEV_SUFFIX = '.dev';
const DEV_NAME = 'Chess DEV';
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

// A build type's own res/values/strings.xml overrides the app name from main.
function writeAppName(config, buildType, name) {
  const dir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', buildType, 'res', 'values');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'strings.xml'),
    `<resources>\n  <string name="app_name">${name}</string>\n</resources>\n`
  );
}

function withAppNames(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      writeAppName(config, 'release', PERMANENT_NAME);
      writeAppName(config, 'debug', DEV_NAME);
      return config;
    }
  ]);
}

module.exports = function withPermanentBuild(config) {
  return withAppNames(withDevPackageSuffix(config));
};
