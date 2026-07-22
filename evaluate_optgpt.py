import requests
from time import time

URL = "http://192.168.1.117:8006/api/chat"
MODEL = "OptGPT-4:latest"

def evaluate_model(test_name, prompt):
    print(f"\n{'='*60}")
    print(f"TEST: {test_name}")
    print(f"{'='*60}")
    
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False
    }
    
    start_time = time()
    try:
        response = requests.post(URL, json=payload, headers={"Content-Type": "application/json"})
        end_time = time()
        
        if response.status_code == 200:
            data = response.json()
            content = data.get("message", {}).get("content", "")
            thinking = data.get("message", {}).get("thinking", "No thinking trace")
            
            print(f"Time taken: {end_time - start_time:.2f} seconds\n")
            print("THINKING TRACE:")
            print("-" * 40)
            print(thinking)
            print("\nFINAL OUTPUT:")
            print("-" * 40)
            print(content)
        else:
            print(f"Error HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"Connection Error: {e}")

if __name__ == "__main__":
    
    # 1. Complex Algorithmic Coding
    evaluate_model(
        "Complex Algorithmic Coding",
        "Write a highly optimized Python function to find the longest palindromic substring in a given string. Include type hints and explain the time complexity (e.g. O(N^2) dynamic programming or expand around center)."
    )
    
    # 2. Subtle Code Debugging
    evaluate_model(
        "Subtle Code Debugging",
        "Can you find the bug in this Python code? Explain why it happens and how to fix it.\n\n"
        "def append_item(item, item_list=[]):\n"
        "    item_list.append(item)\n"
        "    return item_list\n\n"
        "print(append_item(1))\n"
        "print(append_item(2))\n"
    )
    
    # 3. Logical Reasoning
    evaluate_model(
        "Logical Reasoning",
        "A man is looking at a photograph of someone. His friend asks who it is. The man replies, 'Brothers and sisters, I have none. But that man's father is my father's son.' Who is in the photograph? Walk through your reasoning step-by-step."
    )
    
    # 4. Architecture / System Design
    evaluate_model(
        "Architecture & System Design",
        "I am building a chat application like Discord. Should I use WebSockets, Server-Sent Events (SSE), or Long Polling for the real-time messaging layer? Compare them and make a definitive recommendation for this specific use case."
    )
