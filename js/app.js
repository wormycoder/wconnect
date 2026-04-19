// js/app.js
import { auth, db, rtdb } from './firebase-init.js';
import { showToast, setAvatar } from './auth.js';
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  limit, startAfter
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, set, onDisconnect, onValue, serverTimestamp as rtServerTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { updateEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── State ─────────────────────────────────────────────────────────
let ME = null, PROFILE = null;
let activeDMId = null, activeGroupId = null;
let dmUnsub = null, groupUnsub = null;
let aiHistory = [];
let selectedGroupFriends = new Set();

// ─── Init on auth ready ────────────────────────────────────────────
window.addEventListener('app-ready', ({ detail }) => {
  ME = detail.user;
  PROFILE = detail.profile;
  initApp();
});

function initApp() {
  // Sidebar user chip
  const el = document.getElementById('sidebar-username');
  if (el) el.textContent = PROFILE?.displayName || PROFILE?.username || 'Anonymous';
  setAvatar(document.getElementById('sidebar-avatar'), PROFILE?.displayName || PROFILE?.username || '?');

  // Settings display
  const sd = document.getElementById('settings-username-display');
  if (sd) sd.textContent = PROFILE?.username || 'Anonymous';
  const pu = document.getElementById('settings-perm-username');
  if (pu) pu.textContent = PROFILE?.username || 'Anonymous';
  const dn = document.getElementById('settings-displayname');
  if (dn) dn.value = PROFILE?.displayName || PROFILE?.username || '';
  setAvatar(document.getElementById('settings-avatar'), PROFILE?.displayName || PROFILE?.username || '?');

  // Username change section
  initUsernameChangeSection();

  // Presence
  setupPresence();

  // Load initial views
  loadGlobalChat();
  loadDMs();
  loadGroups();
  loadFriends();

  // Discover on input
  document.getElementById('discover-input').addEventListener('input', debounce(e => {
    searchUsers(e.target.value);
  }, 300));
  searchUsers(''); // load everyone initially
}

// ─── Navigation ─────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
      v.classList.add('hidden');
    });
    const el = document.getElementById(`view-${view}`);
    if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
  });
});

// Sidebar collapse
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// ─── Presence ──────────────────────────────────────────────────────
function setupPresence() {
  if (!ME) return;
  const presRef = ref(rtdb, `presence/${ME.uid}`);
  set(presRef, { online: true, lastSeen: rtServerTimestamp() });
  onDisconnect(presRef).set({ online: false, lastSeen: rtServerTimestamp() });
}

// ─── GLOBAL CHAT ───────────────────────────────────────────────────
function loadGlobalChat() {
  const container = document.getElementById('global-messages');
  const q = query(collection(db, 'global'), orderBy('createdAt', 'desc'), limit(60));
  onSnapshot(q, snap => {
    const msgs = [];
    snap.forEach(d => msgs.unshift({ id: d.id, ...d.data() }));
    container.innerHTML = '';
    msgs.forEach(m => container.appendChild(buildMsg(m, m.uid === ME?.uid)));
    container.scrollTop = container.scrollHeight;
  });
}

