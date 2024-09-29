from oauth2client.service_account import ServiceAccountCredentials
import gspread

def setup_google_sheets():
    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name('dynamic-radar-229914-b233874aa157.json', scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key('1s9sGp8t9SieFUGzdjxeC_c30BbnDO-912DUhMvUZfUk').sheet1
    return sheet

def update_sheet(username, easy_data, medium_data, hard_data):
  try:
    sheet = setup_google_sheets()
    
    # Get existing usernames
    existing_users = sheet.col_values(1)  # Get all usernames from the first column

    if username in existing_users:
        row_index = existing_users.index(username) + 1  # +1 for 1-indexing
        sheet.update_cell(row_index, 2, easy_data)  # Update Easy column
        sheet.update_cell(row_index, 3, medium_data)  # Update Medium column
        sheet.update_cell(row_index, 4, hard_data)  # Update Hard column
    else:
        # Append new row with username and challenges
        sheet.append_row([username, easy_data, medium_data, hard_data])

    print("Data has been written to Google Sheets.")

  except Exception as e:
    print(f"An error occurred while writing to Google Sheets: {e}")

# Example usage (data assumed to be from scraping.py)
# update_sheet(username, easy_data, medium_data, hard_data)