import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithCredential,
  signOut,
  type User
} from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth } from './firebase';
import { GOOGLE_WEB_CLIENT_ID } from './firebaseConfig';
import { deleteAllBackups, updateBackupMeta } from './backup';

let googleConfigured = false;

export function configureGoogleSignIn(): void {
  if (googleConfigured) return;
  googleConfigured = true;
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
}

// Shows the Google account picker; null when the user backs out of it.
async function pickGoogleIdToken(): Promise<string | null> {
  configureGoogleSignIn();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') return null;
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google did not return a sign-in token.');
  return idToken;
}

// Null when the user cancelled.
export async function signInWithGoogle(): Promise<User | null> {
  const idToken = await pickGoogleIdToken();
  if (!idToken) return null;
  const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return result.user;
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
  await GoogleSignin.signOut().catch(() => {});
  await updateBackupMeta({
    resolvedUid: null,
    lastBackupAt: null,
    lastBackupHash: null,
    lastBackupId: null,
    lastError: null
  });
}

// Removing an account needs a recent sign-in, so an older one is refreshed
// first (that shows the Google account picker again).
const RECENT_SIGN_IN_MS = 4 * 60 * 1000;

export async function deleteAccountAndBackups(): Promise<void> {
  let user = auth.currentUser;
  if (!user) return;
  const lastSignIn = Date.parse(user.metadata.lastSignInTime ?? '') || 0;
  if (Date.now() - lastSignIn > RECENT_SIGN_IN_MS) {
    const idToken = await pickGoogleIdToken();
    if (!idToken) throw new Error('Deleting your account needs you to confirm with Google first.');
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
    user = auth.currentUser;
    if (!user) return;
  }
  await deleteAllBackups(user.uid);
  await deleteUser(user);
  await GoogleSignin.signOut().catch(() => {});
  await updateBackupMeta({
    resolvedUid: null,
    lastBackupAt: null,
    lastBackupHash: null,
    lastBackupId: null,
    lastError: null
  });
}

// The signed-in user (null when signed out), and whether Firebase has looked
// up who that is yet.
export function useAccount(): { user: User | null; ready: boolean } {
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: auth.currentUser, ready: false });
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setState({ user, ready: true });
      }),
    []
  );
  return state;
}
