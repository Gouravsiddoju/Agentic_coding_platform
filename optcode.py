import typer
import sys
import os
import subprocess
import json
from rich.console import Console
from rich import print
from services.repo_intelligence import RepoIntelligenceEngine
from services.agents import ArchitectAgent, EngineeringAgent, RepairAgent
from services.verification import VerificationAgent
from services.intent_router import IntentRouter
from services.gitops import GitOpsAgent
from services.config import ConfigManager
from services.events import EventBus, AgentEvent, AgentEventType
from services.session_manager import SessionManager, SessionStatus
from services.workspace import WorkspaceManager
from services.coordinator import CoordinatorAgent

app = typer.Typer(help="OPTCode v2.0 - Claude Code Inspired MVP")
console = Console()

@app.command()
def create(
    description: str = typer.Argument(..., help="Description of the project to create"),
    project_name: str = typer.Argument(..., help="Name of the new project folder"),
    parent_path: str = typer.Option(".", help="Path where the project folder will be created")
):
    print(f"[bold green]Starting project scaffolding for:[/bold green] {project_name}")
    
    target_path = os.path.join(parent_path, project_name)
    if os.path.exists(target_path):
        print(f"[yellow]Warning: Folder {target_path} already exists. Files may be overwritten.[/yellow]")
    else:
        print(f"[yellow]Creating folder: {target_path}[/yellow]")
        os.makedirs(target_path, exist_ok=True)
        
    architect = ArchitectAgent(target_path)
    with console.status("[blue]Architect is designing the project structure...[/blue]"):
        plan = architect.plan_scaffolding(description)
        
    print("[bold blue]Scaffolding Plan Generated:[/bold blue]")
    print(plan)
    
    engineer = EngineeringAgent(target_path)
    engineer.execute_plan(plan)
    
    # Initialize Git
    with console.status("[yellow]Initializing Git repository...[/yellow]"):
        subprocess.run(["git", "init"], cwd=target_path, capture_output=True)
    
    # Verification & Repair Loop
    from rich.prompt import Prompt, Confirm
    verifier = VerificationAgent(target_path)
    
    print("\n[bold yellow]Using verification pipeline[/bold yellow]")
    
    repair_agent = RepairAgent(target_path)
    max_retries = 3
    
    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"\n[bold blue]Repair Iteration {attempt}/{max_retries}[/bold blue] - Verifying...")
        else:
            print(f"\n[bold blue]Initial Verification[/bold blue] - Running tests...")
            
        with console.status("[cyan]Verifying code...[/cyan]"):
            result = verifier.run_pipeline()
            
        if result["success"]:
            print("[bold green]Verification Passed! Project scaffolded successfully![/bold green]")
            if Confirm.ask("\nDo you want to make an initial commit?"):
                with console.status("[yellow]Committing...[/yellow]"):
                    subprocess.run(["git", "add", "."], cwd=target_path, capture_output=True)
                    subprocess.run(["git", "commit", "-m", "Initial commit via OPTCode"], cwd=target_path, capture_output=True)
                print("[bold green]Initial commit created![/bold green]")
            return
            
        print("[bold red]Verification Failed.[/bold red]")
        if attempt == max_retries:
            print("[bold red]Max retries reached. The agent could not fully resolve the issue.[/bold red]")
            break
            
        print("[yellow]Triggering Repair Iteration...[/yellow]")
        failure_log = result["stderr"] if result["stderr"] else result["stdout"]
        
        with console.status("[blue]Architecting a repair...[/blue]"):
            repair_plan = repair_agent.generate_repair_plan(failure_log, "pipeline")
            
        print(f"[bold blue]Repair Strategy Generated:[/bold blue] {repair_plan.get('plan_summary')}")
        
        snapshot = verifier.create_regression_snapshot()
        repair_agent.execute_repair(repair_plan)
        
        # We don't rollback immediately, we will verify in the next iteration.
        # If it fails again, we might want to rollback, but let's keep it simple for now.
        
    print(f"\n[bold yellow]Project '{project_name}' created at {target_path}[/bold yellow]")

