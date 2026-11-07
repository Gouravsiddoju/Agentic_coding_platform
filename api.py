"""
CodeMe Python API — FastAPI backend

Features:
  - WebSocket /ws/chat          → streaming chat with Ollama (token-by-token)
  - GET  /api/status            → Ollama health + installed models
  - GET  /api/models            → list installed Ollama models
  - POST /api/models/set        → set active model
  - GET  /api/conversations     → list all saved conversations
  - GET  /api/conversations/{id}→ get one conversation's messages
  - DEL  /api/conversations/{id}→ delete a conversation
  - Agent pipelines (IMPLEMENT / CREATE / FIX) via WebSocket
"""

import json
import os
import asyncio
import uuid
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import requests as _requests   # used only for streaming raw response

from services.intent_router import IntentRouter
from services.llm_service import LLMService
from services.config import ConfigManager
from services.tools import AgentTools
from services.agents import ArchitectAgent, EngineeringAgent, RepairAgent
from services.events import EventBus, AgentEvent, AgentEventType
from services.session_manager import SessionManager, SessionStatus
from services.workspace import WorkspaceManager
from services.ollama_client import OllamaClient

# ── CORS ──────────────────────────────────────────────────────────────────────
_raw_origins = os.getenv(
    "CODEME_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,app://."
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# ── Conversation persistence (SQLite) ─────────────────────────────────────────
_DB_DIR = Path(os.getenv("CODEME_DATA_DIR", Path.home() / ".codeme"))
_DB_DIR.mkdir(parents=True, exist_ok=True)
_CONV_DB = _DB_DIR / "conversations.db"

def _get_conv_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_CONV_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    return conn

def _save_conversation(conv_id: str, title: str, model: str, messages: list):
    conn = _get_conv_db()
    now = datetime.utcnow().isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO conversations (id, title, model, created_at, updated_at) VALUES (?,?,?,?,?)",
        (conv_id, title, model, now, now)
    )
    conn.execute("UPDATE conversations SET updated_at=?, model=? WHERE id=?", (now, model, conv_id))
    # Re-insert all messages (simpler than diffing for MVP)
    conn.execute("DELETE FROM messages WHERE conversation_id=?", (conv_id,))
    for m in messages:
        if m.get("role") in ("user", "assistant"):
            conn.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
                (conv_id, m["role"], m.get("content", ""), now)
            )
    conn.commit()
    conn.close()

# ── Per-connection state ───────────────────────────────────────────────────────
# { ws_id: {"messages": list, "conv_id": str, "title": str} }
_ws_state: dict = {}

def _get_state(ws_id: int) -> dict:
    if ws_id not in _ws_state:
        model = ConfigManager.get_llm_model()
        _ws_state[ws_id] = {
            "conv_id": str(uuid.uuid4()),
            "title": "New conversation",
            "model": model,
            "messages": [{
                "role": "system",
                "content": (
                    "You are CodeMe, an autonomous AI Software Engineer running on the user's "
                    "local machine. You can read/write files and run commands through your agent "
                    "tools. Be helpful, use rich markdown, and be concise."
                )
            }]
        }
    return _ws_state[ws_id]

def _persist_state(ws_id: int):
    s = _ws_state.get(ws_id)
    if s:
        _save_conversation(s["conv_id"], s["title"], s["model"], s["messages"])

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="CodeMe Desktop API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── WebSocket broadcast manager ────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws) if hasattr(self.active, "discard") else None
        if ws in self.active:
            self.active.remove(ws)

    async def send(self, msg: dict, ws: WebSocket):
        try:
            await ws.send_json(msg)
        except Exception:
            pass

    async def broadcast(self, msg: dict):
        for ws in list(self.active):
            await self.send(msg, ws)

manager = ConnectionManager()

# ── EventBus → WebSocket bridge ───────────────────────────────────────────────
_event_queue: asyncio.Queue = asyncio.Queue()

def _event_bus_callback(event: AgentEvent):
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon_threadsafe(_event_queue.put_nowait, event)
    except RuntimeError:
        pass

EventBus.subscribe_all(_event_bus_callback)

async def _event_consumer():
    while True:
        event = await _event_queue.get()
        await manager.broadcast({
            "type": "agent_event",
            "event_type": event.event_type.value,
            "message": event.message,
            "payload": event.payload,
            "session_id": event.session_id,
            "timestamp": event.timestamp,
        })

