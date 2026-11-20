// Keeps the screen on while a long Lichess scan runs (Opening map, Generate
// plan), so Android does not pause the app halfway. expo-keep-awake comes
// with Expo itself; it is loaded lazily and every call is guarded, so a
// build without the native part simply keeps the old behaviour.
const TAG = 'lichess-scan';

function mod(): { activateKeepAwakeAsync: (tag?: string) => Promise<void>; deactivateKeepAwake: (tag?: string) => Promise<void> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-keep-awake');
  } catch {
    return null;
  }
}

export function keepScreenOn(): void {
  try {
    mod()?.activateKeepAwakeAsync(TAG).catch(() => undefined);
  } catch {
    // Not available in this build.
  }
}

export function allowScreenOff(): void {
  try {
    mod()?.deactivateKeepAwake(TAG).catch(() => undefined);
  } catch {
    // Not available in this build.
  }
}
