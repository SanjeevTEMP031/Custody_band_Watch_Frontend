import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDtJWj50jBIJfZSyEizZq-sw8bWIjUZlC8",
  authDomain: "custody-band-a8f59.firebaseapp.com",
  projectId: "custody-band-a8f59",
  storageBucket: "custody-band-a8f59.firebasestorage.app",
  messagingSenderId: "334876318466",
  appId: "1:334876318466:web:9de599fa07a040c8f1801b",
  measurementId: "G-3JHFFF76G9"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Analytics conditionally to prevent errors in non-browser/unsupported environments
export let analytics: Analytics | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}