# ── Startup ────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(_event_consumer())
    if OllamaClient.health_check():
        models = OllamaClient.list_models()
        print(f"[CodeMe] Ollama connected. Models: {models}")
    else:
        print("[CodeMe] WARNING: Ollama not reachable. Run: ollama serve")

# ── REST endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    ollama_ok = OllamaClient.health_check()
    models = OllamaClient.list_models() if ollama_ok else []
    current_model = ConfigManager.get_llm_model()
    embed_model = ConfigManager.get_embed_model()
    return {
        "status": "ok",
        "ollama": {
            "url": ConfigManager.get_ollama_url(),
            "reachable": ollama_ok,
            "installed_models": models,
            "active_model": current_model,
            "model_ready": current_model in models,
            "embed_model": embed_model,
            "embed_model_ready": embed_model in models,
        },
    }

@app.get("/api/models")
async def list_models():
    """List all locally installed Ollama models."""
    if not OllamaClient.health_check():
        raise HTTPException(503, "Ollama is not running")
    return {"models": OllamaClient.list_models(), "active": ConfigManager.get_llm_model()}

class SetModelRequest(BaseModel):
    model: str

@app.post("/api/models/set")
async def set_model(req: SetModelRequest):
    """Switch the active model. Persists to .codeme config."""
    models = OllamaClient.list_models()
    if req.model not in models:
        raise HTTPException(404, f"Model '{req.model}' not installed. Pull it first.")
    ConfigManager.set_model(req.model)
    return {"ok": True, "active": req.model}

@app.get("/api/conversations")
async def list_conversations():
    conn = _get_conv_db()
    rows = conn.execute(
        "SELECT id, title, model, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return {"conversations": [dict(r) for r in rows]}

@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conn = _get_conv_db()
    conv = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
    if not conv:
        conn.close()
        raise HTTPException(404, "Conversation not found")
    msgs = conn.execute(
        "SELECT role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id",
        (conv_id,)
    ).fetchall()
    conn.close()
    return {"conversation": dict(conv), "messages": [dict(m) for m in msgs]}

@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    conn = _get_conv_db()
    conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Streaming helper ───────────────────────────────────────────────────────────

async def _stream_chat(messages: list, ws: WebSocket, model: str) -> str:
    """
    Streams a chat response from Ollama token-by-token.
    Sends {"type":"stream_token","token":"..."} frames to the client.
    Returns the full assembled response string.
    """
    ollama_url = ConfigManager.get_ollama_url()
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {"num_ctx": int(os.getenv("CODEME_OLLAMA_CTX", "32768"))},
    }

    full_text = ""
    await manager.send({"type": "stream_start"}, ws)

    try:
        # Run the blocking streaming HTTP call in a thread so we don't block the loop
        def _do_stream():
            with _requests.post(
                f"{ollama_url}/api/chat",
                json=payload,
                stream=True,
                timeout=int(os.getenv("CODEME_OLLAMA_TIMEOUT", "300")),
            ) as resp:
                resp.raise_for_status()
                return [line for line in resp.iter_lines() if line]

        lines = await asyncio.to_thread(_do_stream)

        for line in lines:
            try:
                chunk = json.loads(line)
                token = chunk.get("message", {}).get("content", "")
                if token:
                    full_text += token
                    await manager.send({"type": "stream_token", "token": token}, ws)
                if chunk.get("done"):
                    break
            except json.JSONDecodeError:
                continue

    except Exception as exc:
        await manager.send({"type": "error", "content": f"Stream error: {exc}"}, ws)

    await manager.send({"type": "stream_end", "content": full_text}, ws)
    return full_text

# ── Helpers ────────────────────────────────────────────────────────────────────

def _compress(history: list, max_len: int = 20) -> list:
    if len(history) <= max_len:
        return history
    sys = history[0]
    idx = len(history) - max_len + 1
    while idx < len(history) and history[idx].get("role") != "user":
        idx += 1
    if idx >= len(history):
        idx = len(history) - 5
    return [sys] + history[idx:]