document.getElementById('global-send').addEventListener('click', sendGlobal);
document.getElementById('global-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendGlobal(); });

async function sendGlobal() {
  const input = document.getElementById('global-input');
  const text = input.value.trim();
  if (!text || !ME) return;
  input.value = '';
  // Always fetch fresh profile so display name is current
  const freshSnap = await getDoc(doc(db, 'users', ME.uid));
  if (freshSnap.exists()) PROFILE = freshSnap.data();
  await addDoc(collection(db, 'global'), {
    text, uid: ME.uid,
    username: PROFILE?.displayName || PROFILE?.username || 'Anonymous',
    createdAt: serverTimestamp()
  });
}

// ─── MESSAGE BUILDER ───────────────────────────────────────────────
function buildMsg(data, isOwn, isAI = false) {
  const div = document.createElement('div');
  div.className = `msg${isOwn ? ' own' : ''}${isAI ? ' ai-msg' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar sm';
  avatar.textContent = (data.username || data.sender || 'AI').slice(0,2).toUpperCase();
  setAvatar(avatar, data.username || data.sender || 'AI');

  const content = document.createElement('div');
  content.className = 'msg-content';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.textContent = data.username || data.sender || 'AI';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = data.createdAt?.toDate ? fmtTime(data.createdAt.toDate()) : 'now';
  meta.appendChild(sender);
  meta.appendChild(time);

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = data.text;

  content.appendChild(meta);
  content.appendChild(bubble);
  div.appendChild(avatar);
  div.appendChild(content);
  return div;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── DIRECT MESSAGES ───────────────────────────────────────────────
function loadDMs() {
  const container = document.getElementById('dm-conversations');
  const q = query(collection(db, 'dms'), where('members', 'array-contains', ME.uid), orderBy('lastAt', 'desc'));
  onSnapshot(q, snap => {
    container.innerHTML = '';
    snap.forEach(d => {
      const data = d.data();
      const otherId = data.members.find(m => m !== ME.uid);
      const item = document.createElement('div');
      item.className = `convo-item${activeDMId === d.id ? ' active' : ''}`;
      item.innerHTML = `
        <div class="avatar sm" id="dm-av-${d.id}">${(data.otherName || '?').slice(0,2).toUpperCase()}</div>
        <div class="convo-info">
          <div class="convo-name">${data.otherName || 'User'}</div>
          <div class="convo-preview">${data.lastMsg || '...'}</div>
        </div>`;
      setAvatar(item.querySelector(`#dm-av-${d.id}`), data.otherName || '?');
      item.addEventListener('click', () => openDM(d.id, otherId, data.otherName));
      container.appendChild(item);
    });
  });
}

async function openDM(dmId, otherId, otherName) {
  activeDMId = dmId;
  if (dmUnsub) dmUnsub();

  const chatPanel = document.getElementById('dm-chat');
  chatPanel.innerHTML = `
    <div class="chat-panel-header">
      <div class="avatar sm" id="dm-chat-av"></div>
      <div><div class="chat-panel-title">${otherName}</div></div>
    </div>
    <div class="chat-area" id="dm-msgs"></div>
    <div class="chat-input-bar">
      <div class="chat-input-wrap">
        <input type="text" id="dm-input" placeholder="Message ${otherName}..." />
        <button class="send-btn" id="dm-send"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    </div>`;
  setAvatar(document.getElementById('dm-chat-av'), otherName);

  const msgContainer = document.getElementById('dm-msgs');
  const sendBtn = document.getElementById('dm-send');
  const input = document.getElementById('dm-input');

  const sendMsg = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const freshSnap = await getDoc(doc(db, 'users', ME.uid));
    if (freshSnap.exists()) PROFILE = freshSnap.data();
    await addDoc(collection(db, 'dms', dmId, 'messages'), {
      text, uid: ME.uid, username: PROFILE?.displayName || PROFILE?.username || 'Anonymous', createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'dms', dmId), { lastMsg: text, lastAt: serverTimestamp() }, { merge: true });
  };

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

  const q = query(collection(db, 'dms', dmId, 'messages'), orderBy('createdAt'));
  dmUnsub = onSnapshot(q, snap => {
    msgContainer.innerHTML = '';
    snap.forEach(d => msgContainer.appendChild(buildMsg({ ...d.data() }, d.data().uid === ME.uid)));
    msgContainer.scrollTop = msgContainer.scrollHeight;
  });
}

export async function startDM(otherId, otherName) {
  // Find or create DM
  const q = query(collection(db, 'dms'), where('members', 'array-contains', ME.uid));
  const snap = await getDocs(q);
  let dmId = null;
  snap.forEach(d => {
    if (d.data().members.includes(otherId)) dmId = d.id;
  });

  if (!dmId) {
    const ref = await addDoc(collection(db, 'dms'), {
      members: [ME.uid, otherId],
      otherName,
      myName: PROFILE?.username || 'Anonymous',
      lastMsg: '', lastAt: serverTimestamp()
    });
    dmId = ref.id;
    // Create reciprocal view for other user
    await setDoc(doc(db, 'dms', dmId), {
      members: [ME.uid, otherId],
      lastMsg: '', lastAt: serverTimestamp(),
    }, { merge: true });
  }

  // Switch to DMs view
  document.querySelector('[data-view="dms"]').click();
  setTimeout(() => openDM(dmId, otherId, otherName), 300);
}

