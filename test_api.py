import requests

# Change this to your actual product view ID (check admin panel)
PRODUCT_VIEW_ID = 1

# Path to any PNG/JPG image on your PC to use as the design
DESIGN_IMAGE_PATH = "Your Image Path Here"

url = "http://127.0.0.1:8000/api/customize/"

with open(DESIGN_IMAGE_PATH, 'rb') as f:
    response = requests.post(url, data={
        'product_view_id': PRODUCT_VIEW_ID
    }, files={
        'design': f
    })

print("Status:", response.status_code)
print("Response:", response.json())