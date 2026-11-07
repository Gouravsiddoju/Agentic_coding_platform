"""
ConfigManager — reads/writes .codeme config file and env vars.

Priority order (highest first):
  1. Environment variable  (CODEME_*)
  2. .codeme file in cwd
  3. Hard-coded defaults below
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv()


class ConfigManager:
    CONFIG_FILE = ".codeme"

    _default_config: Dict[str, Any] = {
        "safe_mode": False,
        # Ollama server (local)
        "ollama_url": os.getenv("CODEME_OLLAMA_URL", "http://localhost:11434"),
        # Model used for generation and chat.
        # Recommended: codellama:7b, qwen2.5-coder:7b, deepseek-coder:6.7b, llama3.2:3b
        "llm_model": os.getenv("CODEME_LLM_MODEL", os.getenv("OPTCODE_LLM_MODEL", "codellama:7b")),
        # Embedding model (used by RepoIntelligenceEngine).
        # nomic-embed-text is small and good; mxbai-embed-large is higher quality.
        "embed_model": os.getenv("CODEME_EMBED_MODEL", "nomic-embed-text"),
        "repo_path": ".",
    }

    # ------------------------------------------------------------------ #
    #  Load / save                                                         #
    # ------------------------------------------------------------------ #

    @classmethod
    def load_config(cls) -> Dict[str, Any]:
        """Loads configuration from the local .codeme file, merging with defaults."""
        if os.path.exists(cls.CONFIG_FILE):
            try:
                with open(cls.CONFIG_FILE, "r") as f:
                    data = json.load(f)
                config = cls._default_config.copy()
                config.update(data)
                return config
            except Exception:
                pass
        return cls._default_config.copy()

    @classmethod
    def save_config(cls, config: Dict[str, Any]) -> None:
        """Saves configuration to the local .codeme file."""
        with open(cls.CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)

    @classmethod
    def get(cls, key: str) -> Any:
        config = cls.load_config()
        return config.get(key, cls._default_config.get(key))

    @classmethod
    def set(cls, key: str, value: Any) -> None:
        config = cls.load_config()
        config[key] = value
        cls.save_config(config)

    # ------------------------------------------------------------------ #
    #  Typed accessors                                                     #
    # ------------------------------------------------------------------ #

    @classmethod
    def is_safe_mode(cls) -> bool:
        return bool(cls.get("safe_mode"))

    @classmethod
    def toggle_safe_mode(cls) -> bool:
        new_value = not cls.is_safe_mode()
        cls.set("safe_mode", new_value)
        return new_value

    @classmethod
    def get_ollama_url(cls) -> str:
        return cls.get("ollama_url")

    @classmethod
    def get_llm_model(cls) -> str:
        return cls.get("llm_model")

    @classmethod
    def get_embed_model(cls) -> str:
        return cls.get("embed_model")

    # Legacy shims — kept so nothing breaks if old code calls these
    @classmethod
    def get_llm_api_url(cls) -> str:
        return f"{cls.get_ollama_url()}/api/generate"

    @classmethod
    def get_llm_chat_api_url(cls) -> str:
        return f"{cls.get_ollama_url()}/api/chat"

    # ------------------------------------------------------------------ #
    #  Model management helpers                                            #
    # ------------------------------------------------------------------ #

    @classmethod
    def list_available_models(cls) -> List[str]:
        """Returns models currently installed in the local Ollama instance."""
        from .ollama_client import OllamaClient
        return OllamaClient.list_models()

    @classmethod
    def set_model(cls, model_name: str) -> None:
        """Persists a new model choice to .codeme."""
        cls.set("llm_model", model_name)
        print(f"Model set to: {model_name}")

    @classmethod
    def set_embed_model(cls, model_name: str) -> None:
        """Persists a new embedding model choice to .codeme."""
        cls.set("embed_model", model_name)
        print(f"Embed model set to: {model_name}")
