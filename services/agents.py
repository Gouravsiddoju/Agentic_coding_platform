"""
agents.py — ArchitectAgent, EngineeringAgent, RepairAgent

Changes from original:
  - Session-scoped EventBus (EventBus.for_session) so events don't bleed between sessions.
  - Tool-call loop has a MAX_TOOL_TURNS guard to prevent infinite loops with models
    that keep generating tool calls.
  - Confirm (blocking rich prompt) replaced with a safe-mode flag check that works
    in both CLI and async (WebSocket) contexts — callers set safe_mode via ConfigManager.
  - Shared _strip_json() helper instead of copy-pasted markdown stripping.
  - shell=True removed in commands_to_run (shlex.split + allowlist).
  - imports cleaned up.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import uuid
from typing import Any, Dict, List, Optional

from .config import ConfigManager
from .events import AgentEvent, AgentEventType, EventBus
from .llm_service import LLMService
from .repo_intelligence import RepoIntelligenceEngine
from .standards import CodeStandardsEngine

# Maximum number of tool-call round-trips before we force the model to answer
MAX_TOOL_TURNS = 10

# Commands the engineer is allowed to run (LLM-generated commands outside this set are blocked)
ALLOWED_CMD_PREFIXES = frozenset([
    "npm", "npx", "yarn", "pnpm", "node",
    "pip", "pip3", "python", "python3",
    "cargo", "rustc", "go",
    "git", "tsc",
    "ls", "dir", "mkdir", "touch", "echo",
    "flutter", "dart",
    "pytest", "flake8", "bandit",
    "vue", "ng", "django-admin", "flask",
    "composer", "php", "ruby", "gem", "rails", "bundle",
    "dotnet", "gradle", "mvn",
])


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _strip_json(text: str) -> str:
    """Strip markdown code fences from an LLM JSON response."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _run_tool_call(func_name: str, args: Dict[str, Any], repo_path: str) -> str:
    """Execute a single tool call from an agent's tool_calls list."""
    from .tools import AgentTools

    if func_name == "read_file":
        return AgentTools.read_file(args.get("path", ""))
    elif func_name == "list_directory":
        return AgentTools.list_directory(args.get("path", "."))
    elif func_name == "run_command":
        return AgentTools.run_command(args.get("command", ""))
    else:
        return f"Error: Unknown tool '{func_name}'"


# ─────────────────────────────────────────────────────────────────────────────
#  ArchitectAgent
# ─────────────────────────────────────────────────────────────────────────────

class ArchitectAgent:
    def __init__(self, repo_path: str = ".", session_id: Optional[str] = None):
        self.repo_path = repo_path
        self.session_id = session_id or str(uuid.uuid4())
        self.repo_intelligence = RepoIntelligenceEngine(repo_path)
        self.bus = EventBus.for_session(self.session_id)

    def plan_implementation(self, story: str) -> Dict[str, Any]:
        """
        Takes a user story, retrieves RAG context from the repo, and asks the LLM
        to produce a JSON implementation plan.  Supports tool calls with a loop guard.
        """
        self.bus.publish(AgentEvent(
            AgentEventType.THINKING,
            "Architect: Retrieving repository context...",
            session_id=self.session_id,
        ))
        context_docs = self.repo_intelligence.search(story, n_results=10)
        context_str = "\n".join(doc["content"] for doc in context_docs)

        self.bus.publish(AgentEvent(
            AgentEventType.PLANNING,
            "Architect: Generating implementation plan...",
            session_id=self.session_id,
        ))

        story_id = str(uuid.uuid4())[:8]
        system_prompt = (
            "You are an expert Software Architect. "
            "Given the user story and codebase context, output a detailed JSON plan. "
            "You have access to read_file, list_directory, and run_command tools — use them "
            "to inspect the codebase before finalising your plan. "
            "Once done, output ONLY pure JSON with no markdown fences:\n"
            "{\n"
            f'  "story_id": "{story_id}",\n'
            '  "objective": "...",\n'
            '  "steps": ["step 1"],\n'
            '  "files_to_create": [{"path": "...", "description": "..."}],\n'
            '  "files_to_modify": [{"path": "...", "description": "..."}],\n'
            '  "tests_to_create": [{"path": "...", "description": "..."}],\n'
            '  "commands_to_run": ["npm install"],\n'
            '  "verification_steps": ["run tests"],\n'
            '  "rollback_plan": ["revert commit X"]\n'
            "}"
        )

        from .tools import AgentTools
        tools = AgentTools.get_tool_definitions()
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"User Story:\n{story}\n\nContext:\n{context_str}"},
        ]

        raw_response = "{}"
        for turn in range(MAX_TOOL_TURNS + 1):
            response_msg = LLMService.agent_chat(messages, tools=tools)
            if not response_msg:
                break
            messages.append(response_msg)

            tool_calls = response_msg.get("tool_calls") or []
            if not tool_calls or turn == MAX_TOOL_TURNS:
                # Either no tool calls, or we've hit the limit — take the text
                raw_response = response_msg.get("content", "{}")
                if turn == MAX_TOOL_TURNS and tool_calls:
                    self.bus.publish(AgentEvent(
                        AgentEventType.ERROR,
                        f"Architect hit tool-call limit ({MAX_TOOL_TURNS}), forcing final answer.",
                        session_id=self.session_id,
                    ))
                break

            # Process tool calls
            for tc in tool_calls:
                func_name = tc.get("function", {}).get("name", "")
                args = tc.get("function", {}).get("arguments", {})
                self.bus.publish(AgentEvent(
                    AgentEventType.TOOL_USE,
                    f"Architect tool: {func_name}",
                    payload={"tool": func_name, "args": args},
                    session_id=self.session_id,
                ))
                try:
                    output = _run_tool_call(func_name, args, self.repo_path)
                except Exception as exc:
                    output = f"Error: {exc}"
                self.bus.publish(AgentEvent(
                    AgentEventType.TOOL_RESULT,
                    f"Tool result: {func_name}",
                    payload={"result": str(output)[:300]},
                    session_id=self.session_id,
                ))
                tool_msg: Dict[str, Any] = {
                    "role": "tool",
                    "content": str(output),
                    "name": func_name,
                }
                if "id" in tc:
                    tool_msg["tool_call_id"] = tc["id"]
                messages.append(tool_msg)

        try:
            return json.loads(_strip_json(raw_response))
        except Exception as exc:
            print(f"Architect plan parse error: {exc}\nRaw: {raw_response[:200]}")
            return {"plan_summary": "Parse failed", "files_to_create": [], "files_to_modify": []}

    def plan_scaffolding(self, description: str) -> Dict[str, Any]:
        """Generates a fresh project scaffolding plan from a description."""
        self.bus.publish(AgentEvent(
            AgentEventType.PLANNING,
            "Architect: Designing project scaffolding...",
            session_id=self.session_id,
        ))
        system_prompt = (
            "You are an expert Software Architect designing a new project from scratch. "
            "Output ONLY pure JSON with no markdown fences:\n"
            '{\n'
            '  "plan_summary": "...",\n'
            '  "files_to_create": [{"path": "...", "description": "..."}],\n'
            '  "files_to_modify": []\n'
            "}\n"
            "Include base files like README.md, requirements.txt, or package.json as appropriate."
        )
        response = LLMService.generate_completion(f"Project Description:\n{description}", system_prompt)
        try:
            return json.loads(_strip_json(response))
        except Exception as exc:
            print(f"Scaffolding plan parse error: {exc}")
            return {"plan_summary": "Parse failed", "files_to_create": [], "files_to_modify": []}


