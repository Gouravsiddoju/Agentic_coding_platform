"""
EventBus — session-scoped publish/subscribe event system.

Key design decisions:
  - Each session gets its OWN EventBus instance via EventBus.for_session(session_id).
    Global (class-level) subscribers still exist for the API layer to broadcast ALL
    events to the WebSocket, but per-session subscribers are isolated.
  - publish() logs exceptions rather than swallowing them silently.
  - AgentEvent carries a structured `to_dict()` for JSON serialisation.
"""

from __future__ import annotations

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


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
    AGENT_SPAWNED = "AGENT_SPAWNED"


class AgentEvent:
    def __init__(
        self,
        event_type: AgentEventType,
        message: str,
        payload: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ):
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
            "timestamp": self.timestamp,
        }


class EventBus:
    """
    Two-layer event bus:
      Layer 1 — global subscribers (API WebSocket bridge).  Receives every event.
      Layer 2 — per-session subscribers.  Isolated per session_id.

    Usage:
        # Global (API layer):
        EventBus.subscribe_all(my_callback)

        # Per-session:
        bus = EventBus.for_session(session_id)
        bus.subscribe(AgentEventType.ERROR, handle_error)
        bus.publish(AgentEvent(AgentEventType.THINKING, "planning..."))
    """

    # ── Class-level (global) subscribers ────────────────────────────────
    _global_subscribers: List[Callable[[AgentEvent], None]] = []

    # ── Per-session registry ─────────────────────────────────────────────
    _session_buses: Dict[str, "EventBus"] = {}

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._subscribers: Dict[AgentEventType, List[Callable[[AgentEvent], None]]] = {}

    # ── Per-session factory ──────────────────────────────────────────────

    @classmethod
    def for_session(cls, session_id: str) -> "EventBus":
        if session_id not in cls._session_buses:
            cls._session_buses[session_id] = cls(session_id)
        return cls._session_buses[session_id]

    @classmethod
    def release_session(cls, session_id: str) -> None:
        """Clean up a finished session's bus to free memory."""
        cls._session_buses.pop(session_id, None)

    # ── Global subscription (for WebSocket broadcast) ────────────────────

    @classmethod
    def subscribe_all(cls, callback: Callable[[AgentEvent], None]) -> None:
        cls._global_subscribers.append(callback)

    @classmethod
    def unsubscribe_all(cls, callback: Callable[[AgentEvent], None]) -> None:
        try:
            cls._global_subscribers.remove(callback)
        except ValueError:
            pass

    # ── Per-session subscription ─────────────────────────────────────────

    def subscribe(
        self,
        event_type: AgentEventType,
        callback: Callable[[AgentEvent], None],
    ) -> None:
        self._subscribers.setdefault(event_type, []).append(callback)

    # ── Publish ──────────────────────────────────────────────────────────

    def publish(self, event: AgentEvent) -> None:
        """Publish to per-session subscribers, then global subscribers."""
        # Per-session
        for cb in self._subscribers.get(event.event_type, []):
            self._call(cb, event)

        # Global (API layer)
        for cb in self.__class__._global_subscribers:
            self._call(cb, event)

    @staticmethod
    def _call(callback: Callable[[AgentEvent], None], event: AgentEvent) -> None:
        try:
            callback(event)
        except Exception as exc:
            logger.error(
                "EventBus subscriber raised: %s (event=%s, msg=%s)",
                exc,
                event.event_type,
                event.message[:80],
            )

    # ── Legacy class-method publish (backwards compat) ───────────────────
    @classmethod
    def publish_global(cls, event: AgentEvent) -> None:
        """Publish without a session bus — only hits global subscribers."""
        for cb in cls._global_subscribers:
            cls._call(cb, event)
