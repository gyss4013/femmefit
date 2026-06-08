import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBH60dKhQ1aTXqp0aVtZIYvI6JPFbYFhjc",
  authDomain: "gym-app-70e19.firebaseapp.com",
  projectId: "gym-app-70e19",
  storageBucket: "gym-app-70e19.firebasestorage.app",
  messagingSenderId: "811750373620",
  appId: "1:811750373620:web:4d4ca66b765aee297b06a1",
  measurementId: "G-FXZELYELML"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db        = getFirestore(firebaseApp);
export const auth      = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
