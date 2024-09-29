from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
from random_user_agent.user_agent import UserAgent
from random_user_agent.params import SoftwareName, OperatingSystem
import time

# Generate a random User-Agent using the random-user-agent package
def get_random_user_agent():
    software_names = [SoftwareName.CHROME.value]  # You can add other browsers like Firefox, Edge, etc.
    operating_systems = [OperatingSystem.WINDOWS.value, OperatingSystem.LINUX.value, OperatingSystem.MAC.value]

    user_agent_rotator = UserAgent(software_names=software_names, operating_systems=operating_systems, limit=100)
    return user_agent_rotator.get_random_user_agent()

def scrape_difficulty_data(driver, difficulty_class):
    try:
        difficulty_element = driver.find_element(By.XPATH, f"//span[contains(@class, '{difficulty_class}')]")
        data = difficulty_element.text.split()[0]  # Extract only the number after difficulty name
    except NoSuchElementException:
        data = 0  # Assume zero if element not found
    return int(data)

def scrape_picoctf_data(username):
    chrome_options = Options()
    chrome_options.add_argument("--headless")  # Optional: Run headless if you don't need to see the browser window
    
    # Use a random User-Agent
    random_user_agent = get_random_user_agent()
    chrome_options.add_argument(f"user-agent={random_user_agent}")
    
    service = Service('chromedriver')  # Replace with your actual path to ChromeDriver
    driver = webdriver.Chrome(service=service, options=chrome_options)

    try:
        driver.get(f"https://play.picoctf.org/users/{username}")
        time.sleep(10)  # Wait for the page to fully load

        # Scrape the difficulty data for each level
        easy_data = scrape_difficulty_data(driver, "difficulty-1")
        medium_data = scrape_difficulty_data(driver, "difficulty-2")
        hard_data = scrape_difficulty_data(driver, "difficulty-3")

        return easy_data, medium_data, hard_data

    finally:
        driver.quit()

