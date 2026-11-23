// Where the store is kept on the phone (the web test build has its own
// `storeFile.web.ts`, which Metro picks for the web).
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

// The whole store lives in a file, not in AsyncStorage: on Android a single
// AsyncStorage value can't be read back once it is bigger than about 2 MB
// ("Row too big to fit into CursorWindow"), and the store can grow past that.
export function storeFileUri(name: string): string {
  return `${FileSystem.documentDirectory}${name}.json`;
}

export async function readFile(uri: string): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return null;
  return FileSystem.readAsStringAsync(uri);
}

// Writes next to the target first and then swaps, so a crash halfway never
// leaves a half-written file in place of the good one.
export async function writeFile(uri: string, contents: string): Promise<void> {
  const tmp = `${uri}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, contents);
  await FileSystem.deleteAsync(uri, { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: uri });
}

// AsyncStorage's own database (RKStorage), opened directly: unlike
// AsyncStorage's reader it has no 2 MB limit per value. Only used to get the
// data out of an older install, where it was kept as one large value.
export async function readFromAsyncStorageDatabase(key: string): Promise<string | null> {
  const dir = String(SQLite.defaultDatabaseDirectory).replace(/\/files\/SQLite\/?$/, '/databases');
  const db = await SQLite.openDatabaseAsync('RKStorage', undefined, dir);
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM catalystLocalStorage WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  } finally {
    await db.closeAsync();
  }
}
