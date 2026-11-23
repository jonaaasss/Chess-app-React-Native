// Web test build only (Claude's tests in a browser): the store is kept in the
// browser's localStorage instead of a file. The Android app never loads this.
const storage = (globalThis as unknown as { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void } })
  .localStorage;

export function storeFileUri(name: string): string {
  return `file:${name}.json`;
}

export async function readFile(uri: string): Promise<string | null> {
  return storage.getItem(uri);
}

export async function writeFile(uri: string, contents: string): Promise<void> {
  storage.setItem(uri, contents);
}

export async function readFromAsyncStorageDatabase(): Promise<string | null> {
  return null;
}
