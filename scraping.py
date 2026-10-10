import time
from urllib.parse import quote

import requests

BASE_URL = "https://learn.cylabacademy.org"
HEADERS = {"Accept": "application/json", "User-Agent": "PicoTracker/1.0"}


def _get_json(path, retries=3):
    for attempt in range(retries):
        try:
            resp = requests.get(BASE_URL + path, headers=HEADERS, timeout=30)
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
    user = _get_json(f"/api/users/{quote(username, safe='')}/")
    if not user or "id" not in user:
        print(f"User not found or inaccessible: {username}")
        return None
    stats = _get_json(f"/api/users/{user['id']}/gym_stats/")
    if not stats:
        return None
    d = stats["by_difficulty"]
    return int(d["1"]["solved"]), int(d["2"]["solved"]), int(d["3"]["solved"])
