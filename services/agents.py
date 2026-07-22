import json
import os
from .llm_service import LLMService
from .repo_intelligence import RepoIntelligenceEngine
from .config import ConfigManager
from .events import EventBus, AgentEvent, AgentEventType
from .standards import CodeStandardsEngine
import uuid
from rich.prompt import Confirm

class ArchitectAgent:
    def __init__(self, repo_path: str = "."):
        self.repo_intelligence = RepoIntelligenceEngine(repo_path)
    
    def plan_implementation(self, story: str) -> dict:
        """
        Takes a user story, retrieves context from the repo, and outputs an implementation plan.
        """
        # Step 1: Retrieve context
        EventBus.publish(AgentEvent(AgentEventType.THINKING, "Architect Agent: Retrieving repository context..."))
        context_docs = self.repo_intelligence.search(story, n_results=10)
        context_str = "\n".join([doc['content'] for doc in context_docs])
        
        # Step 2: Generate plan
        EventBus.publish(AgentEvent(AgentEventType.PLANNING, "Architect Agent: Generating implementation plan..."))
        system_prompt = (
            "You are an expert Software Architect and UI/UX Designer. "
            "Given the user story and codebase context, output a detailed JSON plan. "
            "IMPORTANT: When outputting URLs, IP addresses, or file paths in any description or message, ALWAYS format them as clickable markdown links (e.g., [http://localhost:5000](http://localhost:5000) or [file.txt](file.txt)). Do not just bold them. "
            "You have access to tools. Use them to read files or list directories to understand the codebase BEFORE finalizing your plan. "
            "You MUST also use run_command to safely scaffold projects from scratch (e.g., npx create-vite, cargo new, npm init) if the project foundation doesn't exist yet. "
            "Once you are done investigating and scaffolding, output your final response in pure JSON format ONLY:\n"
            "{\n"
            f"  \"story_id\": \"{str(uuid.uuid4())[:8]}\",\n"
            "  \"objective\": \"...\",\n"
            "  \"steps\": [\"step 1\", \"step 2\"],\n"
            "  \"files_to_create\": [{\"path\": \"...\", \"description\": \"...\"}],\n"
            "  \"files_to_modify\": [{\"path\": \"...\", \"description\": \"...\"}],\n"
            "  \"tests_to_create\": [{\"path\": \"...\", \"description\": \"...\"}],\n"
            "  \"commands_to_run\": [\"npm install\", \"pip install ...\"],\n"
            "  \"verification_steps\": [\"run tests\", \"check logs\"],\n"
            "  \"rollback_plan\": [\"revert commit X\"]\n"
            "}\n"
            "Do NOT include any markdown formatting, output pure JSON."
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"User Story:\n{story}\n\nInitial Context (Search Results):\n{context_str}"}
        ]
        
        from .tools import AgentTools
        tools = AgentTools.get_tool_definitions()
        
        while True:
            response_msg = LLMService.agent_chat(messages, tools=tools)
            if not response_msg:
                response = "{}"
                break
                
            messages.append(response_msg)
            
            if "tool_calls" in response_msg and response_msg["tool_calls"]:
                for tool_call in response_msg["tool_calls"]:
                    func_name = tool_call.get("function", {}).get("name")
                    args = tool_call.get("function", {}).get("arguments", {})
                    
                    EventBus.publish(AgentEvent(AgentEventType.TOOL_USE, f"Architect tool call: {func_name}({args})", payload={"tool": func_name, "args": args}))
                    try:
                        if func_name == "read_file":
                            output = AgentTools.read_file(args.get("path", ""))
                        elif func_name == "list_directory":
                            output = AgentTools.list_directory(args.get("path", "."))
                        elif func_name == "run_command":
                            cmd = args.get("command", "").strip()
                            allowed_prefixes = (
                                "npm", "npx", "yarn", "pnpm", "cargo", "go", "pip", "python", "mkdir", 
                                "vue", "ng", "django-admin", "flask", "tsc", "git", "composer", "php", 
                                "ruby", "gem", "rails", "bundle", "dotnet", "gradle", "mvn", "flutter", 
                                "dart", "rustc", "echo", "touch"
                            )
                            if cmd.startswith(allowed_prefixes):
                                output = AgentTools.run_command(cmd)
                            else:
                                output = f"Command execution disabled for safety. Only development commands ({', '.join(allowed_prefixes[:5])}...) are allowed during planning."
                        else:
                            output = f"Error: Unknown tool {func_name}"
                        EventBus.publish(AgentEvent(AgentEventType.TOOL_RESULT, f"Tool Result: {func_name}", payload={"result": str(output)[:200]}))
                    except Exception as e:
                        output = f"Error: {e}"
                        EventBus.publish(AgentEvent(AgentEventType.ERROR, output))
                        
                    tool_msg = {"role": "tool", "content": str(output), "name": func_name}
                    if "id" in tool_call:
                        tool_msg["tool_call_id"] = tool_call["id"]
                    messages.append(tool_msg)
            else:
                response = response_msg.get("content", "")
                break
        
        try:
            # Basic cleanup of potential markdown
            response = response.strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
                
            plan = json.loads(response.strip())
            return plan
        except Exception as e:
            print(f"Error parsing Architect plan: {e}\nRaw Response: {response}")
            return {"plan_summary": "Failed to parse plan", "files_to_create": [], "files_to_modify": []}

    def plan_scaffolding(self, description: str) -> dict:
        """
        Takes a description of a new project and generates a scaffolding plan from scratch.
        """
        print("Architect Agent: Designing project scaffolding...")
        system_prompt = (
            "You are an expert Software Architect designing a new project from scratch. "
            "Given the user's description, design a complete, production-ready directory structure and initial files. "
            "Output your design in pure JSON format ONLY:\n"
            "{\n"
            "  \"plan_summary\": \"...\",\n"
            "  \"files_to_create\": [{\"path\": \"...\", \"description\": \"...\"}],\n"
            "  \"files_to_modify\": []\n"
            "}\n"
            "Include base files like README.md, requirements.txt, or package.json as appropriate. "
            "Do NOT include any markdown formatting, output pure JSON."
        )
        
        prompt = f"Project Description:\n{description}"
        response = LLMService.generate_completion(prompt, system_prompt)
        
        try:
            response = response.strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
                
            plan = json.loads(response.strip())
            return plan
        except Exception as e:
            print(f"Error parsing Scaffolding plan: {e}\nRaw Response: {response}")
            return {"plan_summary": "Failed to parse plan", "files_to_create": [], "files_to_modify": []}

