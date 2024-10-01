import os
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials

def setup_google_sheets():
    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
    ]

    creds_dict = json.loads(os.getenv('GOOGLE_SHEETS_CREDENTIALS'))
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)

    client = gspread.authorize(creds)

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
            row_index = existing_users.index(username) + 1
            current_data = sheet.row_values(row_index)[1:4]
            current_data = [
                int(val) if val.strip().isdigit() else 0 
                for val in current_data
            ]

            if all(val == 0 for val in current_data):
                print(f"Existing data is all zeros for {username}, skipping update.")
                return

            sheet.update_cell(row_index, 2, easy_data)
            sheet.update_cell(row_index, 3, medium_data)
            sheet.update_cell(row_index, 4, hard_data)
        else:
            sheet.append_row([username, easy_data, medium_data, hard_data])

        print("Data has been written to Google Sheets.")
    except Exception as e:
        print(f"An error occurred while writing to Google Sheets: {e}")
