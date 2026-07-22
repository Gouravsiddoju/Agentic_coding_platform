import json
import os
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

class ConfigManager:
    CONFIG_FILE = ".optcode"
    
    _default_config = {
        "safe_mode": False,
        "llm_model": os.getenv("OPTCODE_LLM_MODEL", "OptGPT-4:latest"),
        "llm_api_url": os.getenv("OPTCODE_LLM_API_URL", "http://192.168.1.117:8006/api/generate"),
        "llm_chat_api_url": os.getenv("OPTCODE_LLM_CHAT_API_URL", "http://192.168.1.117:8006/api/chat"),
        "repo_path": "."
    }

    @classmethod
    def load_config(cls) -> Dict[str, Any]:
        """Loads configuration from the local .optcode file, or returns defaults."""
        if os.path.exists(cls.CONFIG_FILE):
            try:
                with open(cls.CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    # Merge with defaults
                    config = cls._default_config.copy()
                    config.update(data)
                    return config
            except Exception:
                pass
        return cls._default_config.copy()

    @classmethod
    def save_config(cls, config: Dict[str, Any]):
        """Saves configuration to the local .optcode file."""
        with open(cls.CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=4)

    @classmethod
    def get(cls, key: str) -> Any:
        config = cls.load_config()
        return config.get(key, cls._default_config.get(key))

    @classmethod
    def set(cls, key: str, value: Any):
        config = cls.load_config()
        config[key] = value
        cls.save_config(config)

    @classmethod
    def is_safe_mode(cls) -> bool:
        return bool(cls.get("safe_mode"))

    @classmethod
    def toggle_safe_mode(cls) -> bool:
        current = cls.is_safe_mode()
        cls.set("safe_mode", not current)
    @classmethod
    def get_llm_model(cls) -> str:
        return cls.get("llm_model")
        
    @classmethod
    def get_llm_api_url(cls) -> str:
        return cls.get("llm_api_url")
        
    @classmethod
    def get_llm_chat_api_url(cls) -> str:
        return cls.get("llm_chat_api_url")