# ── WebSocket /ws/chat ─────────────────────────────────────────────────────────

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await manager.connect(websocket)
    ws_id = id(websocket)
    state = _get_state(ws_id)
    repo_path = "."

    try:
        while True:
            data = await websocket.receive_text()

            # Handle JSON control frames from frontend
            try:
                frame = json.loads(data)
                if isinstance(frame, dict):
                    ftype = frame.get("type")

                    if ftype == "set_model":
                        new_model = frame.get("model", "")
                        if new_model in OllamaClient.list_models():
                            ConfigManager.set_model(new_model)
                            state["model"] = new_model
                            await manager.send({"type": "model_set", "model": new_model}, websocket)
                        else:
                            await manager.send({"type": "error", "content": f"Model '{new_model}' not installed."}, websocket)
                        continue

                    if ftype == "load_conversation":
                        conv_id = frame.get("conv_id")
                        if conv_id:
                            conn = _get_conv_db()
                            conv = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
                            msgs = conn.execute(
                                "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id",
                                (conv_id,)
                            ).fetchall()
                            conn.close()
                            if conv:
                                state["conv_id"] = conv_id
                                state["title"] = conv["title"]
                                state["model"] = conv["model"]
                                state["messages"] = [state["messages"][0]] + [
                                    {"role": m["role"], "content": m["content"]} for m in msgs
                                ]
                                await manager.send({"type": "conversation_loaded", "messages": state["messages"][1:]}, websocket)
                        continue

                    if ftype == "new_conversation":
                        state["conv_id"] = str(uuid.uuid4())
                        state["title"] = "New conversation"
                        state["messages"] = [state["messages"][0]]
                        await manager.send({"type": "conversation_cleared"}, websocket)
                        continue

                    if ftype == "set_repo":
                        new_path = frame.get("path", ".")
                        if os.path.isdir(new_path):
                            repo_path = os.path.abspath(new_path)
                            await manager.send({"type": "system", "content": f"Workspace: {repo_path}"}, websocket)
                        continue

                    # Regular text message inside a JSON frame
                    user_input = frame.get("content", "").strip()
                    if not user_input:
                        continue
                else:
                    user_input = data.strip()
            except json.JSONDecodeError:
                user_input = data.strip()

            if not user_input:
                continue

            # Legacy slash commands
            if user_input == "/clear":
                state["messages"] = [state["messages"][0]]
                state["conv_id"] = str(uuid.uuid4())
                await manager.send({"type": "conversation_cleared"}, websocket)
                continue

            # ── Route intent ────────────────────────────────────────────────
            await manager.send({"type": "status", "content": "Routing intent..."}, websocket)
            routing = await asyncio.to_thread(IntentRouter.route_intent, user_input)
            intent = routing.get("intent", "CHAT")
            target = routing.get("target", user_input)
            await manager.send({"type": "intent", "intent": intent, "target": target}, websocket)

            state["messages"].append({"role": "user", "content": user_input})
            if state["title"] == "New conversation":
                state["title"] = user_input[:60]

            # ── IMPLEMENT ───────────────────────────────────────────────────
            if intent == "IMPLEMENT":
                session = SessionManager.create_session(goal=target)
                session.status = SessionStatus.RUNNING
                SessionManager.save_session(session)

                workspace_path = await asyncio.to_thread(
                    WorkspaceManager.create_workspace, repo_path, session.session_id
                )
                session.workspace_path = workspace_path
                SessionManager.save_session(session)

                if not workspace_path:
                    await manager.send({"type": "error", "content": "Failed to create workspace."}, websocket)
                    continue

                try:
                    architect = ArchitectAgent(repo_path=workspace_path, session_id=session.session_id)
                    plan = await asyncio.to_thread(architect.plan_implementation, target)
                    session.tasks.append(plan)
                    SessionManager.save_session(session)

                    engineer = EngineeringAgent(repo_path=workspace_path, session_id=session.session_id)
                    await asyncio.to_thread(engineer.execute_plan, plan)

                    await asyncio.to_thread(WorkspaceManager.apply_workspace_to_repo, workspace_path, repo_path)
                    session.status = SessionStatus.COMPLETED
                    SessionManager.save_session(session)

                    result = f"✅ Done — session `{session.session_id}`\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send({"type": "message", "role": "assistant", "content": result}, websocket)
                    state["messages"].append({"role": "assistant", "content": result})
                except Exception as exc:
                    session.status = SessionStatus.FAILED
                    SessionManager.save_session(session)
                    await manager.send({"type": "error", "content": f"❌ {exc}"}, websocket)
                finally:
                    _persist_state(ws_id)
                    await manager.send({"type": "status", "content": "Idle"}, websocket)
                continue

            # ── CREATE ──────────────────────────────────────────────────────
            elif intent == "CREATE":
                try:
                    await manager.send({"type": "status", "content": "Scaffolding project..."}, websocket)
                    architect = ArchitectAgent(repo_path=repo_path)
                    plan = await asyncio.to_thread(architect.plan_scaffolding, target)
                    engineer = EngineeringAgent(repo_path=repo_path)
                    await asyncio.to_thread(engineer.execute_plan, plan)
                    result = f"✅ Project created.\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send({"type": "message", "role": "assistant", "content": result}, websocket)
                    state["messages"].append({"role": "assistant", "content": result})
                except Exception as exc:
                    await manager.send({"type": "error", "content": f"❌ {exc}"}, websocket)
                finally:
                    _persist_state(ws_id)
                    await manager.send({"type": "status", "content": "Idle"}, websocket)
                continue

            # ── FIX ─────────────────────────────────────────────────────────
            elif intent == "FIX":
                try:
                    await manager.send({"type": "status", "content": "Generating repair plan..."}, websocket)
                    repair_agent = RepairAgent(repo_path=repo_path)
                    plan = await asyncio.to_thread(repair_agent.generate_repair_plan, target, "")
                    await asyncio.to_thread(repair_agent.execute_repair, plan)
                    result = f"✅ Fix applied.\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send({"type": "message", "role": "assistant", "content": result}, websocket)
                    state["messages"].append({"role": "assistant", "content": result})
                except Exception as exc:
                    await manager.send({"type": "error", "content": f"❌ {exc}"}, websocket)
                finally:
                    _persist_state(ws_id)
                    await manager.send({"type": "status", "content": "Idle"}, websocket)
                continue

            # ── CHAT (streaming) ─────────────────────────────────────────────
            state["messages"] = _compress(state["messages"])
            model = state["model"]
            tools = AgentTools.get_tool_definitions()

            # Tool-call loop with streaming final answer
            for _turn in range(11):  # max 10 tool turns
                if _turn < 10:
                    # Non-streaming for tool-call turns (need full message to check tool_calls)
                    response_msg = await asyncio.to_thread(LLMService.agent_chat, state["messages"], tools)
                    if not response_msg:
                        await manager.send({"type": "error", "content": "Empty LLM response."}, websocket)
                        break

                    state["messages"].append(response_msg)
                    tool_calls = response_msg.get("tool_calls") or []

                    if tool_calls:
                        for tc in tool_calls:
                            fn = tc.get("function", {}).get("name", "")
                            args = tc.get("function", {}).get("arguments", {})
                            await manager.send({"type": "tool_call", "name": fn, "args": args}, websocket)
                            try:
                                if fn == "read_file":
                                    out = await asyncio.to_thread(AgentTools.read_file, args.get("path", ""))
                                elif fn == "list_directory":
                                    out = await asyncio.to_thread(AgentTools.list_directory, args.get("path", "."))
                                elif fn == "run_command":
                                    out = await asyncio.to_thread(AgentTools.run_command, args.get("command", ""))
                                else:
                                    out = f"Unknown tool: {fn}"
                            except Exception as exc:
                                out = f"Error: {exc}"
                            tm: dict = {"role": "tool", "content": str(out), "name": fn}
                            if "id" in tc:
                                tm["tool_call_id"] = tc["id"]
                            state["messages"].append(tm)
                        continue  # next tool turn

                # Final answer — stream it
                full_text = await _stream_chat(state["messages"], websocket, model)
                if full_text:
                    state["messages"].append({"role": "assistant", "content": full_text})
                break

            _persist_state(ws_id)
            await manager.send({"type": "status", "content": "Idle"}, websocket)

    except WebSocketDisconnect:
        _persist_state(ws_id)
        manager.disconnect(websocket)
        _ws_state.pop(ws_id, None)
    except Exception as exc:
        _persist_state(ws_id)
        manager.disconnect(websocket)
        _ws_state.pop(ws_id, None)
        print(f"WebSocket error: {exc}")


if __name__ == "__main__":
    uvicorn.run("api:app", host="127.0.0.1", port=8007, reload=True)
