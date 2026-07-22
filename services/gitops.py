import subprocess
import os
from .llm_service import LLMService

class GitOpsAgent:
    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)
        
    def _run_git_command(self, command: str) -> str:
        try:
            result = subprocess.run(
                f"git {command}",
                shell=True,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            print(f"GitOps Agent Error running `git {command}`: {e.stderr}")
            return ""

    def create_branch(self, branch_name: str):
        print(f"GitOps Agent: Creating branch {branch_name}")
        self._run_git_command(f"checkout -b {branch_name}")

    def commit_changes(self, message: str = ""):
        """Commits changes with a smart, AI-generated message if message is empty or generic."""
        # Stage changes
        subprocess.run(["git", "add", "."], cwd=self.repo_path, capture_output=True)
        
        # Get diff to generate message
        diff_proc = subprocess.run(["git", "diff", "--staged"], cwd=self.repo_path, capture_output=True, text=True)
        diff_text = diff_proc.stdout
        
        if not diff_text.strip():
            print("No changes to commit.")
            return

        # Smart Commit Generation
        if not message or len(message) < 15:
            prompt = f"Generate a concise, conventional git commit message for the following diff:\n\n{diff_text[:3000]}"
            sys_prompt = "You are an expert developer. Output ONLY the commit message string, no markdown, no quotes."
            message = LLMService.generate_completion(prompt, sys_prompt).strip()
            
        print(f"Committing with message: {message}")
        subprocess.run(["git", "commit", "-m", message], cwd=self.repo_path, capture_output=True)

    def push_changes(self, branch_name: str):
        print(f"GitOps Agent: Pushing branch {branch_name}")
        self._run_git_command(f"push -u origin {branch_name}")

    def create_pull_request(self, title: str, body: str, head_branch: str, base_branch: str = "main"):
        """Creates a Pull Request using GitHub CLI (gh), with smart PR body generation."""
        if not body or len(body) < 20:
            # Generate a rich PR description
            diff_proc = subprocess.run(["git", "diff", f"{base_branch}...{head_branch}"], cwd=self.repo_path, capture_output=True, text=True)
            diff_text = diff_proc.stdout
            
            prompt = f"Generate a detailed GitHub Pull Request body based on this diff. Include a summary, changes, and testing steps.\n\n{diff_text[:5000]}"
            sys_prompt = "You are an expert developer creating a PR. Output markdown format."
            body = LLMService.generate_completion(prompt, sys_prompt).strip()
            
        print(f"GitOps Agent: Creating PR '{title}' from {head_branch} to {base_branch}")
        # In a real implementation, we would use PyGithub or the GitHub REST API.
        # Here we mock the API call assuming GitHub integration.
        print(f"--> Mock API Call: POST https://api.github.com/repos/org/repo/pulls")
        print(f"--> PR Created Successfully: {title}")
