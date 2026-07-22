import os
import json
from typing import Dict, Any

class CodeStandardsEngine:
    DEFAULT_STANDARDS = {
        "python": [
            "Use type hints for all function signatures.",
            "Follow PEP 8 naming conventions.",
            "Include docstrings for all classes and public methods.",
            "Avoid broad except blocks without logging."
        ],
        "javascript": [
            "Use strict mode.",
            "Prefer const over let, and never use var.",
            "Use async/await instead of raw Promises where possible."
        ],
        "general": [
            "Write self-documenting code with clear variable names.",
            "Keep functions small and focused on a single task."
        ]
    }

    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)
        self.standards_file = os.path.join(self.repo_path, ".optcode_standards.json")
        self.standards = self._load_standards()

    def _load_standards(self) -> Dict[str, list]:
        if os.path.exists(self.standards_file):
            try:
                with open(self.standards_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data
            except Exception as e:
                print(f"Warning: Failed to load standards file {self.standards_file}: {e}")
        return self.DEFAULT_STANDARDS.copy()

    def get_standards_for_file(self, file_path: str) -> str:
        """Returns the relevant standards formatted as a string for LLM prompting."""
        _, ext = os.path.splitext(file_path)
        
        relevant_rules = list(self.standards.get("general", []))
        
        if ext in [".py"]:
            relevant_rules.extend(self.standards.get("python", []))
        elif ext in [".js", ".jsx", ".ts", ".tsx"]:
            relevant_rules.extend(self.standards.get("javascript", []))
            
        if not relevant_rules:
            return ""
            
        rules_str = "\n".join([f"- {rule}" for rule in relevant_rules])
        return f"\nCode Standards to enforce:\n{rules_str}\n"

    def get_all_standards(self) -> str:
        summary = []
        for lang, rules in self.standards.items():
            summary.append(f"[{lang.upper()}]:")
            for rule in rules:
                summary.append(f"  - {rule}")
        return "\n".join(summary)
