"""
LLMService — public facade used by all agents.

Delegates to OllamaClient under the hood so every agent gets:
  - generate_completion()  → single-turn prompt/response
  - chat()                 → multi-turn string response
  - agent_chat()           → multi-turn with optional tool_calls (returns full message dict)

Error handling: on OllamaError we log and return a safe fallback so the
calling agent can decide whether to retry or surface the error.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .ollama_client import OllamaClient, OllamaError

logger = logging.getLogger(__name__)


class LLMService:

    # ------------------------------------------------------------------ #
    #  generate_completion — single-turn, used by Architect/Repair/Intent #
    # ------------------------------------------------------------------ #

    @staticmethod
    def generate_completion(
        prompt: str,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Single-turn completion.  Returns the model's text, or an error string
        prefixed with 'Error:' so callers can detect failure.
        """
        try:
            return OllamaClient.generate(prompt=prompt, system_prompt=system_prompt)
        except OllamaError as exc:
            logger.error("LLMService.generate_completion failed: %s", exc)
            return f"Error: {exc}"

    # ------------------------------------------------------------------ #
    #  chat — multi-turn, returns just the text content string            #
    # ------------------------------------------------------------------ #

    @staticmethod
    def chat(messages: List[Dict[str, str]]) -> str:
        """
        Multi-turn chat, returns the assistant's text content only.
        """
        try:
            msg = OllamaClient.chat(messages=messages)
            return msg.get("content", "")
        except OllamaError as exc:
            logger.error("LLMService.chat failed: %s", exc)
            return f"Error: {exc}"

    # ------------------------------------------------------------------ #
    #  agent_chat — multi-turn with tool_calls support                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    def agent_chat(
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Multi-turn chat that can return tool_calls.
        Returns the full Ollama message dict:
          {"role": "assistant", "content": "...", "tool_calls": [...]}
        On error, returns a safe assistant message with the error text.
        """
        try:
            return OllamaClient.chat(messages=messages, tools=tools)
        except OllamaError as exc:
            logger.error("LLMService.agent_chat failed: %s", exc)
            return {"role": "assistant", "content": f"Error reaching Ollama: {exc}"}


if __name__ == "__main__":
    import sys

    print("Testing Ollama connection...")

    if not OllamaClient.health_check():
        print("ERROR: Ollama is not running. Start it with: ollama serve")
        sys.exit(1)

    models = OllamaClient.list_models()
    if not models:
        print("No models installed. Pull one with: ollama pull codellama:7b")
        sys.exit(1)

    print(f"Available models: {models}")
    result = LLMService.generate_completion("Say 'Hello from CodeMe!'")
    print(f"Response: {result}")
