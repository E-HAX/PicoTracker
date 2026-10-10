import os
import re
import time
import json
import requests
from urllib.parse import quote
from datetime import datetime

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

def main():
    usernames = fetch_usernames_from_sheet(start_row=2, end_row=500)

    if not usernames:
        try:
            with open("roster.txt", "r") as f:
                usernames = [line.strip() for line in f if is_valid_username(line.strip())]
        except FileNotFoundError:
            pass

    if not usernames:
        print("Roster is empty. Add valid usernames to roster.txt.")
        return

    # Deduplicate while preserving order
    seen = set()
    unique_usernames = []
    for u in usernames:
        if u.lower() not in seen:
            seen.add(u.lower())
            unique_usernames.append(u)

    leaderboard = []
    for username in unique_usernames:
        print(f"Fetching stats for {username}...")
        result = fetch_user_stats(username)
        if result:
            easy, medium, hard = result
            total_points = (easy * 1) + (medium * 3) + (hard * 6)
            leaderboard.append({
                "username": username,
                "easy": easy,
                "medium": medium,
                "hard": hard,
                "total": total_points
            })
        else:
            leaderboard.append({
                "username": username,
                "easy": 0,
                "medium": 0,
                "hard": 0,
                "total": 0
            })
        time.sleep(0.3)

    leaderboard.sort(key=lambda x: (x['total'], x['hard'], x['medium'], x['easy']), reverse=True)

    output = {
        "last_updated": datetime.utcnow().isoformat() + "Z",
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
