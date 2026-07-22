import os
import subprocess
from typing import Dict, Any, List

class AgentTools:
    
    @staticmethod
    def get_tool_definitions() -> List[Dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Reads the content of a file.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "The path to the file"}
                        },
                        "required": ["path"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "list_directory",
                    "description": "Lists the files and folders in a directory.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "The directory path. Use '.' for the current directory."}
                        },
                        "required": ["path"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_command",
                    "description": "Runs a terminal command and returns the stdout and stderr.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {"type": "string", "description": "The shell command to execute"}
                        },
                        "required": ["command"]
                    }
                }
            }
        ]

    @staticmethod
    def read_file(path: str) -> str:
        if not os.path.exists(path):
            return f"Error: File '{path}' does not exist."
        if os.path.isdir(path):
            return f"Error: '{path}' is a directory, not a file."
            
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            return f"Error reading file: {e}"

    @staticmethod
    def list_directory(path: str) -> str:
        if not os.path.exists(path):
            return f"Error: Directory '{path}' does not exist."
        if not os.path.isdir(path):
            return f"Error: '{path}' is a file, not a directory."
            
        try:
            files = os.listdir(path)
            return "\n".join(files) if files else "(Empty directory)"
        except Exception as e:
            return f"Error listing directory: {e}"

    @staticmethod
    def run_command(command: str) -> str:
        try:
            result = subprocess.run(
                command, 
                shell=True, 
                capture_output=True, 
                text=True,
                timeout=60
            )
            output = ""
            if result.stdout:
                output += f"STDOUT:\n{result.stdout}\n"
            if result.stderr:
                output += f"STDERR:\n{result.stderr}\n"
            if not output:
                output = f"Command executed successfully with no output. Exit code: {result.returncode}"
            return output
        except subprocess.TimeoutExpired:
            return "Error: Command timed out after 60 seconds."
        except Exception as e:
            return f"Error executing command: {e}"
