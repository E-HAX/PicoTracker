from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
import time

def scrape_difficulty_data(driver, difficulty_class):
  try:
    difficulty_element = driver.find_element(By.XPATH, f"//span[contains(@class, '{difficulty_class}')]")
    data = difficulty_element.text.split()[0]  # Extract only the number after difficulty name
  except NoSuchElementException:
    data = 0  # Assume zero if element not found

  return int(data)  # Now data will only contain the number

def scrape_picoctf_data(username):
  chrome_options = Options()
  # chrome_options.add_argument("--headless")  # Optional: Run headless
  service = Service('chromedriver')  # Replace with your ChromeDriver path
  driver = webdriver.Chrome(service=service, options=chrome_options)

  try:
    driver.get(f"https://play.picoctf.org/users/{username}")
    time.sleep(15)  # Wait for page to load

    easy_data = scrape_difficulty_data(driver, "difficulty-1")
    medium_data = scrape_difficulty_data(driver, "difficulty-2")
    hard_data = scrape_difficulty_data(driver, "difficulty-3")

    return easy_data, medium_data, hard_data

  finally:
    driver.quit()

# Example usage (assuming username is defined elsewhere)
# easy_data, medium_data, hard_data = scrape_picoctf_data(username)
# print(f"Fetched Data: {easy_data}, {medium_data}, {hard_data}")