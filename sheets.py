import os
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials

def setup_google_sheets():
    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
    ]
    
    # Load credentials from the environment variable (GOOGLE_SHEETS_CREDENTIALS)
    creds_dict = json.loads(os.getenv('GOOGLE_SHEETS_CREDENTIALS'))
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    
    # Authorize the client with the credentials
    client = gspread.authorize(creds)
    
    # Open the spreadsheet by its ID
    sheet_id = '1s9sGp8t9SieFUGzdjxeC_c30BbnDO-912DUhMvUZfUk'
    return client.open_by_key(sheet_id)

def fetch_usernames(start_row, end_row):
    try:
        sheet = setup_google_sheets().get_worksheet(1)
        usernames = sheet.col_values(1)[start_row-1:end_row]
        return usernames
    except Exception as e:
        print(f"An error occurred while fetching usernames: {e}")
        return []

def update_sheet(username, easy_data, medium_data, hard_data):
    try:
        sheet = setup_google_sheets().get_worksheet(0)
    
        existing_users = sheet.col_values(1)

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

