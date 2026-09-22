// Public identifiers of the Firebase project (not secrets): what the data
// is allowed to do is decided by the Firestore security rules in the Firebase
// console (a signed-in user can only read and write their own documents).
export const firebaseConfig = {
  apiKey: 'AIzaSyAmVcJr8lZqPFBlU3nDjhIXNhqZdz76UzA',
  authDomain: 'chess-app-3c7e6.firebaseapp.com',
  projectId: 'chess-app-3c7e6',
  storageBucket: 'chess-app-3c7e6.firebasestorage.app',
  messagingSenderId: '8115430746',
  appId: '1:8115430746:web:224467f6cd271bf8b77f63'
};

// The Web client ID of the project's Google sign-in: the Google account
// picker on the phone hands back a token for it, which Firebase then accepts.
export const GOOGLE_WEB_CLIENT_ID = '8115430746-vi6241mmfo2066gtssfsbql528anant7.apps.googleusercontent.com';
