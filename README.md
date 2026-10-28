# EHAX &times; CyLab Academy Leaderboard

A high-performance, secure cybersecurity leaderboard and automated tracker for CyLab Security Academy / PicoCTF challenges. Features a 3D wireframe interactive scene, custom vector podium chalices, live operator search, attendance totals and history, tactile Web Audio feedback, and automated stats aggregation.

---

## ⚡ Features

- **Weighted Fair Scoring System**:
  - `EASY` = 1 PT
  - `MEDIUM` = 3 PTS
  - `HARD` = 6 PTS
- **3D Perspective Scene**:
  - Interactive WebGL/Canvas wireframe globe with orbital rings and mouse parallax.
  - Perspective floor grid and geometric tesseract visuals.
- **Top 3 Podium Chalices**:
  - Custom multi-gradient vector chalices for Gold (#1), Silver (#2), and Bronze (#3) with 3D tilt.
- **Operator HUD & Drawer**:
  - Click on any operator to open an inspect drawer with challenge breakdown and academy standing.
- **Live Search & Filter**:
  - Instant client-side search with match counter and keyboard navigation.
- **Hardened Architecture**:
  - Strict Content Security Policy (CSP), anti-MIME sniffing, no-referrer privacy, and DOM-safe encoding.
  - Score data stays static; attendance is served by a read-only public API, while the admin console uses a separately authenticated API.
- **Automated Updates**:
  - GitHub Actions runs every 15 minutes or instantly when `Cylab Username - Sheet1.csv` is updated.

---

## 🔐 Attendance Console + Public Attendance

The admin console is deliberately **not linked anywhere on the public
leaderboard** and remains password-protected. The leaderboard itself now shows
each operator's total attendance and a read-only attendance history in the
operator drawer.

- Console URL: `/console` (or `/console.html`)
- The console shows only a password gate until the admin authenticates.
- The roster is loaded from `leaderboard.json`, so usernames and real names
  always match the leaderboard.
- Meetings and marks are stored server-side in a **private Vercel Blob store**.
- The public leaderboard reads a sanitized, read-only feed from
  `/api/attendance`; it never receives meeting IDs, admin sessions, rate-limit
  data, or the private Blob URL.
- The console is marked `noindex`, `noarchive`, and `no-store`.

### Security model

- **Password**: stored only as a scrypt hash in a Vercel environment variable.
  The plaintext password is never committed and never leaves the browser
  except in the login request over HTTPS.
- **Sessions**: HMAC-signed `HttpOnly` cookies, signed with a key derived from
  the password hash. The cookie is `Secure` in production, `SameSite=Strict`,
  uses the `__Host-` prefix, and is a browser-session cookie.
- **Logout**: clearing the cookie also bumps a server-side session epoch in the
  Blob state, invalidating every outstanding signed session.
- **CSRF**: every authenticated state-changing request needs a session-bound
  CSRF token. Same-origin checks are enforced for all POST requests, including
  login.
- **Brute force**: login attempts are rate limited per IP using a private Blob
  record.
- **Password rotation**: changing the password hash immediately invalidates
  all existing admin sessions.
- **Public feed**: `/api/attendance` is GET-only and exposes only meeting dates,
  labels, and P/R statuses for usernames on the public leaderboard. It cannot
  mutate attendance.
- **Data integrity**: the UI prevents double-submits, and every mutation
  reloads the latest server state. This is a single-admin console, so if two
  tabs are open, the last write wins.
- **No admin client storage**: the console keeps its working data in memory
  only. It is wiped from the DOM when the session expires or is locked.
- **Export**: CSV export happens locally in the browser.

### One-time deployment setup

1. **Create the Blob store**

   In Vercel, open **Storage → Create → Blob**. Choose **Private** access
   (important), create the store, and connect it to this project. Vercel adds
   `BLOB_STORE_ID` and the rotating OIDC credentials automatically.

   On the Hobby plan, Blob includes 1 GB storage, 10K reads, and 2K writes per
   month. For 5–10 meetings this app uses only a tiny fraction of that.

2. **Generate the admin password hash**

   ```bash
   node scripts/hash-password.mjs
   ```

   It will prompt `Admin password:`. Type your password and press Enter.
   Nothing will appear on screen while you type; that is intentional. Then copy
   the printed `ATTENDANCE_ADMIN_PASSWORD_HASH=...` value.

   Or use the Python helper (same hash format):

   ```bash
   python3 scripts/hash_password.py
   ```

3. **Add Vercel environment variables**

   In **Project → Settings → Environment Variables**, add:

   | Variable | Required | Purpose |
   |---|---|---|
   | `ATTENDANCE_ADMIN_PASSWORD_HASH` | Yes | scrypt password hash |
   | `ATTENDANCE_SESSION_HOURS` | No | Session lifetime, default `4`, max `24` |
   | `ATTENDANCE_BLOB_PATH` | No | Override the state Blob path |
   | `ATTENDANCE_RATE_BLOB_PATH` | No | Override the rate-limit Blob path |

   The Blob connection variables (`BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN`) are
   added automatically when you connect the store. Do not commit them. If your
   project does not provide OIDC credentials, add the store's
   `BLOB_READ_WRITE_TOKEN` as an environment variable instead.

   Use a long, unique password (20+ characters). For a quick temporary setup
   only, `ATTENDANCE_ADMIN_PASSWORD` is also accepted, but the hash is the
   recommended production option.

4. **Redeploy** and open `/console`.

If `ATTENDANCE_ADMIN_PASSWORD_HASH` or the Blob connection is missing, the
console fails closed with a configuration error instead of falling back to an
insecure mode.

### Day-to-day use

1. Open `/console` and authenticate.
2. Press **+ NEW DATE**, choose the meeting date, and optionally add a label.
3. Search for an operator by username or real name.
4. Use the **P / R / A** buttons on each person's row. New dates start as
   all **A**, so pressing **A** again unmarks anyone marked by mistake.
   Bulk buttons affect only the rows currently visible in the search and ask
   for confirmation.
5. Press **DONE / SAVE** — either at the top or in the sticky bottom bar — to
   commit the date.
6. **OVERVIEW / TOTALS** shows `P / total meetings` per operator, plus P, R,
   and A counts. It can export a CSV report.
7. The public leaderboard shows each operator's attendance total in the
   standings, on the podium, and in the operator drawer. The drawer also lists
   every meeting date and label with P/R/A status.
8. **EDIT DATE** and **DELETE** can be used at any time.

### Wiping or moving attendance data

- The state lives in the private Blob path
  `attendance/<VERCEL_ENV>/state-v1.json`.
- Rate-limit data lives at `attendance/<VERCEL_ENV>/rate-v1.json`.
- Delete those Blobs in the Vercel Blob store to wipe the console data.
- Changing `ATTENDANCE_BLOB_PATH` starts a separate namespace; it does not
  migrate existing data.
- Changing the password hash invalidates sessions but does **not** delete
  attendance data.

### Local development

The public leaderboard still works with a plain static server:

```bash
python3 -m http.server 8080
```

The leaderboard itself loads this way, but the attendance column will show
`—` because `/api/attendance` is not available from a plain static server.
The console and public attendance API require the Vercel serverless runtime and
Blob. For local development, copy `BLOB_READ_WRITE_TOKEN` from the Blob store
and export it with your password hash, then run:

```bash
# Generate the hash once with: node scripts/hash-password.mjs
export ATTENDANCE_ADMIN_PASSWORD_HASH='scrypt$...'
export BLOB_READ_WRITE_TOKEN='vercel_blob_rw_...'
vercel dev
```

On Vercel, the rotating OIDC credentials are used automatically instead.

---

## 📁 Repository Structure

```text
├── index.html                   # Main leaderboard frontend
├── styles.css                   # Cyber dark-mode stylesheet & 3D animations
├── script.js                    # Web Audio, 3D particles, and client-side rendering
├── console.html                 # Owner-only console shell (not linked publicly)
├── console.css                  # Private console styling
├── console.js                   # Private console client logic
├── api/
│   ├── console.js               # Authenticated attendance API + Blob storage
│   └── attendance.js            # Public read-only attendance feed
├── scripts/
│   ├── hash-password.mjs        # scrypt admin-password hash generator (Node)
│   └── hash_password.py         # same generator (Python)
├── ehax-wordmark.png            # Transparent brand wordmark
├── logo.png                     # Brand asset
├── leaderboard.json             # Live scored leaderboard data snapshot
├── Cylab Username - Sheet1.csv  # Primary participant roster & name mappings
├── roster.txt                   # Participant usernames roster
├── fetch_stats.py               # Automated stats scraper & weighted points engine
├── requirements.txt             # Python dependencies
├── package.json                 # Node metadata, Blob SDK dependency, hash helper
├── package-lock.json            # Locked Node dependency tree
├── .env.example                 # Console environment variable template
├── vercel.json                  # Security headers, route guards, API bundle
├── .vercelignore                # Prevents deployment of backend scripts & raw CSV
├── .github/
│   └── workflows/
│       └── update_leaderboard.yml # Automated CI/CD update workflow
└── README.md                    # Documentation
```

---

## ⚙️ GitHub Actions Automation Setup

The repository is configured to automatically fetch challenge stats and update `leaderboard.json`:
1. **Every 15 Minutes**: On a scheduled cron (`7,22,37,52 * * * *`).
2. **On Roster Changes**: Automatically triggers whenever usernames are added or removed in `Cylab Username - Sheet1.csv`.
3. **Manual Trigger**: Can be run anytime via the "Run workflow" button in the GitHub Actions tab.

### Step-by-Step Configuration

#### Step 1: Enable GitHub Actions Workflow Permissions
1. Navigate to your repository on GitHub: `https://github.com/E-HAX/PicoTracker`.
2. Click **Settings** (top tab) &rarr; **Actions** (left sidebar) &rarr; **General**.
3. Scroll down to **Workflow permissions**:
   - Select **Read and write permissions**.
   - Check **Allow GitHub Actions to create and approve pull requests**.
4. Click **Save**.

#### Step 2: Configure Optional Google Sheets Secret (If syncing from Google Sheets)
*Note: If you only use `Cylab Username - Sheet1.csv`, you can skip this step! The script automatically uses `Cylab Username - Sheet1.csv` as the primary source.*

1. Go to **Settings** &rarr; **Secrets and variables** &rarr; **Actions**.
2. Click **New repository secret**.
3. Name: `GOOGLE_SHEETS_CREDENTIALS`
4. Value: Paste your Google Service Account JSON key.
5. (Optional) Name: `GOOGLE_SHEET_ID`, Value: Your spreadsheet ID.
6. Click **Add secret**.

#### Step 3: Trigger Your First Automated Run
1. Go to the **Actions** tab on GitHub.
2. Under "All workflows", click **Update Leaderboard**.
3. Click the **Run workflow** dropdown on the right &rarr; Click **Run workflow**.
4. The workflow will execute, scrape the latest solves, calculate weighted points, and commit the updated `leaderboard.json`.

---

## 🚀 Local Development

To run the static leaderboard locally:

```bash
# Start a local HTTP server
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser.

To manually refresh stats from the command line:

```bash
pip install -r requirements.txt
python fetch_stats.py
```

---

## 🌐 Deployment (Vercel)

The site is production-ready for deployment on [Vercel](https://vercel.com):
- Connect the `E-HAX/PicoTracker` repository to Vercel.
- Framework Preset: **Other**.
- Root Directory: `./`.
- The bundled `vercel.json` applies strict security headers (`nosniff`, `DENY`, `no-referrer`, strict CSP) and blocks direct public access to backend scripts (`*.py`, `*.csv`).
- The owner-only console also needs the one-time private Blob + password setup described above. Without it, the console fails closed while the public leaderboard continues to work.