class EngineeringAgent:
    def __init__(self, repo_path: str = "."):
        self.repo_path = repo_path
        
    def execute_plan(self, plan: dict):
        """
        Takes an Architect's plan and generates/modifies files in steps.
        """
        objective = plan.get('objective', plan.get('plan_summary', ''))
        EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Engineering Agent: Executing plan... ({objective})"))
        
        standards_engine = CodeStandardsEngine(self.repo_path)
        
        # Check safe mode
        if ConfigManager.is_safe_mode():
            print("\n--- SAFE MODE ACTIVE ---")
            print("The Architect has proposed the following file changes:")
            for f in plan.get("files_to_create", []):
                print(f"  [NEW]    {f['path']}")
            for f in plan.get("files_to_modify", []):
                print(f"  [MODIFY] {f['path']}")
            for cmd in plan.get("commands_to_run", []):
                print(f"  [EXECUTE] {cmd}")
            
            if not Confirm.ask("Do you want to proceed with these changes?"):
                print("Engineering Agent: Changes aborted by user.")
                return
        
        
        # Files to Create
        for file in plan.get("files_to_create", []):
            self._create_file(file['path'], file['description'], standards_engine)
            
        # Files to Modify
        for file in plan.get("files_to_modify", []):
            self._modify_file(file['path'], file['description'], standards_engine)
            
        # Tests to Create
        for file in plan.get("tests_to_create", []):
            self._create_file(file['path'], file['description'], standards_engine)
            
        # Commands to Run
        import subprocess
        for cmd in plan.get("commands_to_run", []):
            EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Engineering Agent: Executing command: {cmd}"))
            try:
                print(f"[yellow]Running command: {cmd}[/yellow]")
                result = subprocess.run(cmd, cwd=self.repo_path, shell=True, capture_output=True, text=True)
                
                output_str = ""
                if result.stdout:
                    output_str += f"STDOUT:\n{result.stdout}\n"
                    print(result.stdout)
                if result.stderr:
                    output_str += f"STDERR:\n{result.stderr}\n"
                    print(f"[red]{result.stderr}[/red]")
                
                # Publish the command output back to the UI
                if output_str:
                    EventBus.publish(AgentEvent(AgentEventType.TOOL_USE, "Command Output", payload={"tool": "run_command", "args": {"command": cmd}, "result": output_str}))
                
                # If command fails, raise an exception so the agent/repair flow knows it failed
                if result.returncode != 0:
                    error_msg = f"Command failed with exit code {result.returncode}:\n{output_str}"
                    EventBus.publish(AgentEvent(AgentEventType.ERROR, f"Command Execution Failed: {cmd}", payload={"error": error_msg}))
                    raise Exception(error_msg)
                    
            except Exception as e:
                print(f"[red]Failed to run command {cmd}: {e}[/red]")
                raise e
            
    def _create_file(self, path: str, description: str, standards_engine: CodeStandardsEngine):
        EventBus.publish(AgentEvent(AgentEventType.FILE_CHANGED, f"Engineering Agent: Creating {path}...", payload={"path": path}))
        standards_str = standards_engine.get_standards_for_file(path)
        
        system_prompt = (
            "You are an expert Software Engineer and UI/UX Designer. Generate complete, working code based on the description. "
            "When creating Web UI components, you MUST adhere to modern aesthetic guidelines: Use rich colors, dynamic layouts, smooth gradients, hover effects, and modern typography. NEVER output basic, plain HTML/CSS. Prioritize visual excellence. "
            "IMPORTANT: When outputting URLs, IP addresses, or file paths in explanations or notes, ALWAYS format them as clickable markdown links. "
            "Do NOT use markdown code blocks, just output the pure code text."
            f"{standards_str}"
        )
        prompt = f"File to create: {path}\nDescription: {description}"
        code = LLMService.generate_completion(prompt, system_prompt)
        
        full_path = os.path.join(self.repo_path, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(code.strip())
            
    def _modify_file(self, path: str, description: str, standards_engine: CodeStandardsEngine):
        EventBus.publish(AgentEvent(AgentEventType.FILE_CHANGED, f"Engineering Agent: Modifying {path}...", payload={"path": path}))
        full_path = os.path.join(self.repo_path, path)
        
        if not os.path.exists(full_path):
            print(f"Error: {path} does not exist.")
            return
            
        with open(full_path, "r", encoding="utf-8") as f:
            original_code = f.read()
            
        standards_str = standards_engine.get_standards_for_file(path)
            
        system_prompt = (
            "You are an expert Software Engineer and UI/UX Designer. You will be given the original code and a description of modifications. "
            "When modifying Web UI components, you MUST adhere to modern aesthetic guidelines: Use rich colors, dynamic layouts, smooth gradients, hover effects, and modern typography. NEVER output basic, plain HTML/CSS. Prioritize visual excellence. "
            "Output the FULL modified code. Do NOT use markdown code blocks, just output the pure code text."
            f"{standards_str}"
        )
        prompt = f"File: {path}\nDescription of changes: {description}\n\nOriginal Code:\n{original_code}"
        
        new_code = LLMService.generate_completion(prompt, system_prompt)
        
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(new_code.strip())

class RepairAgent:
    def __init__(self, repo_path: str = "."):
        self.repo_path = repo_path
        self.engineer = EngineeringAgent(repo_path)
        self.failed_attempts = []
        
    def generate_repair_plan(self, test_output: str, failed_command: str) -> dict:
        """
        Takes test output and generates a repair plan.
        """
        print("Repair Agent: Analyzing test failures...")
        system_prompt = (
            "You are an expert Software Engineer analyzing test/build failures. "
            "Given the failure logs, output a JSON plan detailing files to modify to fix the issue. "
            "JSON Format expected:\n"
            "{\n"
            "  \"plan_summary\": \"...\",\n"
            "  \"files_to_modify\": [{\"path\": \"...\", \"description\": \"...\"}],\n"
            "  \"commands_to_run\": [\"npm install ts-node\", \"...\"]\n"
            "}\n"
            "Do NOT include any markdown formatting, output pure JSON."
        )
        
        failed_attempts_str = ""
        if self.failed_attempts:
            failed_attempts_str = "PREVIOUS FAILED APPROACHES (DO NOT REPEAT THESE):\n"
            for i, plan in enumerate(self.failed_attempts):
                failed_attempts_str += f"{i+1}. {plan.get('plan_summary')}\n"
        
        prompt = f"Command Failed: {failed_command}\n\nLogs:\n{test_output}\n\n{failed_attempts_str}"
        response = LLMService.generate_completion(prompt, system_prompt)
        
        try:
            response = response.strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
                
            plan = json.loads(response.strip())
            self.failed_attempts.append(plan)
            return plan
        except Exception as e:
            print(f"Error parsing Repair plan: {e}\nRaw Response: {response}")
            return {"plan_summary": "Failed to parse plan", "files_to_modify": []}
            
    def execute_repair(self, plan: dict):
        self.engineer.execute_plan(plan)

if __name__ == "__main__":
    pass
