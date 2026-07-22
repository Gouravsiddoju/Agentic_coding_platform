from typing import List, Dict
from services.repo_mapper import RepoMapper

class ImpactAnalysis:
    def __init__(self, repo_path: str = "."):
        self.mapper = RepoMapper(repo_path)

    def analyze_impact(self, modified_files: List[str]) -> Dict[str, List[str]]:
        """
        Determines which files and tests are affected by changes to `modified_files`.
        """
        repo_map = self.mapper.build_map()
        affected_files = set(modified_files)
        affected_tests = set()
        
        # Build reverse dependency graph based on imports
        # If A imports B, and B is modified, A is affected.
        dependents = {}
        for file_path, symbols in repo_map.items():
            # Simplistic mapping: extract module names from imports and match with files
            for imp in symbols.get("imports", []):
                # E.g. 'services.auth' matches 'services/auth.py'
                expected_path = imp.replace(".", "/") + ".py"
                if expected_path not in dependents:
                    dependents[expected_path] = []
                dependents[expected_path].append(file_path)

        # BFS to find all affected files
        queue = list(modified_files)
        while queue:
            current = queue.pop(0)
            for dep in dependents.get(current, []):
                if dep not in affected_files:
                    affected_files.add(dep)
                    queue.append(dep)
                    
        # Identify tests
        for f in affected_files:
            if f.startswith("test_") or "tests/" in f:
                affected_tests.add(f)
                
        return {
            "affected_files": list(affected_files),
            "affected_tests": list(affected_tests)
        }