// ─── GROUP CHATS ───────────────────────────────────────────────────
function loadGroups() {
  const container = document.getElementById('group-rooms');
  const q = query(collection(db, 'groups'), where('members', 'array-contains', ME.uid));
  onSnapshot(q, snap => {
    container.innerHTML = '';
    snap.forEach(d => {
      const data = d.data();
      const item = document.createElement('div');
      item.className = `convo-item${activeGroupId === d.id ? ' active' : ''}`;
      item.innerHTML = `
        <div class="avatar sm">${(data.name||'G').slice(0,2).toUpperCase()}</div>
        <div class="convo-info">
          <div class="convo-name">${data.name}</div>
          <div class="convo-preview">${data.members.length} members</div>
        </div>`;
      item.querySelector('.avatar').style.background = '#6366f1';
      item.addEventListener('click', () => openGroup(d.id, data));
      container.appendChild(item);
    });
  });
}

async function openGroup(groupId, data) {
  activeGroupId = groupId;
  if (groupUnsub) groupUnsub();

  const chatPanel = document.getElementById('group-chat');
  chatPanel.innerHTML = `
    <div class="chat-panel-header">
      <div class="avatar sm" style="background:#6366f1">${(data.name||'G').slice(0,2).toUpperCase()}</div>
      <div>
        <div class="chat-panel-title">${data.name}</div>
        <div class="chat-panel-sub">${data.members.length} members</div>
      </div>
      <button class="btn-ghost sm" id="leave-group-btn"><i class="fa-solid fa-right-from-bracket"></i> Leave</button>
    </div>
    <div class="chat-area" id="group-msgs"></div>
    <div class="chat-input-bar">
      <div class="chat-input-wrap">
        <input type="text" id="group-input" placeholder="Message ${data.name}..." />
        <button class="send-btn" id="group-send"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    </div>`;

  document.getElementById('leave-group-btn').addEventListener('click', async () => {
    await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(ME.uid) });
    chatPanel.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><p>Select a group or create one</p></div>`;
    showToast('Left group.');
  });

  const msgContainer = document.getElementById('group-msgs');
  const sendBtn = document.getElementById('group-send');
  const input = document.getElementById('group-input');

  const sendMsg = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const freshSnap = await getDoc(doc(db, 'users', ME.uid));
    if (freshSnap.exists()) PROFILE = freshSnap.data();
    await addDoc(collection(db, 'groups', groupId, 'messages'), {
      text, uid: ME.uid, username: PROFILE?.displayName || PROFILE?.username || 'Anonymous', createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'groups', groupId), { lastMsg: text, lastAt: serverTimestamp() });
  };

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

  const q = query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt'));
  groupUnsub = onSnapshot(q, snap => {
    msgContainer.innerHTML = '';
    snap.forEach(d => msgContainer.appendChild(buildMsg({ ...d.data() }, d.data().uid === ME.uid)));
    msgContainer.scrollTop = msgContainer.scrollHeight;
  });
}

// Create group modal
document.getElementById('create-group-btn').addEventListener('click', async () => {
  selectedGroupFriends.clear();
  // Load friend list into modal
  const container = document.getElementById('group-friend-select');
  container.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
  document.getElementById('group-modal').classList.remove('hidden');

  const friends = await getMyFriends();
  container.innerHTML = '';
  if (!friends.length) {
    container.innerHTML = '<p style="color:var(--text3);font-size:13px">Add some friends first!</p>';
    return;
  }
  friends.forEach(f => {
    const item = document.createElement('div');
    item.className = 'friend-select-item';
    item.innerHTML = `
      <input type="checkbox" id="gf-${f.uid}" />
      <div class="avatar sm">${f.username.slice(0,2).toUpperCase()}</div>
      <label for="gf-${f.uid}" style="cursor:pointer;flex:1">${f.username}</label>`;
    setAvatar(item.querySelector('.avatar'), f.username);
    item.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) selectedGroupFriends.add(f.uid);
      else selectedGroupFriends.delete(f.uid);
      item.classList.toggle('selected', e.target.checked);
    });
    container.appendChild(item);
  });
});

document.getElementById('close-group-modal').addEventListener('click', () => {
  document.getElementById('group-modal').classList.add('hidden');
});

document.getElementById('confirm-create-group').addEventListener('click', async () => {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) return showToast('Enter a group name.', 'error');
  if (!selectedGroupFriends.size) return showToast('Select at least one friend.', 'error');

  const members = [ME.uid, ...selectedGroupFriends];
  await addDoc(collection(db, 'groups'), {
    name, members, createdBy: ME.uid, createdAt: serverTimestamp(), lastMsg: '', lastAt: serverTimestamp()
  });
  document.getElementById('group-modal').classList.add('hidden');
  document.getElementById('group-name-input').value = '';
  showToast(`Group "${name}" created!`, 'success');
});

// ─── FRIENDS ────────────────────────────────────────────────────────
async function getMyFriends() {
  const q = query(collection(db, 'friendships'),
    where('status', '==', 'accepted'),
    where('members', 'array-contains', ME.uid));
  const snap = await getDocs(q);
  const friends = [];
  for (const d of snap.docs) {
    const data = d.data();
    const otherId = data.members.find(m => m !== ME.uid);
    const uSnap = await getDoc(doc(db, 'users', otherId));
    if (uSnap.exists()) friends.push({ uid: otherId, ...uSnap.data(), friendshipId: d.id });
  }
  return friends;
}

async function loadFriends() {
  loadFriendPanel('friends-list');
}

async function loadFriendPanel(panel) {
  const el = document.getElementById(panel);
  if (!el) return;

  // Add-friend tab has its own UI — don't touch it
  if (panel === 'add-friend') return;

  el.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';

  try {
    if (panel === 'friends-list') {
      const friends = await getMyFriends();
      el.innerHTML = '';
      if (!friends.length) {
        el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-group"></i><p>No friends yet. Add some!</p></div>`;
        return;
      }
      friends.forEach(f => el.appendChild(buildFriendCard(f, 'friend')));

    } else if (panel === 'pending-in') {
      // Query only by 'to' field — avoids needing a composite index
      const q = query(collection(db, 'friendships'), where('to', '==', ME.uid));
      const snap = await getDocs(q);
      const pending = snap.docs.filter(d => d.data().status === 'pending');
      el.innerHTML = '';
      const badge = document.getElementById('pending-badge');
      badge.textContent = pending.length;
      badge.classList.toggle('hidden', pending.length === 0);
      document.getElementById('friend-badge').textContent = pending.length;
      document.getElementById('friend-badge').classList.toggle('hidden', pending.length === 0);

      if (!pending.length) {
        el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No pending requests</p></div>`;
        return;
      }
      for (const d of pending) {
        const data = d.data();
        const uSnap = await getDoc(doc(db, 'users', data.from));
        if (uSnap.exists()) el.appendChild(buildFriendCard({ uid: data.from, friendshipId: d.id, ...uSnap.data() }, 'pending-in'));
      }

    } else if (panel === 'pending-out') {
      // Query only by 'from' field — avoids needing a composite index
      const q = query(collection(db, 'friendships'), where('from', '==', ME.uid));
      const snap = await getDocs(q);
      const pending = snap.docs.filter(d => d.data().status === 'pending');
      el.innerHTML = '';
      if (!pending.length) {
        el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-paper-plane"></i><p>No sent requests</p></div>`;
        return;
      }
      for (const d of pending) {
        const data = d.data();
        const uSnap = await getDoc(doc(db, 'users', data.to));
        if (uSnap.exists()) el.appendChild(buildFriendCard({ uid: data.to, friendshipId: d.id, ...uSnap.data() }, 'pending-out'));
      }
    }
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Failed to load. Check Firestore indexes.<br><span style="font-size:11px;color:var(--text3)">${e.message}</span></p></div>`;
  }
}

function buildFriendCard(user, type) {
  const card = document.createElement('div');
  card.className = 'user-card';
  const av = document.createElement('div');
  av.className = 'avatar';
  setAvatar(av, user.username);

  const info = document.createElement('div');
  info.className = 'user-card-info';
  info.innerHTML = `<div class="user-card-name">${user.username}</div>
    <div class="user-card-sub">${type === 'friend' ? 'Friend' : type === 'pending-in' ? 'Wants to be friends' : 'Request sent'}</div>`;

  const actions = document.createElement('div');
  actions.className = 'user-card-actions';

  if (type === 'friend') {
    const msgBtn = document.createElement('button');
    msgBtn.className = 'btn-sm-icon msg'; msgBtn.title = 'Message';
    msgBtn.innerHTML = '<i class="fa-solid fa-message"></i>';
    msgBtn.addEventListener('click', () => startDM(user.uid, user.username));

    const unfriendBtn = document.createElement('button');
    unfriendBtn.className = 'btn-sm-icon unfriend'; unfriendBtn.title = 'Unfriend';
    unfriendBtn.innerHTML = '<i class="fa-solid fa-user-minus"></i>';
    unfriendBtn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'friendships', user.friendshipId));
      card.remove();
      showToast(`Unfriended ${user.username}.`);
    });
    actions.appendChild(msgBtn);
    actions.appendChild(unfriendBtn);

  } else if (type === 'pending-in') {
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn-sm-icon accept'; acceptBtn.title = 'Accept';
    acceptBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    acceptBtn.addEventListener('click', async () => {
      await updateDoc(doc(db, 'friendships', user.friendshipId), { status: 'accepted' });
      card.remove();
      showToast(`You and ${user.username} are now friends!`, 'success');
    });

    const declineBtn = document.createElement('button');
    declineBtn.className = 'btn-sm-icon decline'; declineBtn.title = 'Decline';
    declineBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    declineBtn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'friendships', user.friendshipId));
      card.remove();
      showToast(`Request from ${user.username} declined.`);
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);

  } else if (type === 'pending-out') {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-sm-icon decline'; cancelBtn.title = 'Cancel request';
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    cancelBtn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'friendships', user.friendshipId));
      card.remove();
      showToast('Request cancelled.');
    });
    actions.appendChild(cancelBtn);
  }

  card.appendChild(av);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

// Friend tabs
document.querySelectorAll('.friends-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const panel = tab.dataset.ftab;
    document.querySelectorAll('.friends-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(panel).classList.remove('hidden');
    loadFriendPanel(panel);
  });
});

// Friend search
document.getElementById('friend-search-btn').addEventListener('click', searchFriends);
document.getElementById('friend-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });

async function searchFriends() {
  const input = document.getElementById('friend-search-input').value.trim().toLowerCase();
  const results = document.getElementById('friend-search-results');
  if (!input) { results.innerHTML = ''; return; }

  results.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';

  // Fuzzy search — get all users starting with prefix, prioritize closer matches
  const q = query(collection(db, 'users'),
    where('usernameLower', '>=', input),
    where('usernameLower', '<=', input + '\uf8ff'),
    limit(20));
  const snap = await getDocs(q);

  const users = [];
  snap.forEach(d => {
    if (d.id !== ME.uid) users.push({ uid: d.id, ...d.data() });
  });

  // Sort by closeness (shorter = more exact)
  users.sort((a, b) => a.username.length - b.username.length);

  results.innerHTML = '';
  if (!users.length) {
    results.innerHTML = '<p style="color:var(--text3);font-size:14px;text-align:center;padding:20px">No users found.</p>';
    return;
  }

  for (const user of users) {
    const card = document.createElement('div');
    card.className = 'user-card';
    const av = document.createElement('div');
    av.className = 'avatar';
    setAvatar(av, user.username);

    const info = document.createElement('div');
    info.className = 'user-card-info';
    info.innerHTML = `<div class="user-card-name">${user.username}</div><div class="user-card-sub">WConnect member</div>`;

    // Check friendship status
    const status = await getFriendshipStatus(user.uid);
    const actions = document.createElement('div');
    actions.className = 'user-card-actions';

    if (status === 'accepted') {
      const b = document.createElement('button');
      b.className = 'btn-primary sm'; b.textContent = 'Friends ✓'; b.disabled = true;
      actions.appendChild(b);
    } else if (status === 'pending_out') {
      const b = document.createElement('button');
      b.className = 'btn-ghost sm'; b.textContent = 'Requested';
      actions.appendChild(b);
    } else if (status === 'pending_in') {
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn-primary sm'; acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', async () => {
        const fId = await getFriendshipId(user.uid);
        if (fId) { await updateDoc(doc(db, 'friendships', fId), { status: 'accepted' }); showToast('Friend added!', 'success'); acceptBtn.textContent = 'Friends ✓'; acceptBtn.disabled = true; }
      });
      actions.appendChild(acceptBtn);
    } else {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-primary sm'; addBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add';
      addBtn.addEventListener('click', async () => {
        await addDoc(collection(db, 'friendships'), {
          from: ME.uid, to: user.uid,
          members: [ME.uid, user.uid],
          status: 'pending', createdAt: serverTimestamp()
        });
        addBtn.textContent = 'Requested';
        addBtn.disabled = true;
        showToast(`Friend request sent to ${user.username}!`, 'success');
      });
      actions.appendChild(addBtn);
    }

    card.appendChild(av); card.appendChild(info); card.appendChild(actions);
    results.appendChild(card);
  }
}

async function getFriendshipStatus(otherId) {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', ME.uid));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const data = d.data();
    if (data.members.includes(otherId)) {
      if (data.status === 'accepted') return 'accepted';
      if (data.status === 'pending') return data.from === ME.uid ? 'pending_out' : 'pending_in';
    }
  }
  return 'none';
}

async function getFriendshipId(otherId) {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', ME.uid));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    if (d.data().members.includes(otherId)) return d.id;
  }
  return null;
}

// ─── DISCOVER ───────────────────────────────────────────────────────
async function searchUsers(term) {
  const container = document.getElementById('discover-results');
  container.innerHTML = '<div class="spinner" style="margin:30px auto"></div>';

  let q;
  if (term.trim()) {
    const t = term.toLowerCase();
    q = query(collection(db, 'users'), where('usernameLower', '>=', t), where('usernameLower', '<=', t + '\uf8ff'), limit(30));
  } else {
    q = query(collection(db, 'users'), limit(30));
  }

  const snap = await getDocs(q);
  container.innerHTML = '';

  const users = [];
  snap.forEach(d => { if (d.id !== ME.uid) users.push({ uid: d.id, ...d.data() }); });

  if (term.trim()) users.sort((a, b) => {
    const tl = term.toLowerCase();
    const am = a.username.toLowerCase().startsWith(tl) ? 0 : 1;
    const bm = b.username.toLowerCase().startsWith(tl) ? 0 : 1;
    return am - bm || a.username.length - b.username.length;
  });

  if (!users.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-users"></i><p>No users found.</p></div>`;
    return;
  }

  for (const user of users) {
    const card = document.createElement('div');
    card.className = 'user-card';
    const av = document.createElement('div');
    av.className = 'avatar';
    setAvatar(av, user.username);

    const info = document.createElement('div');
    info.className = 'user-card-info';
    info.innerHTML = `<div class="user-card-name">${user.username}</div><div class="user-card-sub">${user.isPro ? '⭐ Pro' : 'Member'}</div>`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary sm'; addBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
    addBtn.addEventListener('click', async () => {
      const status = await getFriendshipStatus(user.uid);
      if (status !== 'none') { showToast('Already connected.'); return; }
      await addDoc(collection(db, 'friendships'), {
        from: ME.uid, to: user.uid, members: [ME.uid, user.uid], status: 'pending', createdAt: serverTimestamp()
      });
      showToast(`Request sent to ${user.username}!`, 'success');
    });

    card.appendChild(av); card.appendChild(info); card.appendChild(addBtn);
    container.appendChild(card);
  }
}

