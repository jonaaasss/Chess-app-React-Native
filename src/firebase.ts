import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseConfig } from './firebaseConfig';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// The signed-in user is kept in AsyncStorage, so they stay signed in across
// app restarts. `initializeAuth` may only run once per app; a Fast Refresh
// runs this file again, and then the existing instance is used.
function createAuth(): Auth {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(app);
  }
}

// Long polling: the WebSocket-based default is unreliable in React Native.
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(app);
  }
}

export const auth = createAuth();
export const db = createFirestore();