@app.command()
def implement(
    story: str = typer.Argument(..., help="The user story or requirement to implement"),
    repo_path: str = typer.Option(".", help="Path to the repository")
):
    print(f"[bold green]Starting implementation for:[/bold green] {story}")
    
    # Subscribe CLI to EventBus
    def cli_event_handler(event: AgentEvent):
        color = "cyan"
        if event.event_type == AgentEventType.ERROR:
            color = "red"
        elif event.event_type == AgentEventType.COMPLETE:
            color = "green"
        elif event.event_type == AgentEventType.TOOL_USE:
            color = "yellow"
        print(f"[[bold {color}]{event.event_type.value}[/bold {color}]] {event.message}")

    EventBus.subscribe_all(cli_event_handler)
    
    session = SessionManager.create_session(goal=story)
    session.status = SessionStatus.RUNNING
    SessionManager.save_session(session)
    
    print("[yellow]Creating workspace...[/yellow]")
    workspace_path = WorkspaceManager.create_workspace(repo_path, session.session_id)
    session.workspace_path = workspace_path
    SessionManager.save_session(session)
    
    if not workspace_path:
        print("[red]Failed to create workspace. Aborting.[/red]")
        return
    
    print("[yellow]Ensuring repository is indexed...[/yellow]")
    from services.repo_intelligence import RepoIntelligenceEngine
    engine = RepoIntelligenceEngine(workspace_path)
    with console.status("[yellow]Indexing repository...[/yellow]"):
        engine.index_repository()
    
    print("[bold blue]Delegating to Coordinator Agent...[/bold blue]")
    coordinator = CoordinatorAgent(workspace_path, session.session_id)
    coordinator.execute_workflow(story)
    
    print("[yellow]Applying workspace changes back to main repository...[/yellow]")
    WorkspaceManager.apply_workspace_to_repo(workspace_path, repo_path)
    
    session.status = SessionStatus.COMPLETED
    SessionManager.save_session(session)
    print("\n[bold green]Implementation workflow completed successfully![/bold green]")

@app.command()
def fix(
    target: str = typer.Argument(..., help="What to fix (e.g., 'failing tests', 'authentication bug')"),
    repo_path: str = typer.Option(".", help="Path to the repository")
):
    print(f"[bold green]Attempting to fix:[/bold green] {target}")
    
    print("[yellow]Gathering repository context...[/yellow]")
    engine = RepoIntelligenceEngine(repo_path)
    with console.status("[yellow]Searching context...[/yellow]"):
        context_docs = engine.search(target, n_results=10)
    context_str = "\n".join([doc['content'] for doc in context_docs])
    
    print("[yellow]Generating repair plan...[/yellow]")
    architect = ArchitectAgent(repo_path)
    system_prompt = "You are an expert Software Engineer repairing a bug. Generate a JSON plan detailing files to modify to fix the issue. JSON Format expected: {\"plan_summary\": \"...\", \"files_to_modify\": [{\"path\": \"...\", \"description\": \"...\"}]}"
    prompt = f"Issue: {target}\n\nContext:\n{context_str}"
    
    with console.status("[blue]Architect is generating a repair plan...[/blue]"):
        response = LLMService.generate_completion(prompt, system_prompt)
    try:
        if response.startswith("```json"):
            response = response[7:]
        if response.endswith("```"):
            response = response[:-3]
        plan = json.loads(response.strip())
        print(f"[bold blue]Repair Plan:[/bold blue] {plan.get('plan_summary')}")
        
        engineer = EngineeringAgent(repo_path)
        engineer.execute_plan(plan)
        print("[bold green]Fix complete![/bold green]")
    except Exception as e:
        print(f"[bold red]Failed to generate or parse repair plan:[/bold red] {e}")