// ─── AI CHAT ────────────────────────────────────────────────────────
document.getElementById('ai-send').addEventListener('click', sendAI);
document.getElementById('ai-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendAI(); });
document.getElementById('ai-clear-btn').addEventListener('click', () => {
  aiHistory = [];
  const container = document.getElementById('ai-messages');
  container.innerHTML = `<div class="ai-welcome"><div class="ai-avatar"><i class="fa-solid fa-robot"></i></div><p>Hi! I'm your WConnect AI. Ask me anything!</p></div>`;
});

async function sendAI() {
  const input = document.getElementById('ai-input');
  const text = input.value.trim();
  if (!text) return;

  const apiKey = window._wcAiKey;
  if (!apiKey) {
    showToast('Enter your Anthropic API key in AI settings first.', 'error');
    document.querySelector('[data-view="settings"]').click();
    return;
  }

  input.value = '';
  const container = document.getElementById('ai-messages');
  container.querySelector('.ai-welcome')?.remove();

  container.appendChild(buildMsg({ text, username: PROFILE?.displayName || PROFILE?.username || 'You', uid: ME.uid, createdAt: null }, true));
  aiHistory.push({ role: 'user', content: text });

  const typing = document.createElement('div');
  typing.className = 'msg ai-msg';
  typing.innerHTML = `<div class="avatar sm" style="background:linear-gradient(135deg,var(--accent),#6366f1)"><i class="fa-solid fa-robot" style="font-size:10px"></i></div>
    <div class="msg-content"><div class="msg-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div></div>`;
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: 'You are a helpful AI assistant built into WConnect, a chat platform. Be friendly, concise, and helpful.',
        messages: aiHistory
      })
    });
    const data = await resp.json();
    const reply = data.content?.[0]?.text || 'Sorry, I had trouble responding.';
    aiHistory.push({ role: 'assistant', content: reply });
    typing.remove();
    container.appendChild(buildMsg({ text: reply, username: 'AI', uid: '__ai__', createdAt: null }, false, true));
  } catch(e) {
    typing.remove();
    container.appendChild(buildMsg({ text: `Error: ${e.message}`, username: 'AI', uid: '__ai__', createdAt: null }, false, true));
  }
  container.scrollTop = container.scrollHeight;
}

