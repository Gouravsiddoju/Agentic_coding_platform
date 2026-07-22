import json
import uuid
import concurrent.futures
from typing import List, Dict, Any
from services.llm_service import LLMService
from services.events import EventBus, AgentEvent, AgentEventType
from services.agents import ArchitectAgent, EngineeringAgent, RepairAgent
from services.verification import VerificationAgent
from services.gitops import GitOpsAgent

class CoordinatorAgent:
    def __init__(self, repo_path: str = ".", session_id: str = None):
        self.repo_path = repo_path
        self.session_id = session_id or str(uuid.uuid4())
        
    def breakdown_goal(self, goal: str) -> List[Dict[str, Any]]:
        EventBus.publish(AgentEvent(AgentEventType.THINKING, "Coordinator: Breaking down goal into tasks...", session_id=self.session_id))
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
            
    def execute_workflow(self, goal: str):
        tasks = self.breakdown_goal(goal)
        EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Coordinator defined {len(tasks)} tasks.", session_id=self.session_id))
        
        # In a real async environment we'd use asyncio with topological sort for depends_on.
        # For MVP, we will execute sequentially as ordered by LLM, which is usually correct.
        
        context = {}
        for task in tasks:
            agent_type = task.get("agent")
            task_desc = task.get("task")
            
            EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Delegating to {agent_type}: {task_desc}", session_id=self.session_id))
            
            if agent_type == "Architect":
                architect = ArchitectAgent(self.repo_path)
                plan = architect.plan_implementation(task_desc)
                context["plan"] = plan
            elif agent_type == "Engineer":
                engineer = EngineeringAgent(self.repo_path)
                if "plan" in context:
                    engineer.execute_plan(context["plan"])
                else:
                    EventBus.publish(AgentEvent(AgentEventType.ERROR, "Engineer cannot execute without an Architect's plan.", session_id=self.session_id))
            elif agent_type == "Verifier":
                verifier = VerificationAgent(self.repo_path, self.session_id)
                res = verifier.run_pipeline()
                if not res["success"]:
                    EventBus.publish(AgentEvent(AgentEventType.ERROR, "Verification failed, Coordinator halting.", session_id=self.session_id))
                    # Could invoke RepairAgent here
                    break
            elif agent_type == "GitOps":
                gitops = GitOpsAgent(self.repo_path)
                gitops.create_branch(f"feature/{self.session_id[:8]}")
                gitops.commit_changes(task_desc)
                
        EventBus.publish(AgentEvent(AgentEventType.COMPLETE, "Coordinator workflow finished.", session_id=self.session_id))