@app.command()
def explain(
    target: str = typer.Argument(..., help="What to explain (e.g., 'architecture', 'authentication flow')"),
    repo_path: str = typer.Option(".", help="Path to the repository")
):
    print(f"[bold green]Explaining:[/bold green] {target}")
    print("[yellow]Analyzing repository...[/yellow]")
    
    engine = RepoIntelligenceEngine(repo_path)
    context_docs = engine.search(target, n_results=15)
    context_str = "\n".join([doc['content'] for doc in context_docs])
    
    system_prompt = "You are an expert Software Architect. Explain the requested concept based purely on the provided codebase context."
    prompt = f"Concept to explain: {target}\n\nCodebase Context:\n{context_str}"
    
    explanation = LLMService.generate_completion(prompt, system_prompt)
    
    print("\n[bold cyan]Explanation:[/bold cyan]")
    print(explanation)

@app.command()
def verify(
    repo_path: str = typer.Option(".", help="Path to the repository"),
    max_retries: int = typer.Option(3, help="Maximum number of repair attempts")
):
    print(f"[bold green]Starting Verification Pipeline...[/bold green]")
    
    verifier = VerificationAgent(repo_path)
    repair_agent = RepairAgent(repo_path)
    
    for attempt in range(max_retries + 1):
        print(f"[bold blue]Attempt {attempt + 1}/{max_retries + 1}[/bold blue] - Running pipeline...")
        result = verifier.run_pipeline()
        
        if result["success"]:
            print("[bold green]Verification Passed![/bold green]")
            print(result["stdout"])
            return
        
        print("[bold red]Verification Failed.[/bold red]")
        if attempt == max_retries:
            print("[bold red]Max retries reached. Aborting.[/bold red]")
            print(result["stderr"] or result["stdout"])
            break
            
        print("[yellow]Triggering Repair Agent...[/yellow]")
        if "rca" in result:
            print(f"[bold red]Root Cause:[/bold red] {result['rca'].get('root_cause')}")
            
        failure_log = result["stderr"] if result["stderr"] else result["stdout"]
        plan = repair_agent.generate_repair_plan(failure_log, "pipeline")
        
        print(f"[bold blue]Repair Plan Generated:[/bold blue] {plan.get('plan_summary')}")
        verifier.create_regression_snapshot()
        repair_agent.execute_repair(plan)

@app.command()
def ship(
    message: str = typer.Argument(..., help="Commit message and PR title"),
    branch: str = typer.Option("feature/auto-implemented", help="Branch name to create"),
    repo_path: str = typer.Option(".", help="Path to the repository")
):
    print(f"[bold green]Starting GitOps shipping process...[/bold green]")
    gitops = GitOpsAgent(repo_path)
    
    print("[yellow]Creating branch...[/yellow]")
    gitops.create_branch(branch)
    
    print("[yellow]Committing changes...[/yellow]")
    gitops.commit_changes(message)
    
    print("[yellow]Pushing changes...[/yellow]")
    gitops.push_changes(branch)
    
    print("[yellow]Creating Pull Request...[/yellow]")
    gitops.create_pull_request(
        title=message,
        body="This PR was automatically generated by OPTCode AI Software Engineering Agent.",
        head_branch=branch
    )
    
    print("[bold green]Successfully shipped![/bold green]")

