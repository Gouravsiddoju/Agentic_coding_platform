import requests
import json
from pprint import pprint

URL = "http://192.168.1.117:8006/api/chat"
MODEL = "OptGPT-4:latest"

def run_test(name, payload):
    print(f"\n{'='*50}\nTEST: {name}\n{'='*50}")
    try:
        response = requests.post(URL, json=payload, headers={"Content-Type": "application/json"})
        print(f"Status Code: {response.status_code}")
        try:
            data = response.json()
            pprint(data)
        except:
            print("Raw response:", response.text)
    except Exception as e:
        print("Exception:", e)

# TEST 1: Baseline Chat
run_test("Baseline Logic", {
    "model": MODEL,
    "messages": [
        {"role": "user", "content": "What is 25 * 4?"}
    ],
    "stream": False
})

# TEST 2: Native Tool Support
# Many endpoints built around Ollama or OpenAI support a `tools` parameter.
run_test("Native Tools Parameter Support", {
    "model": MODEL,
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo?"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"}
                    },
                    "required": ["location"]
                }
            }
        }
    ],
    "stream": False
})

# TEST 3: ReAct Pattern Support
react_prompt = """You have access to the following tools. To use a tool, output a JSON block wrapped in <tool_call> tags.
<tool_call>
{"name": "tool_name", "args": {"arg1": "value1"}}
</tool_call>

Tools:
- name: read_file
  description: Reads a file from the disk.
  args:
    path: string

If you don't need a tool, just respond normally.
"""

run_test("ReAct JSON Formatting", {
    "model": MODEL,
    "messages": [
        {"role": "system", "content": react_prompt},
        {"role": "user", "content": "Can you read the file main.py?"}
    ],
    "stream": False
})
