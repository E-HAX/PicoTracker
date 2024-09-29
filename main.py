from scraping import scrape_picoctf_data
from sheets import update_sheet

username = "mauray"  # Replace with your username

# Scrape data
easy_data, medium_data, hard_data = scrape_picoctf_data(username)
print(f"Fetched Data: Easy: {easy_data}, Medium: {medium_data}, Hard: {hard_data}")
# Update Google Sheets
update_sheet(username, easy_data, medium_data, hard_data)
