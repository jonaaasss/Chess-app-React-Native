import type { Persistence } from 'firebase/auth';

// `getReactNativePersistence` is in the React Native build of firebase/auth
// (the one Metro picks) but missing from the typings TypeScript reads.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
