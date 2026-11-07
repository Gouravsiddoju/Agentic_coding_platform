import os
import shutil
import uuid
import subprocess
from typing import Optional

class WorkspaceManager:
    WORKSPACES_DIR = ".codeme_workspaces"

    @classmethod
    def _ensure_dir(cls):
        os.makedirs(cls.WORKSPACES_DIR, exist_ok=True)

    @classmethod
    def create_workspace(cls, base_repo_path: str = ".", workspace_id: Optional[str] = None) -> str:
        """
        Creates an isolated workspace by copying the base repository.
        Ignores heavy/unnecessary directories like node_modules, .venv, etc.
        """
        cls._ensure_dir()
        wid = workspace_id or str(uuid.uuid4())
        target_path = os.path.abspath(os.path.join(cls.WORKSPACES_DIR, wid))

        if os.path.exists(target_path):
            shutil.rmtree(target_path)

        base_repo_path = os.path.abspath(base_repo_path)
        
        def ignore_patterns(path, names):
            ignored = {".git", "node_modules", "__pycache__", ".venv", "venv", ".codeme_db", ".codeme_workspaces"}
            return [n for n in names if n in ignored]

        try:
            shutil.copytree(base_repo_path, target_path, ignore=ignore_patterns)
            
            # Initialize a fresh git repo in the workspace
            subprocess.run(["git", "init"], cwd=target_path, capture_output=True, check=True)
            subprocess.run(["git", "add", "."], cwd=target_path, capture_output=True, check=True)
            subprocess.run(["git", "commit", "-m", "Initial workspace state"], cwd=target_path, capture_output=True, check=False)
            
            return target_path
        except Exception as e:
            print(f"Error creating workspace: {e}")
            if os.path.exists(target_path):
                shutil.rmtree(target_path)
            return None

    @classmethod
    def cleanup_workspace(cls, workspace_id: str):
        target_path = os.path.abspath(os.path.join(cls.WORKSPACES_DIR, workspace_id))
        if os.path.exists(target_path):
            try:
                shutil.rmtree(target_path)
            except Exception as e:
                print(f"Error cleaning up workspace {workspace_id}: {e}")

    @classmethod
    def apply_workspace_to_repo(cls, workspace_path: str, repo_path: str = "."):
        """
        Applies the changes from a workspace back to the main repository.
        """
        # A simple way for MVP is to use rsync or copytree, but ideally we create a patch
        # and apply it, or copy files while excluding .git
        workspace_path = os.path.abspath(workspace_path)
        repo_path = os.path.abspath(repo_path)
        
        def ignore_patterns(path, names):
            ignored = {".git", ".codeme_db", ".codeme_workspaces"}
            return [n for n in names if n in ignored]
            
        try:
            # We use copytree with dirs_exist_ok=True
            shutil.copytree(workspace_path, repo_path, ignore=ignore_patterns, dirs_exist_ok=True)
            return True
        except Exception as e:
            print(f"Error applying workspace to repo: {e}")
            return False
