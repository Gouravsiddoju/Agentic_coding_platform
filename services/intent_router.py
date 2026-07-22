import json
from typing import Dict, Any, Optional
from services.llm_service import LLMService

class IntentRouter:
    @staticmethod
    def route_intent(user_input: str) -> Dict[str, str]:
        """
        Analyzes the user's natural language input to determine if they want to:
        - IMPLEMENT: Build, create, or modify code features.
        - FIX: Debug, repair, or fix an issue.
        - CHAT: Just converse, explain, or ask a question.
        
        Returns a dictionary like {"intent": "IMPLEMENT", "target": "extracted instruction"}
        """
        system_prompt = """You are an Intent Router for an autonomous Software Engineering Agent.
Analyze the user's input and classify their intent into one of four categories:
1. "CREATE": The user is asking to scaffold or create an entire project from scratch (e.g. "Create a new React project", "Build a fastAPI backend from scratch").
2. "IMPLEMENT": The user is asking to build or modify code within an EXISTING project (e.g. "Create a login page", "Add a button to the header").
3. "FIX": The user is asking to debug or fix a broken feature/tests (e.g. "Fix the login bug", "Tests are failing").
4. "CHAT": The user is asking a general question, asking for an explanation, or conversing without wanting you to write code autonomously.

Return ONLY a valid JSON object in the following format:
{
    "intent": "CREATE" | "IMPLEMENT" | "FIX" | "CHAT",
    "target": "The exact core instruction extracted from the user's input, removing conversational fluff."
}
"""
        try:
            response = LLMService.generate_completion(user_input, system_prompt=system_prompt)
            # Clean up the response in case the LLM returned markdown blocks
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
                
            data = json.loads(response.strip())
            return {
                "intent": data.get("intent", "CHAT"),
                "target": data.get("target", user_input)
            }
        except Exception as e:
            # Fallback to chat if routing fails
            return {"intent": "CHAT", "target": user_input}
