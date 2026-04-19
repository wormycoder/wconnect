// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyDxZKne6PCM_7mm-5rbU9q_kvWFLD4OP40",
  authDomain: "wconnect-9fe8a.firebaseapp.com",
  databaseURL: "https://wconnect-9fe8a-default-rtdb.firebaseio.com",
  projectId: "wconnect-9fe8a",
  storageBucket: "wconnect-9fe8a.firebasestorage.app",
  messagingSenderId: "575182937817",
  appId: "1:575182937817:web:ffd4e8e96476a561c328c8",
  measurementId: "G-K6CW7DBLSH"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

try { getAnalytics(app); } catch(e) {}

export default app;
