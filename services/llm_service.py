import requests
from typing import Optional, List, Dict, Any
from .config import ConfigManager

class LLMService:

    @staticmethod
    def generate_completion(prompt: str, system_prompt: Optional[str] = None) -> str:
        """
        Sends a prompt to the custom LLM endpoint and returns the generated text.
        """
        payload = {
            "model": ConfigManager.get_llm_model(),
            "prompt": prompt,
            "stream": False,
            "options": {"num_ctx": 32768}
        }
        
        if system_prompt:
            payload["system"] = system_prompt

        try:
            api_url = ConfigManager.get_llm_api_url()
            response = requests.post(
                api_url, 
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=300
            )
            response.raise_for_status()
            
            data = response.json()
            return data.get("response", "")
            
        except requests.exceptions.RequestException as e:
            return f"Error: Unable to reach LLM at {api_url}. Details: {e}"

    @staticmethod
    def chat(messages: List[Dict[str, str]]) -> str:
        """
        Sends a chat payload to the LLM endpoint.
        """
        payload = {
            "model": ConfigManager.get_llm_model(),
            "messages": messages,
            "stream": False,
            "options": {"num_ctx": 32768}
        }
        
        try:
            api_url = ConfigManager.get_llm_chat_api_url()
            response = requests.post(
                api_url, 
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=300
            )
            response.raise_for_status()
            
            data = response.json()
            return data.get("message", {}).get("content", "")
            
        except requests.exceptions.RequestException as e:
            return f"Error: Unable to reach LLM at {api_url}. Details: {e}"

    @staticmethod
    def agent_chat(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Sends a chat payload with optional tools to the LLM endpoint and returns the full message object.
        """
        payload = {
            "model": ConfigManager.get_llm_model(),
            "messages": messages,
            "stream": False,
            "options": {"num_ctx": 32768}
        }
        
        if tools:
            payload["tools"] = tools
            
        try:
            api_url = ConfigManager.get_llm_chat_api_url()
            response = requests.post(
                api_url, 
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=300
            )
            response.raise_for_status()
            
            data = response.json()
            return data.get("message", {})
            
        except requests.exceptions.RequestException as e:
            return {"role": "assistant", "content": f"Error reaching API: {e}"}

if __name__ == "__main__":
    # Simple test
    print("Testing LLM Connection...")
    res = LLMService.generate_completion("Say 'Hello from OPTCode!'")
    print("Response:", res)
