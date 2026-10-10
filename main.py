from scraping import fetch_user_stats
from sheets import fetch_usernames, update_sheet, ensure_blank_row

# Fetch usernames from Sheet 3 (all non-empty rows starting at row 2)
usernames = [u for u in fetch_usernames(start_row=2, end_row=500) if u.strip()]

for username in usernames:
    result = fetch_user_stats(username)
    if result is None:
        ensure_blank_row(username)
        continue
    easy_data, medium_data, hard_data = result
    # Output the fetched data
    print(f"Fetched Data for {username}: Easy: {easy_data}, Medium: {medium_data}, Hard: {hard_data}")
    # Update Google Sheets with the fetched data
    update_sheet(username, easy_data, medium_data, hard_data)
