import json
import uuid
from collections import deque
from typing import List, Dict, Any
from .llm_service import LLMService
from .events import EventBus, AgentEvent, AgentEventType
from .agents import ArchitectAgent, EngineeringAgent, RepairAgent, _strip_json
from .verification import VerificationAgent
from .gitops import GitOpsAgent

class CoordinatorAgent:
    def __init__(self, repo_path: str = ".", session_id: str = None):
        self.repo_path = repo_path
        self.session_id = session_id or str(uuid.uuid4())
        self.bus = EventBus.for_session(self.session_id)
        
    def breakdown_goal(self, goal: str) -> List[Dict[str, Any]]:
        self.bus.publish(AgentEvent(AgentEventType.THINKING, "Coordinator: Breaking down goal into tasks...", session_id=self.session_id))
        system_prompt = (
            "You are the Lead Coordinator Agent. Break down the user's high-level goal into a series of steps. "
            "Available Agents: Architect, Engineer, Verifier, GitOps. "
            "Output pure JSON ONLY:\n"
            "[\n"
            "  {\"id\": \"1\", \"agent\": \"Architect\", \"task\": \"Design X\"},\n"
            "  {\"id\": \"2\", \"agent\": \"Engineer\", \"task\": \"Implement X\", \"depends_on\": [\"1\"]}\n"
            "]"
        )
        response = LLMService.generate_completion(goal, system_prompt)
        try:
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
            return json.loads(response.strip())
        except Exception as e:
            print(f"Coordinator failed to parse breakdown: {e}")
            return [{"id": "1", "agent": "Architect", "task": goal}]

    def _topological_sort(self, tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Kahn's algorithm — respects depends_on edges, raises on cycles."""
        task_map = {t["id"]: t for t in tasks}
        in_degree: Dict[str, int] = {t["id"]: 0 for t in tasks}
        dependents: Dict[str, List[str]] = {t["id"]: [] for t in tasks}

        for task in tasks:
            for dep in task.get("depends_on", []):
                if dep in in_degree:
                    in_degree[task["id"]] += 1
                    dependents[dep].append(task["id"])

        queue = deque([tid for tid, deg in in_degree.items() if deg == 0])
        ordered = []

        while queue:
            tid = queue.popleft()
            ordered.append(task_map[tid])
            for child in dependents[tid]:
                in_degree[child] -= 1
                if in_degree[child] == 0:
                    queue.append(child)

        if len(ordered) != len(tasks):
            raise ValueError("Cycle detected in task dependency graph — cannot execute.")

        return ordered

    def execute_workflow(self, goal: str):
        raw_tasks = self.breakdown_goal(goal)
        self.bus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Coordinator defined {len(raw_tasks)} tasks.", session_id=self.session_id))

        try:
            tasks = self._topological_sort(raw_tasks)
            self.bus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, "Task graph resolved — executing in dependency order.", session_id=self.session_id))
        except ValueError as e:
            self.bus.publish(AgentEvent(AgentEventType.ERROR, str(e), session_id=self.session_id))
            return

        context: Dict[str, Any] = {}
        for task in tasks:
            agent_type = task.get("agent")
            task_desc = task.get("task")
            task_id = task.get("id")

            self.bus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"[{task_id}] Delegating to {agent_type}: {task_desc}", session_id=self.session_id))

            if agent_type == "Architect":
                architect = ArchitectAgent(self.repo_path, session_id=self.session_id)
                plan = architect.plan_implementation(task_desc)
                context["plan"] = plan
                context[f"plan_{task_id}"] = plan
            elif agent_type == "Engineer":
                engineer = EngineeringAgent(self.repo_path, session_id=self.session_id)
                # Use the most recent Architect plan, or the plan from a specific dependency
                dep_plan = None
                for dep_id in task.get("depends_on", []):
                    if f"plan_{dep_id}" in context:
                        dep_plan = context[f"plan_{dep_id}"]
                        break
                plan_to_use = dep_plan or context.get("plan")
                if plan_to_use:
                    engineer.execute_plan(plan_to_use)
                else:
                    self.bus.publish(AgentEvent(AgentEventType.ERROR, f"[{task_id}] Engineer cannot execute without an Architect's plan.", session_id=self.session_id))
            elif agent_type == "Verifier":
                verifier = VerificationAgent(self.repo_path, self.session_id)
                res = verifier.run_pipeline()
                if not res["success"]:
                    self.bus.publish(AgentEvent(AgentEventType.ERROR, f"[{task_id}] Verification failed, Coordinator halting.", session_id=self.session_id))
                    break
            elif agent_type == "GitOps":
                gitops = GitOpsAgent(self.repo_path)
                gitops.create_branch(f"feature/{self.session_id[:8]}")
                gitops.commit_changes(task_desc)

        self.bus.publish(AgentEvent(AgentEventType.COMPLETE, "Coordinator workflow finished.", session_id=self.session_id))

