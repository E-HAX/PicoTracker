PicoTracker
===========

**PicoTracker** is a project that uses GitHub Actions to run a script that updates Google Sheets with data from PicoCTF. This tool automates the process of scraping user challenge data and storing it in a convenient format for easy access and analysis.

Project Structure
-----------------

*   **`chromedriver`**: The ChromeDriver executable required for Selenium automation.
*   **`credentials.json`**: Configuration file for Google API authentication.
*   **`main.py`**: The main script that coordinates the data scraping and updating of Google Sheets.
*   **`requirements.txt`**: A list of Python packages required for the project.
*   **`scraping.py`**: Contains the Selenium code to scrape data from PicoCTF.
*   **`sheets.py`**: Contains the code to interact with the Google Sheets API.

Setup Instructions
------------------

1.  **Clone the repository**:
    
    `git clone https://github.com/yourusername/PicoTracker.git cd PicoTracker`
    
2.  **Install dependencies**: Make sure you have Python installed, then install the required packages:
    
    `pip3 install -r requirements.txt`
    
3.  **Download ChromeDriver**: Download the ChromeDriver that matches your Chrome version from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/#stable). Place it in the root directory of this project or update the path in line 20 of `scraping.py`.
    
4.  **Google API Credentials**:
    
    *   Create a Google Cloud project and enable the Google Sheets API.
    *   Generate a service account key in JSON format.
    *   Rename this file to `dynamic-radar-229914-b233874aa157.json` and place it in the root directory.

Usage
-----

To run the main script and fill the Google Sheets with scraped data, use the following command:

`python3 main.py`

Notes
-----

*   Ensure that your Google Sheets have the appropriate permissions set for the service account to read and write data.
*   The project is designed to run in a Python 3.12 environment; ensure compatibility with your setup.

License
-------

This project is licensed under the MIT License. See the LICENSE file for more details.

Contributing
------------

Feel free to submit issues and pull requests to improve the project!

Acknowledgments
---------------

*   Thanks to [Selenium](https://www.selenium.dev/) for web scraping capabilities.
*   Thanks to [gspread](https://gspread.readthedocs.io/en/latest/) for Google Sheets API interaction.

* * *

Feel free to customize any sections further or add any additional information that may be relevant to your project!
