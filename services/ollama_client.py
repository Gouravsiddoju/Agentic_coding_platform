"""
OllamaClient — thin, reliable wrapper around the Ollama REST API.

Supports:
  - generate()     → /api/generate  (single-turn completion)
  - chat()         → /api/chat      (multi-turn with optional tool_calls)
  - embed()        → /api/embed     (document embeddings for RAG)
  - list_models()  → /api/tags      (installed models)
  - health_check() → /              (is Ollama running?)

All methods raise OllamaError on hard failures so callers can handle them
cleanly rather than silently getting empty strings.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

OLLAMA_DEFAULT_URL = os.getenv("CODEME_OLLAMA_URL", "http://localhost:11434")
OLLAMA_DEFAULT_MODEL = os.getenv("CODEME_OLLAMA_MODEL", "codellama:7b")
OLLAMA_DEFAULT_TIMEOUT = int(os.getenv("CODEME_OLLAMA_TIMEOUT", "300"))
OLLAMA_CTX_SIZE = int(os.getenv("CODEME_OLLAMA_CTX", "32768"))


class OllamaError(RuntimeError):
    """Raised when Ollama returns an error or is unreachable."""


class OllamaClient:
    """
    Stateless Ollama API client.  All methods are classmethods so it can be
    used without instantiation, matching the existing LLMService pattern.
    """

    # ------------------------------------------------------------------ #
    #  Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    @classmethod
    def _base_url(cls) -> str:
        from .config import ConfigManager
        return ConfigManager.get_ollama_url().rstrip("/")

    @classmethod
    def _model(cls) -> str:
        from .config import ConfigManager
        return ConfigManager.get_llm_model()

    @classmethod
    def _post(cls, path: str, payload: Dict[str, Any], timeout: int = OLLAMA_DEFAULT_TIMEOUT) -> Dict[str, Any]:
        url = f"{cls._base_url()}{path}"
        try:
            response = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=timeout,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.ConnectionError:
            raise OllamaError(
                f"Cannot connect to Ollama at {cls._base_url()}. "
                "Make sure `ollama serve` is running."
            )
        except requests.exceptions.Timeout:
            raise OllamaError(f"Ollama request timed out after {timeout}s (path={path}).")
        except requests.exceptions.HTTPError as exc:
            body = ""
            try:
                body = exc.response.text[:500]
            except Exception:
                pass
            raise OllamaError(f"Ollama HTTP {exc.response.status_code}: {body}") from exc

    @classmethod
    def _get(cls, path: str, timeout: int = 10) -> Dict[str, Any]:
        url = f"{cls._base_url()}{path}"
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.ConnectionError:
            raise OllamaError(
                f"Cannot connect to Ollama at {cls._base_url()}. "
                "Make sure `ollama serve` is running."
            )
        except Exception as exc:
            raise OllamaError(str(exc)) from exc

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    @classmethod
    def health_check(cls) -> bool:
        """Returns True if Ollama is reachable, False otherwise."""
        try:
            requests.get(f"{cls._base_url()}/", timeout=5)
            return True
        except Exception:
            return False

    @classmethod
    def list_models(cls) -> List[str]:
        """Returns a list of locally installed model names."""
        try:
            data = cls._get("/api/tags")
            return [m["name"] for m in data.get("models", [])]
        except OllamaError:
            return []

    @classmethod
    def generate(
        cls,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Single-turn text completion via /api/generate.
        Returns the response string or raises OllamaError.
        """
        payload: Dict[str, Any] = {
            "model": model or cls._model(),
            "prompt": prompt,
            "stream": False,
            "options": options or {"num_ctx": OLLAMA_CTX_SIZE},
        }
        if system_prompt:
            payload["system"] = system_prompt

        data = cls._post("/api/generate", payload)
        return data.get("response", "")

    @classmethod
    def chat(
        cls,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Multi-turn chat via /api/chat.
        Supports Ollama tool_calls (model must support them, e.g. qwen2.5-coder).
        Returns the full message dict from Ollama.
        """
        payload: Dict[str, Any] = {
            "model": model or cls._model(),
            "messages": messages,
            "stream": False,
            "options": options or {"num_ctx": OLLAMA_CTX_SIZE},
        }
        if tools:
            payload["tools"] = tools

        data = cls._post("/api/chat", payload)
        return data.get("message", {})

    @classmethod
    def embed(
        cls,
        texts: List[str],
        model: Optional[str] = None,
    ) -> List[List[float]]:
        """
        Generate embeddings for a list of texts via /api/embed.
        Falls back to /api/embeddings (legacy single-string endpoint) if needed.
        Returns a list of float vectors.
        """
        embed_model = model or os.getenv("CODEME_EMBED_MODEL", cls._model())
        payload: Dict[str, Any] = {
            "model": embed_model,
            "input": texts,
        }
        try:
            data = cls._post("/api/embed", payload)
            return data.get("embeddings", [])
        except OllamaError:
            # Fallback: legacy /api/embeddings (one at a time)
            results = []
            for text in texts:
                legacy_payload = {"model": embed_model, "prompt": text}
                data = cls._post("/api/embeddings", legacy_payload)
                results.append(data.get("embedding", []))
            return results