@app.command(name="chat")
def interactive_chat(
    repo_path: str = typer.Option(".", help="Path to the repository")
):
    """
    Start an interactive conversational CLI session with OPTCode v2.0 MVP.
    """
    
    def compress_history(history: list, max_len: int = 15) -> list:
        """
        Keeps the system prompt and the most recent messages, safely dropping 
        older context to prevent LLM Context Window overflows.
        Ensures we don't accidentally split a tool_call / tool_response pair.
        """
        if len(history) <= max_len:
            return history
            
        system_prompt = history[0]
        # We need to find a safe index to slice from (preferably a user message)
        # to ensure we don't slice in the middle of a tool call chain.
        safe_index = len(history) - max_len + 1
        while safe_index < len(history):
            if history[safe_index].get("role") == "user":
                break
            safe_index += 1
            
        # Fallback if no user message found in the window
        if safe_index >= len(history):
            safe_index = len(history) - 5
            
        return [system_prompt] + history[safe_index:]

    console.print("\n[bold green]Welcome to OPTCode v2.0 Interactive Mode![/bold green]")
    console.print("Type naturally to chat or request features. I'll automatically figure out what you need!")
    console.print("Available commands:")
    console.print("  [cyan]/help[/cyan]        - Show commands")
    console.print("  [cyan]/clear[/cyan]       - Clear history")
    console.print("  [cyan]/history[/cyan]     - Show history")
    console.print("  [cyan]/status[/cyan]      - Show git status")
    console.print("  [cyan]/config[/cyan]      - Toggle Safe Mode")
    console.print("  [cyan]/pr[/cyan]          - Create Pull Request")
    console.print("  [cyan]/open <path>[/cyan] - Change active workspace folder")
    console.print("  [cyan]/exit[/cyan]        - Leave chat\n")
    
    messages = [
        {"role": "system", "content": "You are OPTCode, an autonomous AI Software Engineer running directly on the user's local machine. You HAVE full read and write access to their local filesystem and repository. When the user asks for code, your background agents physically create and modify the files on their disk. NEVER say that you cannot create files or that you don't have access to the system, because you do. Be helpful and concise."}
    ]
    
    while True:
        try:
            user_input = typer.prompt("You")
        except (KeyboardInterrupt, EOFError):
            break
            
        if user_input.strip() == "":
            continue
            
        cmd = user_input.strip().lower()
        if cmd in ["/exit", "/quit"]:
            console.print("[yellow]Goodbye![/yellow]")
            break
        elif cmd == "/help":
            console.print("  [cyan]/help[/cyan]        - Show commands")
            console.print("  [cyan]/clear[/cyan]       - Clear history")
            console.print("  [cyan]/history[/cyan]     - Show history")
            console.print("  [cyan]/status[/cyan]      - Show git status")
            console.print("  [cyan]/config[/cyan]      - Toggle Safe Mode")
            console.print("  [cyan]/pr[/cyan]          - Create Pull Request")
            console.print("  [cyan]/open <path>[/cyan] - Change active workspace folder")
            console.print("  [cyan]/exit[/cyan]        - Leave chat\n")
            continue
        elif cmd == "/clear":
            messages = [{"role": "system", "content": "You are OPTCode, an expert AI Software Engineer. Be helpful, concise, and guide the user in building software."}]
            console.print("[green]History cleared.[/green]")
            continue
        elif cmd == "/history":
            for idx, msg in enumerate(messages[1:]): 
                color = "blue" if msg["role"] == "user" else "magenta"
                console.print(f"[{color}]{msg['role'].capitalize()}:[/{color}] {msg['content'][:150]}...")
            continue
        elif cmd == "/status":
            with console.status("[yellow]Checking git status...[/yellow]"):
                res = subprocess.run(["git", "status", "-s"], capture_output=True, text=True, cwd=repo_path)
                if res.stdout:
                    console.print("[cyan]Uncommitted changes:[/cyan]")
                    console.print(res.stdout)
                else:
                    console.print("[green]Workspace clean.[/green]")
            continue
        elif cmd == "/config":
            current_safe = ConfigManager.is_safe_mode()
            new_safe = ConfigManager.toggle_safe_mode()
            console.print(f"[green]Safe Mode toggled:[/green] {current_safe} -> [bold]{new_safe}[/bold]")
            continue
        elif cmd.startswith("/pr"):
            parts = user_input.split(" ", 1)
            msg = parts[1] if len(parts) > 1 else "Auto-generated PR"
            with console.status("[yellow]Creating PR...[/yellow]"):
                ship(message=msg, branch="feature/optcode-update", repo_path=repo_path)
            continue
        elif cmd.startswith("/open ") or cmd.startswith("/cd "):
            new_path = user_input.split(" ", 1)[1].strip()
            if os.path.exists(new_path) and os.path.isdir(new_path):
                repo_path = os.path.abspath(new_path)
                console.print(f"[green]Workspace changed to:[/green] {repo_path}")
                messages.append({"role": "system", "content": f"The user has changed the active workspace directory to: {repo_path}. Any future file operations or implementations will happen in this directory."})
            else:
                console.print(f"[red]Error: Directory '{new_path}' does not exist.[/red]")
            continue
            
        # Natural Language Routing
        with console.status("[cyan]Routing intent...[/cyan]", spinner="dots"):
            route = IntentRouter.route_intent(user_input)
            
        intent = route["intent"]
        target = route["target"]
        
        if intent == "CREATE":
            console.print(f"[bold green]Intent Detected: CREATE_PROJECT[/bold green] -> {target}")
            from rich.prompt import Prompt
            project_name = Prompt.ask("Enter a name for the new project folder", default="new_project")
            create(description=target, project_name=project_name, parent_path=repo_path)
            messages.append({"role": "user", "content": f"I just scaffolded a new project: {project_name}"})
            messages.append({"role": "assistant", "content": "I have successfully generated the project structure."})
        elif intent == "IMPLEMENT":
            console.print(f"[bold cyan]Intent Detected: IMPLEMENT[/bold cyan] -> {target}")
            # Do NOT use a global status wrapper here, as it blocks the Safe Mode input prompt!
            implement(story=target, repo_path=repo_path)
            messages.append({"role": "user", "content": f"I just implemented: {target}"})
            messages.append({"role": "assistant", "content": "I have successfully generated and executed the implementation plan."})
        elif intent == "FIX":
            console.print(f"[bold red]Intent Detected: FIX[/bold red] -> {target}")
            # Do NOT use a global status wrapper here, as it blocks the Safe Mode input prompt!
            fix(target=target, repo_path=repo_path)
            messages.append({"role": "user", "content": f"I just ran a fix for: {target}"})
            messages.append({"role": "assistant", "content": "I have successfully repaired the issue."})
        else:
            messages.append({"role": "user", "content": user_input})
            
            from services.tools import AgentTools
            from rich.prompt import Confirm
            tools = AgentTools.get_tool_definitions()
            
            # Compress history before sending to LLM
            old_len = len(messages)
            messages = compress_history(messages, max_len=20)
            if len(messages) < old_len:
                console.print(f"[dim italic]Chat compressed (freed {old_len - len(messages)} messages from memory).[/dim italic]")
            
            while True:
                with console.status("[magenta]Thinking...[/magenta]", spinner="dots"):
                    response_msg = LLMService.agent_chat(messages, tools=tools)
                
                if not response_msg:
                    console.print("[red]Error: LLM returned empty response.[/red]")
                    break
                    
                messages.append(response_msg)
                
                if "tool_calls" in response_msg and response_msg["tool_calls"]:
                    for tool_call in response_msg["tool_calls"]:
                        func_name = tool_call.get("function", {}).get("name")
                        args = tool_call.get("function", {}).get("arguments", {})
                        
                        console.print(f"[dim yellow]Agent is calling tool:[/dim yellow] {func_name}({args})")
                        
                        if func_name == "run_command" and ConfigManager.is_safe_mode():
                            cmd_str = args.get('command', '')
                            if not Confirm.ask(f"[bold red]Allow agent to run command:[/bold red] '{cmd_str}'?"):
                                output = "User denied permission to run this command."
                                messages.append({"role": "tool", "content": output, "name": func_name})
                                continue
                                
                        try:
                            if func_name == "read_file":
                                output = AgentTools.read_file(args.get("path", ""))
                            elif func_name == "list_directory":
                                output = AgentTools.list_directory(args.get("path", "."))
                            elif func_name == "run_command":
                                output = AgentTools.run_command(args.get("command", ""))
                            else:
                                output = f"Error: Unknown tool {func_name}"
                        except Exception as e:
                            output = f"Error executing tool: {e}"
                            
                        tool_msg = {"role": "tool", "content": str(output), "name": func_name}
                        if "id" in tool_call:
                            tool_msg["tool_call_id"] = tool_call["id"]
                        messages.append(tool_msg)
                else:
                    final_text = response_msg.get("content", "")
                    console.print(f"\n[bold magenta]OPTCode:[/bold magenta] {final_text}\n")
                    break

if __name__ == "__main__":
    app()
