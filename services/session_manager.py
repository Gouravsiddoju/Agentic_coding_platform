import os
import json
import uuid
from typing import Dict, Any, List
from datetime import datetime

class SessionStatus:
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    ABORTED = "ABORTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class Session:
    def __init__(self, goal: str, session_id: str = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.goal = goal
        self.status = SessionStatus.CREATED
        self.tasks: List[Dict[str, Any]] = []
        self.agent_memory: List[Dict[str, Any]] = []
        self.repository_state: Dict[str, Any] = {}
        self.execution_state: Dict[str, Any] = {}
        self.repair_history: List[Dict[str, Any]] = []
        self.created_at = datetime.now().isoformat()
        self.updated_at = self.created_at
        self.workspace_path = None
        
    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "goal": self.goal,
            "status": self.status,
            "tasks": self.tasks,
            "agent_memory": self.agent_memory,
            "repository_state": self.repository_state,
            "execution_state": self.execution_state,
            "repair_history": self.repair_history,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "workspace_path": self.workspace_path
        }
        
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Session':
        session = cls(goal=data.get("goal", ""), session_id=data.get("session_id"))
        session.status = data.get("status", SessionStatus.CREATED)
        session.tasks = data.get("tasks", [])
        session.agent_memory = data.get("agent_memory", [])
        session.repository_state = data.get("repository_state", {})
        session.execution_state = data.get("execution_state", {})
        session.repair_history = data.get("repair_history", [])
        session.created_at = data.get("created_at", session.created_at)
        session.updated_at = data.get("updated_at", session.updated_at)
        session.workspace_path = data.get("workspace_path")
        return session

class SessionManager:
    SESSIONS_DIR = ".codeme_db/sessions"
    
    @classmethod
    def _ensure_dir(cls):
        os.makedirs(cls.SESSIONS_DIR, exist_ok=True)
        
    @classmethod
    def get_session_path(cls, session_id: str) -> str:
        cls._ensure_dir()
        return os.path.join(cls.SESSIONS_DIR, f"{session_id}.json")

    @classmethod
    def create_session(cls, goal: str) -> Session:
        session = Session(goal=goal)
        cls.save_session(session)
        return session

    @classmethod
    def get_session(cls, session_id: str) -> Session:
        path = cls.get_session_path(session_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return Session.from_dict(data)
        except Exception as e:
            print(f"Failed to load session {session_id}: {e}")
            return None

    @classmethod
    def save_session(cls, session: Session):
        session.updated_at = datetime.now().isoformat()
        path = cls.get_session_path(session.session_id)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(session.to_dict(), f, indent=2)
        except Exception as e:
            print(f"Failed to save session {session.session_id}: {e}")

    @classmethod
    def list_sessions(cls) -> List[Session]:
        cls._ensure_dir()
        sessions = []
        for file in os.listdir(cls.SESSIONS_DIR):
            if file.endswith(".json"):
                session_id = file[:-5]
                session = cls.get_session(session_id)
                if session:
                    sessions.append(session)
        # Sort by updated_at descending
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions
