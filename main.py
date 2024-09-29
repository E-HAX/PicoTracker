from scraping import scrape_picoctf_data
from sheets import fetch_usernames, update_sheet

# Fetch usernames from Sheet 2 (rows 2 to 48)
usernames = fetch_usernames(start_row=2, end_row=49)

for username in usernames:
    easy_data, medium_data, hard_data = scrape_picoctf_data(username)
    # Output the fetched data
    print(f"Fetched Data for {username}: Easy: {easy_data}, Medium: {medium_data}, Hard: {hard_data}")
    # Update Google Sheets with the fetched data
    update_sheet(username, easy_data, medium_data, hard_data)