// ─── SETTINGS ───────────────────────────────────────────────────────
// Theme toggle
document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeToggle;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wc-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Color swatches
document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    const color = sw.dataset.color;
    document.documentElement.setAttribute('data-color', color);
    localStorage.setItem('wc-color', color);
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });
});

// Restore saved preferences
const savedTheme = localStorage.getItem('wc-theme') || 'light';
const savedColor = localStorage.getItem('wc-color') || 'blue';
document.documentElement.setAttribute('data-theme', savedTheme);
document.documentElement.setAttribute('data-color', savedColor);
document.querySelector(`[data-theme-toggle="${savedTheme}"]`)?.classList.add('active');
document.querySelector(`[data-color="${savedColor}"]`)?.classList.add('active');

// Save display name
document.getElementById('save-displayname-btn')?.addEventListener('click', async () => {
  const displayName = document.getElementById('settings-displayname').value.trim();
  if (!displayName) { showToast('Enter a display name.', 'error'); return; }
  if (displayName.length > 32) { showToast('Max 32 characters.', 'error'); return; }
  try {
    await updateDoc(doc(db, 'users', ME.uid), { displayName });
    // Refresh local profile immediately
    const freshSnap = await getDoc(doc(db, 'users', ME.uid));
    if (freshSnap.exists()) PROFILE = freshSnap.data();
    // Update sidebar name
    const el = document.getElementById('sidebar-username');
    if (el) el.textContent = displayName;
    showToast('Display name updated! New messages will use it.', 'success');
  } catch(e) {
    showToast('Error saving display name.', 'error');
  }
});