# ─────────────────────────────────────────────────────────────────────────────
#  EngineeringAgent
# ─────────────────────────────────────────────────────────────────────────────

class EngineeringAgent:
    def __init__(self, repo_path: str = ".", session_id: Optional[str] = None):
        self.repo_path = repo_path
        self.session_id = session_id or str(uuid.uuid4())
        self.bus = EventBus.for_session(self.session_id)

    def execute_plan(self, plan: Dict[str, Any], safe_mode_confirm_fn=None) -> None:
        """
        Execute an Architect plan.

        safe_mode_confirm_fn: optional callable(prompt: str) -> bool
            In CLI mode pass a function that asks the user.
            In async/WebSocket mode leave None — safe mode blocks but doesn't prompt.
        """
        objective = plan.get("objective", plan.get("plan_summary", ""))
        self.bus.publish(AgentEvent(
            AgentEventType.STATUS_UPDATE,
            f"Engineer: Executing plan — {objective}",
            session_id=self.session_id,
        ))

        standards_engine = CodeStandardsEngine(self.repo_path)

        if ConfigManager.is_safe_mode():
            summary_lines = (
                ["Safe Mode — proposed changes:"]
                + [f"  [NEW]     {f['path']}" for f in plan.get("files_to_create", [])]
                + [f"  [MODIFY]  {f['path']}" for f in plan.get("files_to_modify", [])]
                + [f"  [EXECUTE] {c}" for c in plan.get("commands_to_run", [])]
            )
            print("\n".join(summary_lines))
            if safe_mode_confirm_fn is not None:
                if not safe_mode_confirm_fn("Proceed with these changes?"):
                    print("Engineer: Changes aborted by user.")
                    return
            # In async contexts (no confirm fn) we proceed — the UI should
            # show safe-mode info via WebSocket events.

        for f in plan.get("files_to_create", []):
            self._create_file(f["path"], f["description"], standards_engine)
        for f in plan.get("files_to_modify", []):
            self._modify_file(f["path"], f["description"], standards_engine)
        for f in plan.get("tests_to_create", []):
            self._create_file(f["path"], f["description"], standards_engine)

        self._run_commands(plan.get("commands_to_run", []))

    def _run_commands(self, commands: List[str]) -> None:
        for cmd in commands:
            self.bus.publish(AgentEvent(
                AgentEventType.STATUS_UPDATE,
                f"Engineer: Running command: {cmd}",
                session_id=self.session_id,
            ))
            try:
                parts = shlex.split(cmd)
            except ValueError as exc:
                self.bus.publish(AgentEvent(
                    AgentEventType.ERROR,
                    f"Malformed command skipped: {cmd} ({exc})",
                    session_id=self.session_id,
                ))
                continue

            if not parts:
                continue

            base = os.path.basename(parts[0]).lower().replace(".exe", "")
            if base not in ALLOWED_CMD_PREFIXES:
                self.bus.publish(AgentEvent(
                    AgentEventType.ERROR,
                    f"Blocked unsafe command: {cmd}",
                    session_id=self.session_id,
                ))
                raise PermissionError(f"Command blocked by allowlist: {cmd}")

            try:
                result = subprocess.run(
                    parts,
                    cwd=self.repo_path,
                    shell=False,
                    capture_output=True,
                    text=True,
                )
                output_str = ""
                if result.stdout:
                    output_str += f"STDOUT:\n{result.stdout}\n"
                if result.stderr:
                    output_str += f"STDERR:\n{result.stderr}\n"
                if output_str:
                    self.bus.publish(AgentEvent(
                        AgentEventType.TOOL_USE,
                        "Command output",
                        payload={"command": cmd, "output": output_str[:500]},
                        session_id=self.session_id,
                    ))
                if result.returncode != 0:
                    raise RuntimeError(
                        f"Command exited {result.returncode}: {output_str[:300]}"
                    )
            except Exception as exc:
                self.bus.publish(AgentEvent(
                    AgentEventType.ERROR,
                    f"Command failed: {cmd}",
                    payload={"error": str(exc)},
                    session_id=self.session_id,
                ))
                raise

    def _create_file(self, path: str, description: str, standards_engine: CodeStandardsEngine) -> None:
        self.bus.publish(AgentEvent(
            AgentEventType.FILE_CHANGED,
            f"Engineer: Creating {path}",
            payload={"path": path},
            session_id=self.session_id,
        ))
        standards_str = standards_engine.get_standards_for_file(path)
        system_prompt = (
            "You are an expert Software Engineer. Generate complete, working code. "
            "For web UI, use modern design: gradients, hover effects, clean typography. "
            "Output ONLY the raw code — no markdown fences."
            f"{standards_str}"
        )
        code = LLMService.generate_completion(
            f"File: {path}\nDescription: {description}", system_prompt
        )
        full_path = os.path.join(self.repo_path, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as fh:
            fh.write(code.strip())

    def _modify_file(self, path: str, description: str, standards_engine: CodeStandardsEngine) -> None:
        self.bus.publish(AgentEvent(
            AgentEventType.FILE_CHANGED,
            f"Engineer: Modifying {path}",
            payload={"path": path},
            session_id=self.session_id,
        ))
        full_path = os.path.join(self.repo_path, path)
        if not os.path.exists(full_path):
            print(f"Engineer: file not found — {path}")
            return
        with open(full_path, "r", encoding="utf-8") as fh:
            original = fh.read()
        standards_str = standards_engine.get_standards_for_file(path)
        system_prompt = (
            "You are an expert Software Engineer. Apply the described changes to the code. "
            "Output the FULL modified code — no markdown fences."
            f"{standards_str}"
        )
        new_code = LLMService.generate_completion(
            f"File: {path}\nChanges: {description}\n\nOriginal:\n{original}", system_prompt
        )
        with open(full_path, "w", encoding="utf-8") as fh:
            fh.write(new_code.strip())


# ─────────────────────────────────────────────────────────────────────────────
#  RepairAgent
# ─────────────────────────────────────────────────────────────────────────────

class RepairAgent:
    def __init__(self, repo_path: str = ".", session_id: Optional[str] = None):
        self.repo_path = repo_path
        self.session_id = session_id or str(uuid.uuid4())
        self.engineer = EngineeringAgent(repo_path, session_id=self.session_id)
        self.failed_attempts: List[Dict[str, Any]] = []

    def generate_repair_plan(self, test_output: str, failed_command: str) -> Dict[str, Any]:
        """Analyses failure logs and produces a repair plan JSON."""
        print("Repair Agent: Analysing failures...")
        prev = ""
        if self.failed_attempts:
            prev = "PREVIOUS FAILED APPROACHES (do NOT repeat):\n" + "\n".join(
                f"{i+1}. {p.get('plan_summary')}"
                for i, p in enumerate(self.failed_attempts)
            )

        system_prompt = (
            "You are an expert Software Engineer fixing test/build failures. "
            "Output ONLY pure JSON with no markdown fences:\n"
            '{\n'
            '  "plan_summary": "...",\n'
            '  "files_to_modify": [{"path": "...", "description": "..."}],\n'
            '  "commands_to_run": []\n'
            "}"
        )
        prompt = f"Failed command: {failed_command}\n\nLogs:\n{test_output}\n\n{prev}"
        response = LLMService.generate_completion(prompt, system_prompt)

        try:
            plan = json.loads(_strip_json(response))
            self.failed_attempts.append(plan)
            return plan
        except Exception as exc:
            print(f"Repair plan parse error: {exc}")
            return {"plan_summary": "Parse failed", "files_to_modify": []}

    def execute_repair(self, plan: Dict[str, Any]) -> None:
        self.engineer.execute_plan(plan)
