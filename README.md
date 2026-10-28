# EHAX &times; CyLab Academy Leaderboard

A high-performance, secure, static cybersecurity leaderboard and automated tracker for CyLab Security Academy / PicoCTF challenges. Features a 3D wireframe interactive scene, custom vector podium chalices, live operator search, tactile Web Audio feedback, and automated stats aggregation.

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
  - The public leaderboard stays static; the private console uses a separately authenticated serverless API.
- **Automated Updates**:
  - GitHub Actions runs every 15 minutes or instantly when `Cylab Username - Sheet1.csv` is updated.

---

## 🔐 Private Attendance Console (Owner Only)

The attendance console is deliberately **not linked anywhere on the public
leaderboard**. It has no attendance data in the static HTML, CSS, JS,
`leaderboard.json`, or any other public asset.

- Console URL: `/console` (or `/console.html`)
- It shows only a password gate until the admin authenticates.
- The roster is loaded from `leaderboard.json`, so usernames and real names
  always match the leaderboard.
- Meetings and marks are stored server-side in Upstash Redis / Vercel KV.
- The console is marked `noindex`, `noarchive`, and `no-store`.

### Security model

- **Password**: stored only as a scrypt hash in a Vercel environment variable.
  The plaintext password is never committed and never leaves the browser
  except in the login request over HTTPS.
- **Sessions**: opaque 256-bit random session IDs stored server-side in Redis.
  The cookie is `HttpOnly`, `Secure` in production, `SameSite=Strict`, and
  uses the `__Host-` prefix.
- **CSRF**: every authenticated state-changing request needs a session-bound
  CSRF token. Same-origin checks are enforced for all POST requests, including
  login.
- **Brute force**: login attempts are rate limited per IP.
- **Password rotation**: changing the password hash immediately invalidates
  all existing admin sessions.
- **Data integrity**: optimistic revisions plus a short Redis write lock
  prevent two tabs from silently overwriting each other.
- **No client storage**: the console keeps attendance data in memory only.
  It is wiped from the DOM when the session expires or is locked.
- **Export**: CSV export happens locally in the browser.

### One-time deployment setup

1. **Create the database**

   In Vercel, open **Storage / Marketplace** and create an **Upstash Redis**
   database. Connect it to this project. The integration adds either:

   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN`

   Both naming styles are supported.

2. **Generate the admin password hash**

   ```bash
   read -s PW
   printf '%s' "$PW" | node scripts/hash-password.mjs
   unset PW
   ```

   Or use the Python helper (same hash format):

   ```bash
   read -s PW
   printf '%s' "$PW" | python3 scripts/hash_password.py
   unset PW
   ```

   Copy the printed `ATTENDANCE_ADMIN_PASSWORD_HASH=...` value.

3. **Add Vercel environment variables**

   In **Project → Settings → Environment Variables**, add:

   | Variable | Required | Purpose |
   |---|---|---|
   | `ATTENDANCE_ADMIN_PASSWORD_HASH` | Yes | scrypt password hash |
   | `UPSTASH_REDIS_REST_URL` | Yes* | Redis REST endpoint |
   | `UPSTASH_REDIS_REST_TOKEN` | Yes* | Redis REST token |
   | `ATTENDANCE_SESSION_HOURS` | No | Session lifetime, default `4`, max `24` |
   | `ATTENDANCE_DATA_KEY` | No | Override the Redis data key/namespace |

   \* Or use the equivalent `KV_REST_API_URL` / `KV_REST_API_TOKEN` names.

   Use a long, unique password (20+ characters). For a quick temporary setup
   only, `ATTENDANCE_ADMIN_PASSWORD` is also accepted, but the hash is the
   recommended production option.

4. **Redeploy** and open `/console`.

If `ATTENDANCE_ADMIN_PASSWORD_HASH` or Redis is missing, the console fails
closed with a configuration error instead of falling back to an insecure mode.

### Day-to-day use

1. Open `/console` and authenticate.
2. Press **+ NEW DATE**, choose the meeting date, and optionally add a label.
3. Search for an operator by username or real name.
4. Use **P** for present, **R** for the third status, or **A** for absent.
   New dates start as all **A**.
5. Press **DONE / SAVE** to commit the date.
6. **OVERVIEW / TOTALS** shows `P / total meetings` per operator, plus P, R,
   and A counts. It can export a CSV report.
7. **EDIT DATE** and **DELETE** can be used at any time.

### Wiping or moving attendance data

- The data lives in the Redis key
  `cylab:attendance:<VERCEL_ENV>:v1` (or `ATTENDANCE_DATA_KEY`).
- Delete that key in the Upstash console to wipe all attendance.
- Changing `ATTENDANCE_DATA_KEY` starts a separate namespace; it does not
  migrate existing data.
- Changing the password hash invalidates sessions but does **not** delete
  attendance data.

### Local development

The public leaderboard still works with a plain static server:

```bash
python3 -m http.server 8080
```

The console API requires the Vercel serverless runtime and Redis. Use the
Vercel CLI with the environment variables exported in your shell:

```bash
export ATTENDANCE_ADMIN_PASSWORD_HASH='scrypt$...'
export UPSTASH_REDIS_REST_URL='https://...'
export UPSTASH_REDIS_REST_TOKEN='...'
vercel dev
```

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
│   └── console.js               # Authenticated attendance API + Redis storage
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
├── package.json                 # Node metadata / hash-password helper
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
- The owner-only console also needs the one-time Redis + password setup described above. Without it, the console fails closed while the public leaderboard continues to work.
