from typing import List, Dict
from collections import deque
from services.repo_mapper import RepoMapper

class ImpactAnalysis:
    def __init__(self, repo_path: str = "."):
        self.mapper = RepoMapper(repo_path)

    def analyze_impact(self, modified_files: List[str]) -> Dict[str, List[str]]:
        """
        Determines which files and tests are affected by changes to `modified_files`.
        Uses BFS with a deque for O(n) performance.
        """
        repo_map = self.mapper.build_map()
        affected_files = set(modified_files)
        affected_tests = set()

        # Build reverse dependency graph: if A imports B, A is a dependent of B
        dependents: Dict[str, List[str]] = {}
        for file_path, symbols in repo_map.items():
            for imp in symbols.get("imports", []):
                expected_path = imp.replace(".", "/") + ".py"
                dependents.setdefault(expected_path, []).append(file_path)

        # BFS — O(n) with deque
        queue: deque = deque(modified_files)
        while queue:
            current = queue.popleft()
            for dep in dependents.get(current, []):
                if dep not in affected_files:
                    affected_files.add(dep)
                    queue.append(dep)

        # Separate out test files
        for f in affected_files:
            if f.startswith("test_") or "/tests/" in f or "\\tests\\" in f:
                affected_tests.add(f)

        return {
            "affected_files": list(affected_files),
            "affected_tests": list(affected_tests),
        }
