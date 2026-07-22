import os
import subprocess
import uuid
import shutil
from typing import Dict, Any

class SandboxManager:
    def __init__(self, workspace_path: str, use_docker: bool = True):
        self.workspace_path = os.path.abspath(workspace_path)
        self.use_docker = use_docker
        self.container_name = f"optcode-sandbox-{uuid.uuid4().hex[:8]}"
        
        # Destructive commands to block in local mode
        self.banned_commands = ["rm -rf /", "mkfs", "dd", "format", "shutdown", "reboot"]

    def _is_safe_command(self, command: str) -> bool:
        for banned in self.banned_commands:
            if banned in command:
                return False
        return True

    def start_docker_sandbox(self):
        """Starts a background container with the workspace mounted."""
        if not self.use_docker:
            return
            
        # We use a standard Python image which has node/pip available or we can just use an ubuntu image.
        # For a proper product, maybe a custom Dockerfile. Here we use python:3.10-slim.
        try:
            subprocess.run([
                "docker", "run", "-d", "--name", self.container_name,
                "-v", f"{self.workspace_path}:/workspace",
                "-w", "/workspace",
                "python:3.10-slim",
                "sleep", "infinity" # Keep container alive
            ], check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            print(f"Failed to start Docker sandbox: {e}")
            self.use_docker = False # Fallback to local
            
    def stop_docker_sandbox(self):
        """Stops and removes the sandbox container."""
        if not self.use_docker:
            return
        subprocess.run(["docker", "rm", "-f", self.container_name], capture_output=True)

    def run_command(self, command: str, timeout: int = 120) -> Dict[str, Any]:
        """Executes a command securely."""
        if not self._is_safe_command(command):
            return {"success": False, "stdout": "", "stderr": "Command blocked for security reasons.", "returncode": 1}

        if self.use_docker:
            # Run inside docker
            try:
                # To support shell pipes, wrap in sh -c
                docker_cmd = ["docker", "exec", self.container_name, "sh", "-c", command]
                result = subprocess.run(
                    docker_cmd,
                    capture_output=True,
                    text=True,
                    timeout=timeout
                )
                return {
                    "success": result.returncode == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode
                }
            except subprocess.TimeoutExpired:
                return {"success": False, "stdout": "", "stderr": f"Command timed out after {timeout} seconds.", "returncode": 124}
            except Exception as e:
                return {"success": False, "stdout": "", "stderr": str(e), "returncode": 1}
        else:
            # Run locally
            try:
                result = subprocess.run(
                    command,
                    cwd=self.workspace_path,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=timeout
                )
                return {
                    "success": result.returncode == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode
                }
            except subprocess.TimeoutExpired:
                return {"success": False, "stdout": "", "stderr": f"Command timed out after {timeout} seconds.", "returncode": 124}
            except Exception as e:
                return {"success": False, "stdout": "", "stderr": str(e), "returncode": 1}
