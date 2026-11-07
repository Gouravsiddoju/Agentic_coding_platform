import json
from typing import Dict, Any
from .llm_service import LLMService
from .agents import _strip_json

class RootCauseAnalyzer:
    @staticmethod
    def analyze_failure(failure_log: str, command: str, repo_context: str = "") -> Dict[str, Any]:
        """
        Analyzes a test or build failure log and determines the root cause.
        """
        system_prompt = (
            "You are an expert Software Reliability Engineer. "
            "Given a failure log, the command that failed, and optional codebase context, "
            "produce a Root Cause Analysis in pure JSON format ONLY:\n"
            "{\n"
            "  \"root_cause\": \"...\",\n"
            "  \"affected_files\": [\"file1.py\", \"file2.py\"],\n"
            "  \"proposed_fix\": \"...\"\n"
            "}\n"
            "Do NOT include any markdown formatting, output pure JSON."
        )
        
        prompt = f"Command: {command}\n\nFailure Log:\n{failure_log}\n\nContext:\n{repo_context}"
        response = LLMService.generate_completion(prompt, system_prompt)
        
        try:
            analysis = json.loads(_strip_json(response))
            return analysis
        except Exception as e:
            return {
                "root_cause": f"Failed to parse RCA: {e}\nRaw: {response}",
                "affected_files": [],
                "proposed_fix": ""
            }
