# HousehuntLabeler

A local full-stack app that processes Gmail emails for house-hunting: labels them "to review", detects PDF attachments, and flags emails containing property-type keywords (terraced, link-attached, end-terraced).

No external AI services or credits required at runtime — all processing is direct Gmail API calls.

## Prerequisites

- **Node.js** >= 18
- A **Google Cloud project** with:
  - Gmail API enabled
  - OAuth 2.0 Client ID (Web application type)
  - Authorized JavaScript origin: `http://localhost:5173`
  - Authorized redirect URI: `http://localhost:5173`

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
- `GOOGLE_CLIENT_ID` — your OAuth client ID
- `GOOGLE_CLIENT_SECRET` — your OAuth client secret
- `ENCRYPTION_KEY` — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```bash
npm install
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2. Frontend

```bash
cd frontend
```

Create `.env`:
```
VITE_GOOGLE_CLIENT_ID=your-client-id-here
```

```bash
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Usage

1. Open `http://localhost:5173`
2. Click **Sign in with Google** and grant Gmail access
3. Click **Process 10 Oldest Emails**
4. View results and logs in the UI

## Labels Applied

| Condition | Labels added |
|-----------|-------------|
| Every email | `to review` |
| Has PDF attachment | `attachment` |
| Body contains "terraced", "link-attached", or "end-terraced" | `reject` + `not detached` |

## Security

- Refresh tokens are encrypted with AES-256-GCM and stored locally at `~/.local-gmail-app/credentials.enc`
- No secrets stored in the frontend
- All Gmail API calls go directly from your machine to Google
