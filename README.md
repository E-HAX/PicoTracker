PicoTracker
===========

**PicoTracker** is a project that uses GitHub Actions to run a script that updates Google Sheets with data from the CyLab Security Academy (formerly picoCTF). This tool automates fetching participant challenge data and storing it in a convenient format for easy access and analysis.

Project Structure
-----------------

*   **`main.py`**: The main script that coordinates fetching stats and updating Google Sheets.
*   **`requirements.txt`**: A list of Python packages required for the project.
*   **`scraping.py`**: Fetches per-user solved-challenge counts from the CyLab Security Academy API.
*   **`sheets.py`**: Contains the code to interact with the Google Sheets API.

Setup Instructions
------------------

1.  **Clone the repository**:

    ```
    git clone https://github.com/yourusername/PicoTracker.git
    cd PicoTracker
    ```

2.  **Install dependencies**: Make sure you have Python installed, then install the required packages:
    
    `pip3 install -r requirements.txt`
    
3.  **Google API Credentials**:
    
    *   Create a Google Cloud project and enable the Google Sheets API.
    *   Generate a service account key in JSON format.
    *   Share your spreadsheet with the service account's email address as an Editor.
    *   Export the key file contents as an environment variable:
    
    `export GOOGLE_SHEETS_CREDENTIALS="$(cat /path/to/your-key.json)"`

4.  **GitHub Actions**: To let the workflow run the tracker automatically on every push to `main`, add a repository secret named `GOOGLE_SHEETS_CREDENTIALS` (Settings → Secrets and variables → Actions) containing the key file's full JSON contents.

Google Sheet Structure
----------------------

The spreadsheet has two worksheets:

*   **Second worksheet (index 1)** — the roster: a `Username` column with one participant per row, starting at row 2. Add or remove participants here; the script reads every non-empty row.
*   **First worksheet (index 0)** — the results: `Username | Easy | Medium | Hard` columns. The script keeps exactly one row per roster member:
    *   Participants with solved challenges get their counts written.
    *   Participants who haven't started get `0 / 0 / 0`.
    *   Accounts the platform can't find get a blank row so they stand out.
    *   A failed fetch never overwrites existing progress with zeros.

Usage
-----

To run the main script and fill the Google Sheets with participant data, use the following command:

`python3 main.py`

Notes
-----

*   Data comes from the public API at `learn.cylabacademy.org`; no browser or login is required.
*   The project is designed to run in a Python 3.9+ environment; ensure compatibility with your setup.

License
-------

This project is licensed under the MIT License. See the LICENSE file for more details.

Contributing
------------

Feel free to submit issues or pull requests to improve the project!

Acknowledgments
---------------

*   Thanks to [gspread](https://gspread.readthedocs.io/en/latest/) for Google Sheets API interaction.
