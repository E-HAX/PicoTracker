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
  - Zero sensitive backend endpoints exposed to the browser.
- **Automated Hourly Updates**:
  - GitHub Actions runs every hour or instantly when `Cylab Username - Sheet1.csv` is updated.

---

## 📁 Repository Structure

```text
├── index.html                   # Main leaderboard frontend
├── styles.css                   # Cyber dark-mode stylesheet & 3D animations
├── script.js                    # Web Audio, 3D particles, and client-side rendering
├── ehax-wordmark.png            # Transparent brand wordmark
├── logo.png                     # Brand asset
├── leaderboard.json             # Live scored leaderboard data snapshot
├── Cylab Username - Sheet1.csv  # Primary participant roster & name mappings
├── fetch_stats.py               # Automated stats scraper & weighted points engine
├── requirements.txt             # Python dependencies
├── vercel.json                  # Production security headers and route guards
├── .vercelignore                # Prevents deployment of backend scripts & raw CSV
├── .github/
│   └── workflows/
│       └── update_leaderboard.yml # Automated CI/CD update workflow
└── README.md                    # Documentation
```

---

## ⚙️ GitHub Actions Automation Setup

The repository is configured to automatically fetch challenge stats and update `leaderboard.json`:
1. **Every Hour**: On a scheduled cron (`0 * * * *`).
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
- The bundled `vercel.json` applies strict security headers (`nosniff`, `DENY`, `no-referrer`, strict CSP) and blocks direct public access to backend scripts (`fetch_stats.py`, `*.csv`).