// Change username
async function initUsernameChangeSection() {
  const statusEl = document.getElementById('username-change-status');
  const formEl = document.getElementById('username-change-form');
  const permEl = document.getElementById('settings-perm-username');
  if (!statusEl || !PROFILE) return;

  if (permEl) permEl.textContent = PROFILE.username || '';

  const lastChanged = PROFILE.usernameChangedAt?.toDate ? PROFILE.usernameChangedAt.toDate() : null;
  const now = new Date();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  if (lastChanged && (now - lastChanged) < ONE_WEEK_MS) {
    const nextChange = new Date(lastChanged.getTime() + ONE_WEEK_MS);
    const daysLeft = Math.ceil((nextChange - now) / (1000 * 60 * 60 * 24));
    statusEl.innerHTML = `⏳ You changed your username recently. You can change it again in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> (${nextChange.toLocaleDateString()}).`;
    if (formEl) {
      formEl.querySelector('input').disabled = true;
      formEl.querySelector('button').disabled = true;
      formEl.style.opacity = '0.5';
    }
  } else {
    statusEl.textContent = lastChanged
      ? `Last changed: ${lastChanged.toLocaleDateString()}. You can change it now.`
      : 'You haven\'t changed your username yet.';
  }
}

document.getElementById('save-username-btn')?.addEventListener('click', async () => {
  const newUsername = document.getElementById('settings-new-username').value.trim();
  if (!newUsername) { showToast('Enter a new username.', 'error'); return; }
  if (newUsername.length < 3) { showToast('Username must be at least 3 characters.', 'error'); return; }
  if (newUsername.length > 20) { showToast('Username can be at most 20 characters.', 'error'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) { showToast('Only letters, numbers, and underscores allowed.', 'error'); return; }
  if (newUsername.toLowerCase() === PROFILE?.username?.toLowerCase()) { showToast('That\'s already your username.', 'error'); return; }

  // Re-check cooldown server-side by re-fetching profile
  const freshSnap = await getDoc(doc(db, 'users', ME.uid));
  if (!freshSnap.exists()) { showToast('Could not verify your account.', 'error'); return; }
  const freshProfile = freshSnap.data();
  const lastChanged = freshProfile.usernameChangedAt?.toDate ? freshProfile.usernameChangedAt.toDate() : null;
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  if (lastChanged && (new Date() - lastChanged) < ONE_WEEK_MS) {
    showToast('You can only change your username once per week.', 'error');
    return;
  }

  // Check uniqueness
  const taken = await getDocs(query(collection(db, 'users'), where('usernameLower', '==', newUsername.toLowerCase())));
  if (!taken.empty) { showToast('That username is already taken. Try another.', 'error'); return; }

  const btn = document.getElementById('save-username-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await updateDoc(doc(db, 'users', ME.uid), {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      usernameChangedAt: serverTimestamp(),
    });
    // Refresh local profile
    const updated = await getDoc(doc(db, 'users', ME.uid));
    if (updated.exists()) PROFILE = updated.data();
    // Update UI
    document.getElementById('settings-perm-username').textContent = newUsername;
    document.getElementById('settings-username-display').textContent = newUsername;
    document.getElementById('settings-new-username').value = '';
    showToast('Username changed successfully!', 'success');
    initUsernameChangeSection(); // re-render cooldown info
  } catch(e) {
    showToast('Error changing username: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Change';
  }
});

