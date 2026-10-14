import os
import re
import csv
import glob
import time
import json
import difflib
import requests
from urllib.parse import quote
from datetime import datetime, timezone

BASE_URL = os.getenv("CYLAB_API_BASE", "https://learn.cylabacademy.org")
HEADERS = {"Accept": "application/json", "User-Agent": "CylabLeaderboard/1.0"}
if os.getenv("SESSION_ID"):
    HEADERS["Cookie"] = f"session={os.getenv('SESSION_ID')}"
USERNAME_PATTERN = re.compile(r'^[a-zA-Z0-9_\-\.]{1,50}$')

def is_valid_username(name):
    return bool(name and isinstance(name, str) and USERNAME_PATTERN.match(name.strip()))

def _get_json(path, retries=3):
    for attempt in range(retries):
        try:
            resp = requests.get(BASE_URL + path, headers=HEADERS, timeout=12)
            if resp.status_code in (401, 403, 404):
                return None
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            time.sleep(2 ** attempt)
    return None

def fetch_user_stats(username):
    cleaned_name = username.strip()
    if not is_valid_username(cleaned_name):
        print(f"Skipping invalid username: {cleaned_name}")
        return None

    user = _get_json(f"/api/users/{quote(cleaned_name, safe='')}/")
    if not user or "id" not in user:
        return None
    
    try:
        user_id = int(user["id"])
    except (ValueError, TypeError):
        return None

    stats = _get_json(f"/api/users/{user_id}/gym_stats/")
    if not stats:
        return None
    
    # Extract stats from the API response safely
    d = stats.get("by_difficulty", {})
    try:
        easy = max(0, int(d.get("1", {}).get("solved", 0)))
        medium = max(0, int(d.get("2", {}).get("solved", 0)))
        hard = max(0, int(d.get("3", {}).get("solved", 0)))
    except (ValueError, TypeError):
        easy, medium, hard = 0, 0, 0

    return easy, medium, hard

def setup_google_sheets():
    try:
        import gspread
        from oauth2client.service_account import ServiceAccountCredentials
    except ImportError:
        return None

    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
    ]
    
    creds_json = os.getenv('GOOGLE_SHEETS_CREDENTIALS') or os.getenv('GCP_CREDENTIALS')
    if not creds_json:
        return None
        
    try:
        creds_dict = json.loads(creds_json)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
        client = gspread.authorize(creds)
        sheet_id = os.getenv('GOOGLE_SHEET_ID', '1mGFL1nzCJ315z9Uakj_vlny9W752I1J99a0KRr6JSD8')
        return client.open_by_key(sheet_id)
    except Exception as e:
        print(f"Google Sheets auth error: {e}")
        return None

def fetch_usernames_from_sheet(start_row=2, end_row=500):
    try:
        doc = setup_google_sheets()
        if not doc:
            return []
        sheet = doc.get_worksheet(2)
        usernames = sheet.col_values(1)[start_row-1:end_row]
        return [u.strip() for u in usernames if is_valid_username(u)]
    except Exception as e:
        print(f"Error fetching roster from sheet: {e}")
        return []

USERNAME_ALIASES = {
    "nichehacker2501": "nicehacker2501",
    "smoothb": "smoothbrain01",
}

def load_roster_from_sheet(preferred_csv="Cylab Username - Sheet1.csv"):
    candidates = []
    if os.path.exists(preferred_csv):
        candidates.append(preferred_csv)
    for f in glob.glob("*.csv"):
        if f not in candidates:
            candidates.append(f)
            
    entries = []
    seen = set()
    
    for file_path in candidates:
        if not os.path.exists(file_path):
            continue
        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                for row in reader:
                    if not row or len(row) < 1:
                        continue
                    u_raw = row[0].strip()
                    n_raw = row[1].strip() if len(row) > 1 else ""
                    if u_raw.lower() in ("username", "user", "handle") and n_raw.lower() in ("name", "real name", ""):
                        continue
                    if not u_raw:
                        continue
                    resolved_u = USERNAME_ALIASES.get(u_raw.lower(), u_raw)
                    if not is_valid_username(resolved_u):
                        continue
                    if resolved_u.lower() not in seen:
                        seen.add(resolved_u.lower())
                        entries.append({
                            "username": resolved_u,
                            "name": n_raw if n_raw else "Busy Person"
                        })
            if entries:
                break
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    return entries

