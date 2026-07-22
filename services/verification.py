import subprocess
import os
from .events import EventBus, AgentEvent, AgentEventType
from .gitops import GitOpsAgent
from .root_cause import RootCauseAnalyzer
from .sandbox import SandboxManager

class VerificationAgent:
    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)

    def __init__(self, repo_path: str = ".", session_id: str = None):
        self.repo_path = os.path.abspath(repo_path)
        self.session_id = session_id
        self.gitops = GitOpsAgent(self.repo_path)
        self.sandbox = SandboxManager(self.repo_path, use_docker=True)
    def detect_commands(self) -> dict:
        """Detects commands for various pipeline stages."""
        commands = {
            "lint": None,
            "build": None,
            "test": None,
            "scan": "bandit -r ." if os.path.exists(os.path.join(self.repo_path, "requirements.txt")) else None
        }
        
        # Simple heuristics
        if os.path.exists(os.path.join(self.repo_path, "package.json")):
            commands["lint"] = "npm run lint"
            commands["build"] = "npm run build"
            commands["test"] = "npm test"
        elif os.path.exists(os.path.join(self.repo_path, "requirements.txt")):
            commands["lint"] = "flake8 ."
            commands["test"] = "pytest"
            
        return commands

    def run_pipeline(self) -> dict:
        """Runs the full verification pipeline."""
        commands = self.detect_commands()
        stages = ["lint", "build", "test", "scan"]
        
        # Start Sandbox environment
        EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, "Starting Docker Sandbox for verification...", session_id=self.session_id))
        self.sandbox.start_docker_sandbox()
        
        try:
            for stage in stages:
                cmd = commands.get(stage)
                if not cmd:
                    continue
                    
                EventBus.publish(AgentEvent(AgentEventType.TEST_STARTED, f"Running {stage} stage: {cmd}", session_id=self.session_id))
                result = self._run_command(cmd)
                
                if not result["success"]:
                    EventBus.publish(AgentEvent(AgentEventType.TEST_FAILED, f"{stage.capitalize()} failed.", payload=result, session_id=self.session_id))
                    rca = RootCauseAnalyzer.analyze_failure(result["stderr"] or result["stdout"], cmd)
                    result["rca"] = rca
                    return result
                    
                EventBus.publish(AgentEvent(AgentEventType.TEST_PASSED, f"{stage.capitalize()} passed.", session_id=self.session_id))
                
            return {"success": True, "stdout": "Pipeline passed successfully.", "stderr": "", "returncode": 0}
        finally:
            # Always stop the sandbox to free resources
            EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, "Cleaning up Docker Sandbox...", session_id=self.session_id))
            self.sandbox.stop_docker_sandbox()

    def _run_command(self, command: str) -> dict:
        return self.sandbox.run_command(command)

    def create_regression_snapshot(self) -> str:
        """Creates a stash/commit before applying a repair."""
        branch_name = f"repair-snapshot-{os.urandom(4).hex()}"
        self.gitops.create_branch(branch_name)
        self.gitops.commit_changes("Regression protection snapshot")
        return branch_name
        
    def rollback_regression(self, branch_name: str):
        """Rolls back to the previous snapshot."""
        try:
            subprocess.run(["git", "checkout", branch_name], cwd=self.repo_path, check=True)
            subprocess.run(["git", "reset", "--hard", "HEAD~1"], cwd=self.repo_path, check=True)
        except Exception as e:
            print(f"Failed to rollback regression: {e}")
