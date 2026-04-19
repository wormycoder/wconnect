// js/auth.js
import { auth, db } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── Helpers ───────────────────────────────────────────────────────
export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

export function getInitials(name) {
  return (name || '?').slice(0,2).toUpperCase();
}

function setAvatar(el, username) {
  if (!el) return;
  el.textContent = getInitials(username);
  const colors = ['#3B82F6','#EF4444','#22C55E','#A855F7','#F97316','#EC4899','#0EA5E9','#F59E0B'];
  let hash = 0;
  for (let c of (username||'')) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  el.style.background = colors[Math.abs(hash) % colors.length];
}
export { setAvatar };

// ─── Create user profile in Firestore ──────────────────────────────
async function createUserProfile(uid, username, email = '') {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    uid,
    username,
    usernameLower: username.toLowerCase(),
    displayName: username,
    email: email || '',
    emailNotif: false,
    createdAt: serverTimestamp(),
    isPro: false,
    status: 'online',
  }, { merge: true });
}

// ─── Check username unique ─────────────────────────────────────────
async function isUsernameTaken(username) {
  const q = query(collection(db, 'users'), where('usernameLower', '==', username.toLowerCase()));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ─── Auth Tab Toggle ───────────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
    document.getElementById('signup-form').classList.toggle('hidden', target !== 'signup');
    document.getElementById('auth-error').classList.add('hidden');
  });
});

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ─── Login ─────────────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  const usernameOrEmail = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!usernameOrEmail || !password) return showAuthError('Please fill in all fields.');

  let email = usernameOrEmail;
  // If not email format, look up by username
  if (!usernameOrEmail.includes('@')) {
    const q = query(collection(db, 'users'), where('usernameLower', '==', usernameOrEmail.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return showAuthError('Username not found.');
    email = snap.docs[0].data().email;
    if (!email) return showAuthError('This account has no email. Try signing in with Google or contact support.');
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    showAuthError(e.message.replace('Firebase: ', ''));
  }
});

// ─── Signup ────────────────────────────────────────────────────────
document.getElementById('signup-btn').addEventListener('click', async () => {
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;

  if (!username) return showAuthError('Username is required.');
  if (username.length < 3) return showAuthError('Username must be at least 3 characters.');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return showAuthError('Username can only contain letters, numbers, underscores.');
  if (!email) return showAuthError('Email is required to create an account.');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
  if (password !== confirm) return showAuthError('Passwords do not match.');

  try {
    if (await isUsernameTaken(username)) return showAuthError('Username already taken.');
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await createUserProfile(cred.user.uid, username, email);
  } catch (e) {
    showAuthError(e.message.replace('Firebase: ', ''));
  }
});

// ─── Google Login/Signup ───────────────────────────────────────────
async function googleAuth() {
  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const userRef = doc(db, 'users', cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      // New Google user — create profile with email prefix as username
      let username = cred.user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g,'');
      if (await isUsernameTaken(username)) username = username + Math.floor(Math.random()*999);
      await createUserProfile(cred.user.uid, username, cred.user.email);
    }
  } catch (e) {
    showAuthError(e.message.replace('Firebase: ', ''));
  }
}
document.getElementById('google-login-btn').addEventListener('click', googleAuth);
document.getElementById('google-signup-btn').addEventListener('click', googleAuth);

// ─── Anonymous ─────────────────────────────────────────────────────
document.getElementById('anon-btn').addEventListener('click', async () => {
  try {
    const cred = await signInAnonymously(auth);
    const username = 'anon_' + cred.user.uid.slice(0,6);
    await createUserProfile(cred.user.uid, username, '');
  } catch(e) {
    showAuthError(e.message);
  }
});

// ─── Auth State ────────────────────────────────────────────────────
export let currentUser = null;
export let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const snap = await getDoc(doc(db, 'users', user.uid));
    currentProfile = snap.exists() ? snap.data() : null;
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('app-ready', { detail: { user, profile: currentProfile } }));
  } else {
    currentUser = null;
    currentProfile = null;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
});

// ─── Sign Out ──────────────────────────────────────────────────────
document.getElementById('signout-btn').addEventListener('click', async () => {
  await signOut(auth);
  showToast('Signed out.');
});