def get_name_mapping(usernames):
    name_map = {}
    if os.path.exists("leaderboard.json"):
        try:
            with open("leaderboard.json", "r") as f:
                old_data = json.load(f)
                for entry in old_data.get("leaderboard", []):
                    u = entry.get("username")
                    n = entry.get("name")
                    if u and n:
                        name_map[u.strip()] = n.strip()
        except Exception:
            pass

    csv_files = glob.glob("*.csv")
    sheet_entries = []
    for csv_file in csv_files:
        try:
            with open(csv_file, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) >= 2:
                        u_raw = row[0].strip()
                        n_raw = row[1].strip()
                        if u_raw.lower() in ("username", "user", "handle") and n_raw.lower() in ("name", "real name"):
                            continue
                        if u_raw and n_raw:
                            resolved_u = USERNAME_ALIASES.get(u_raw.lower(), u_raw)
                            sheet_entries.append((resolved_u, n_raw))
        except Exception:
            pass

    if sheet_entries:
        used_sheet = set()
        for u in usernames:
            for idx, (su, sname) in enumerate(sheet_entries):
                if su.lower() == u.lower():
                    name_map[u] = sname
                    used_sheet.add(idx)
                    break

        remaining_sheet = [(idx, su, sname) for idx, (su, sname) in enumerate(sheet_entries) if idx not in used_sheet]
        remaining_roster = [u for u in usernames if u not in name_map or name_map.get(u) == "Busy Person"]

        for idx, su, sname in remaining_sheet:
            prefix_match = [r for r in remaining_roster if r.lower().startswith(su.lower()) or su.lower().startswith(r.lower())]
            if prefix_match:
                matched = prefix_match[0]
                name_map[matched] = sname
                if matched in remaining_roster:
                    remaining_roster.remove(matched)
            else:
                closest = difflib.get_close_matches(su.lower(), [r.lower() for r in remaining_roster], n=1, cutoff=0.7)
                if closest:
                    matched = [r for r in remaining_roster if r.lower() == closest[0]][0]
                    name_map[matched] = sname
                    if matched in remaining_roster:
                        remaining_roster.remove(matched)

    for u in usernames:
        if u not in name_map or not name_map[u]:
            name_map[u] = "Busy Person"

    return name_map

def main():
    # Primary roster source: local CSV sheet
    roster_entries = load_roster_from_sheet()

    # Optional Google Sheets fallback if no local CSV found
    if not roster_entries:
        usernames = fetch_usernames_from_sheet(start_row=2, end_row=500)
        name_map = get_name_mapping(usernames)
        roster_entries = [{"username": u, "name": name_map.get(u, "Busy Person")} for u in usernames]

    if not roster_entries:
        print("Roster is empty. Add a CSV sheet (e.g. Cylab Username - Sheet1.csv).")
        return

    # Fallback to existing leaderboard.json names if name is Busy Person
    old_names = {}
    if os.path.exists("leaderboard.json"):
        try:
            with open("leaderboard.json", "r") as f:
                for entry in json.load(f).get("leaderboard", []):
                    u = entry.get("username")
                    n = entry.get("name")
                    if u and n and n != "Busy Person":
                        old_names[u.lower()] = n
        except Exception:
            pass

    leaderboard = []
    for item in roster_entries:
        username = item["username"]
        real_name = item.get("name")
        if not real_name or real_name == "Busy Person":
            real_name = old_names.get(username.lower(), "Busy Person")

        print(f"Fetching stats for {username} ({real_name})...")
        result = fetch_user_stats(username)
        if result:
            easy, medium, hard = result
            total_points = (easy * 1) + (medium * 3) + (hard * 6)
            leaderboard.append({
                "username": username,
                "name": real_name,
                "easy": easy,
                "medium": medium,
                "hard": hard,
                "total": total_points
            })
        else:
            leaderboard.append({
                "username": username,
                "name": real_name,
                "easy": 0,
                "medium": 0,
                "hard": 0,
                "total": 0
            })
        time.sleep(0.3)

    leaderboard.sort(key=lambda x: (x['total'], x['hard'], x['medium'], x['easy']), reverse=True)

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "leaderboard": leaderboard
    }

    # Atomic write to prevent file corruption
    tmp_path = "leaderboard.json.tmp"
    with open(tmp_path, "w") as f:
        json.dump(output, f, indent=2)
    os.replace(tmp_path, "leaderboard.json")
    
    print(f"Successfully generated leaderboard.json with {len(leaderboard)} users.")

if __name__ == "__main__":
    main()