// Load saved AI key
window._wcAiKey = localStorage.getItem('wc-ai-key') || '';
const keyInput = document.getElementById('ai-api-key-input');
if (keyInput && window._wcAiKey) keyInput.value = window._wcAiKey;

document.getElementById('save-ai-key-btn')?.addEventListener('click', () => {
  const key = document.getElementById('ai-api-key-input').value.trim();
  if (!key.startsWith('sk-ant-')) { showToast('That doesn\'t look like a valid key. It should start with sk-ant-', 'error'); return; }
  window._wcAiKey = key;
  localStorage.setItem('wc-ai-key', key);
  showToast('API key saved! AI chat is ready.', 'success');
});

// Save email
document.getElementById('save-email-btn').addEventListener('click', async () => {
  const email = document.getElementById('settings-email').value.trim();
  const notif = document.getElementById('email-notif').checked;
  if (!email) { showToast('Enter an email.', 'error'); return; }
  try {
    await updateDoc(doc(db, 'users', ME.uid), { email, emailNotif: notif });
    showToast('Email saved!', 'success');
  } catch(e) {
    showToast('Error saving email.', 'error');
  }
});

// Monetization placeholders
document.getElementById('buy-pro-btn')?.addEventListener('click', () => {
  showToast('Payment coming soon! 🎉');
  // TODO: integrate Stripe or similar
});
document.getElementById('donate-btn')?.addEventListener('click', () => {
  window.open('https://www.paypal.com/donate', '_blank');
});

// ─── Utilities ──────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
