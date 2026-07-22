import os
import ast
import json
from typing import Dict, List, Any

class RepoMapper:
    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)
        self.ignore_dirs = {".git", ".venv", "__pycache__", "node_modules", ".optcode_db", ".optcode_workspaces", ".pytest_cache"}
        self.allowed_extensions = {".py"} # Focusing on Python for now for AST parsing

    def extract_symbols_from_python(self, file_path: str) -> Dict[str, Any]:
        """Parses a Python file and extracts classes, functions, and imports."""
        symbols = {
            "classes": [],
            "functions": [],
            "imports": []
        }
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    methods = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
                    symbols["classes"].append({
                        "name": node.name,
                        "line": node.lineno,
                        "methods": methods
                    })
                elif isinstance(node, ast.FunctionDef):
                    # Only grab module-level functions
                    symbols["functions"].append({
                        "name": node.name,
                        "line": node.lineno
                    })
                elif isinstance(node, ast.Import):
                    for name in node.names:
                        symbols["imports"].append(name.name)
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    for name in node.names:
                        symbols["imports"].append(f"{module}.{name.name}")
        except SyntaxError:
            pass # Skip files that don't parse
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            
        return symbols

    def build_map(self) -> Dict[str, Any]:
        """Scans the repository and builds a structural map."""
        repo_map = {}
        for root, dirs, files in os.walk(self.repo_path):
            dirs[:] = [d for d in dirs if d not in self.ignore_dirs]
            
            for file in files:
                _, ext = os.path.splitext(file)
                if ext in self.allowed_extensions:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.repo_path)
                    symbols = self.extract_symbols_from_python(full_path)
                    if any(symbols.values()):
                        repo_map[rel_path] = symbols
        return repo_map

    def save_map(self, output_path: str = ".optcode_db/repo_map.json"):
        """Saves the map to a JSON file."""
        repo_map = self.build_map()
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(repo_map, f, indent=2)
        return repo_map
        
    def generate_architecture_summary(self) -> str:
        """Generates a high-level string representation of the architecture."""
        repo_map = self.build_map()
        summary = ["# Repository Architecture\n"]
        for file_path, symbols in repo_map.items():
            summary.append(f"## {file_path}")
            if symbols["classes"]:
                summary.append("  Classes:")
                for cls in symbols["classes"]:
                    summary.append(f"    - {cls['name']}")
                    for method in cls['methods']:
                        summary.append(f"      - {method}()")
            if symbols["functions"]:
                summary.append("  Functions:")
                for func in symbols["functions"]:
                    summary.append(f"    - {func['name']}()")
            if symbols["imports"]:
                summary.append("  Imports:")
                for imp in symbols["imports"][:5]: # show first 5 imports to save space
                    summary.append(f"    - {imp}")
            summary.append("")
        return "\n".join(summary)

if __name__ == "__main__":
    mapper = RepoMapper()
    repo_map = mapper.save_map()
    print(f"Mapped {len(repo_map)} Python files.")
