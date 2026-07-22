import requests
import time
import sys

API_URL = "http://localhost:8007/stories/execute"

payload = {
    "story": "Create a python module `hello.py` that has a function `greet()` returning 'Hello World'. Also create a test `test_hello.py` that asserts `greet() == 'Hello World'`.",
    "repo_path": "./dummy_repo",
    "branch_name": "feature/hello-world",
    "test_command": "pytest test_hello.py"
}

try:
    print("Sending request to API...")
    res = requests.post(API_URL, json=payload, timeout=10)
    print("Response Status:", res.status_code)
    print("Response JSON:", res.json())
except Exception as e:
    print("Error:", e)
    sys.exit(1)
