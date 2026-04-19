# WConnect — Chat Platform

## Features
- ✅ Login / Signup (email/password, Google, anonymous)
- ✅ Global chat (everyone on the site)
- ✅ Direct messages
- ✅ Group chats (create from friends list, leave anytime)
- ✅ Friend system (send/accept/decline requests, inbox persists)
- ✅ Discover all users (fuzzy search, prioritizes closer matches)
- ✅ AI chat (Claude-powered)
- ✅ Light/Dark mode + 6 accent colors
- ✅ Email settings + notification opt-in
- ✅ Monetization placeholders (Pro upgrade, donations)

---

## Setup (Firebase Console — Do These First!)

### 1. Firestore Rules
Go to **Firestore → Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /global/{msgId} {
      allow read, write: if request.auth != null;
    }
    match /dms/{dmId} {
      allow read, write: if request.auth != null && request.auth.uid in resource.data.members;
      allow create: if request.auth != null;
      match /messages/{msgId} {
        allow read, write: if request.auth != null;
      }
    }
    match /groups/{groupId} {
      allow read: if request.auth != null && request.auth.uid in resource.data.members;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      match /messages/{msgId} {
        allow read, write: if request.auth != null;
      }
    }
    match /friendships/{fId} {
      allow read: if request.auth != null && request.auth.uid in resource.data.members;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && request.auth.uid in resource.data.members;
    }
  }
}
```

### 2. Realtime Database Rules
Go to **Realtime Database → Rules**:

```json
{
  "rules": {
    "presence": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

### 3. Firestore Indexes
Go to **Firestore → Indexes** and create composite indexes for:
- Collection: `dms` | Fields: `members` (array-contains), `lastAt` (desc)
- Collection: `groups` | Fields: `members` (array-contains)
- Collection: `friendships` | Fields: `members` (array-contains), `status`
- Collection: `friendships` | Fields: `to`, `status`
- Collection: `friendships` | Fields: `from`, `status`
- Collection: `global` | Fields: `createdAt` (desc)
- Collection: `users` | Fields: `usernameLower` (asc)

*(Firestore will also prompt you with index links when queries fail — click them!)*

### 4. Authentication
Enable in Firebase Console → Authentication → Sign-in methods:
- Email/Password ✅
- Google ✅
- Anonymous ✅

### 5. Add Authorized Domains
Firebase → Authentication → Settings → Authorized domains:
Add your Railway domain (e.g. `yourapp.up.railway.app`)
Add `localhost` for local testing

---

## Testing Locally (GitHub / VS Code)

You can open `index.html` directly in a browser — BUT because of ES modules + Firebase, you need a local server:

### Option A: VS Code Live Server
Install the "Live Server" extension → right-click `index.html` → Open with Live Server

### Option B: Python
```bash
python -m http.server 8080
# Then open http://localhost:8080
```

### Option C: Node
```bash
npx serve .
```

---

## Deploying to Railway

1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Railway will detect it's a static site
5. Set the **Start Command** to: `npx serve . -p $PORT`
6. Or add a `railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": { "startCommand": "npx serve . -p $PORT", "healthcheckPath": "/" }
}
```

---

## AI Chat
The AI uses the Anthropic API. You need to:
1. Get an API key at console.anthropic.com
2. **For production**: Never expose API keys client-side! Set up a backend proxy:
   - Create a simple Node/Express server on Railway
   - Proxy `/api/ai` → Anthropic API with your key in env vars
3. **For testing only**: The current setup calls the API directly (fine for personal testing, not for public launch)

---

## Adding Monetization
- **Pro subscriptions**: Integrate [Stripe](https://stripe.com) — create a checkout session server-side
- **Donations**: Update the PayPal donate link in settings with your actual PayPal.me link
- **Pro badge**: Check `user.isPro` in Firestore and show crown badge on profiles

---

## File Structure
```
wconnect/
├── index.html          ← Main app (single page)
├── css/
│   └── main.css        ← All styles
├── js/
│   ├── firebase-init.js ← Firebase setup
│   ├── auth.js         ← Login/signup logic
│   └── app.js          ← Main app logic
└── README.md           ← This file
```
