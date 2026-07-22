from enum import Enum, auto
from typing import Any, Callable, Dict, List
from datetime import datetime

class AgentEventType(str, Enum):
    THINKING = "THINKING"
    PLANNING = "PLANNING"
    TOOL_USE = "TOOL_USE"
    TOOL_RESULT = "TOOL_RESULT"
    FILE_CHANGED = "FILE_CHANGED"
    TEST_STARTED = "TEST_STARTED"
    TEST_FAILED = "TEST_FAILED"
    TEST_PASSED = "TEST_PASSED"
    GIT_ACTION = "GIT_ACTION"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"
    STATUS_UPDATE = "STATUS_UPDATE"

class AgentEvent:
    def __init__(self, event_type: AgentEventType, message: str, payload: Dict[str, Any] = None, session_id: str = None):
        self.event_type = event_type
        self.message = message
        self.payload = payload or {}
        self.session_id = session_id
        self.timestamp = datetime.now().isoformat()
        
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.event_type.value,
            "message": self.message,
            "payload": self.payload,
            "session_id": self.session_id,
            "timestamp": self.timestamp
        }

class EventBus:
    _subscribers: Dict[AgentEventType, List[Callable[[AgentEvent], None]]] = {}
    _global_subscribers: List[Callable[[AgentEvent], None]] = []

    @classmethod
    def subscribe(cls, event_type: AgentEventType, callback: Callable[[AgentEvent], None]):
        if event_type not in cls._subscribers:
            cls._subscribers[event_type] = []
        cls._subscribers[event_type].append(callback)

    @classmethod
    def subscribe_all(cls, callback: Callable[[AgentEvent], None]):
        cls._global_subscribers.append(callback)

    @classmethod
    def publish(cls, event: AgentEvent):
        # Notify specific subscribers
        if event.event_type in cls._subscribers:
            for callback in cls._subscribers[event.event_type]:
                try:
                    callback(event)
                except Exception as e:
                    print(f"Error in event subscriber: {e}")
                    
        # Notify global subscribers
        for callback in cls._global_subscribers:
            try:
                callback(event)
            except Exception as e:
                print(f"Error in global event subscriber: {e}")
