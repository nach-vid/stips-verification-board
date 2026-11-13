# Stips Verification & Raw Message Board

A full-stack web application featuring Stips profile verification via web scraping and an unstyled community message board, backed by Node.js, Express, and Firebase Firestore.

## Strict Aesthetic Rule
- **100% Unstyled, Bare-bones UI**: No CSS frameworks, no custom stylesheets, no inline styles, no design elements. Pure raw HTML elements only (`<form>`, `<input>`, `<button>`, `<ul>`, `<li>`, `<img>`, etc.), relying exclusively on native browser defaults and standard HTML5 attributes like `hidden`.

## Features
1. **Stips Verification**:
   - User inputs their Stips profile ID or link (e.g. `428498`).
   - Server generates a unique verification code (`STIPS-XXXXX`).
   - User pastes the code into their Stips profile bio/status.
   - Server verifies the code via lightweight Axios and Cheerio HTTP requests without any headless browser overhead.
2. **Account Hijacking Prevention & Persistent Login**:
   - Cryptographically secure 256-bit session token generated upon verification.
   - Token stored in Firestore `users` collection and client `localStorage` (plus secure httpOnly cookie).
   - Once claimed, accounts cannot be re-verified or hijacked by other sessions.
   - On page refresh or revisit, `GET /api/me` validates the token and auto-logs the user directly into the message board.
3. **Message Board**:
   - Users post messages to Firestore collection `messages`.
   - Author identity (`username`, `profilePic`, `userId`) is verified against the database session token to prevent spoofing.

---

## Production & Cloud Deployment Configuration

This project is built to deploy seamlessly to cloud providers such as **Render, Railway, Heroku, Fly.io, Vercel, or Google Cloud Run**.

### Environment Variables

Configure the following variables in your hosting provider's dashboard or in a `.env` file:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Web server port (default: `3000`) | `3000` |
| `FIREBASE_SERVICE_ACCOUNT` | **Recommended**: Complete JSON string of your Firebase Service Account key | `'{"type":"service_account","project_id":...}'` |
| `FIREBASE_PROJECT_ID` | Alternative: Firebase Project ID | `my-stips-app` |
| `FIREBASE_CLIENT_EMAIL` | Alternative: Service account client email | `firebase-adminsdk@my-stips-app.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Alternative: Service account private key string | `"-----BEGIN PRIVATE KEY-----\n..."` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative: File path to JSON key | `/etc/secrets/serviceAccountKey.json` |

> [!NOTE]
> **Safe Local Fallback**: If no Firebase credentials are configured in your environment, the app automatically switches to an in-memory database mock so local development never breaks!

---

## Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your web browser.
