import json
import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from services.intent_router import IntentRouter
from services.llm_service import LLMService
from services.config import ConfigManager
from services.tools import AgentTools
from services.agents import ArchitectAgent, EngineeringAgent, RepairAgent
from services.events import EventBus, AgentEvent, AgentEventType
from services.session_manager import SessionManager, SessionStatus
from services.workspace import WorkspaceManager

# Chat history is now managed per session in SessionManager, 
# but for the raw websocket connection we keep a lightweight history cache.
def load_history() -> list:
    return None

def save_history(messages):
    pass

app = FastAPI(title="OPTCode Desktop API", version="2.0.0")

# Enable CORS for the React/Electron Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_message(self, message: dict, websocket: WebSocket):
        try:
            await websocket.send_json(message)
        except:
            pass
            
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await self.send_message(message, connection)

manager = ConnectionManager()

# Bridge EventBus to WebSockets
event_queue = asyncio.Queue()

def event_bus_callback(event: AgentEvent):
    # This runs in sync threads, we need to put it in the async queue
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon_threadsafe(event_queue.put_nowait, event)
    except RuntimeError:
        pass

EventBus.subscribe_all(event_bus_callback)

async def event_consumer():
    while True:
        event = await event_queue.get()
        await manager.broadcast({
            "type": "agent_event",
            "event_type": event.event_type.value,
            "message": event.message,
            "payload": event.payload,
            "session_id": event.session_id,
            "timestamp": event.timestamp
        })

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(event_consumer())

def compress_history(history: list, max_len: int = 15) -> list:
    if len(history) <= max_len:
        return history
    system_prompt = history[0]
    safe_index = len(history) - max_len + 1
    while safe_index < len(history):
        if history[safe_index].get("role") == "user":
            break
        safe_index += 1
    if safe_index >= len(history):
        safe_index = len(history) - 5
    return [system_prompt] + history[safe_index:]

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await manager.connect(websocket)
    repo_path = "."
    
    loaded_messages = load_history()
    if loaded_messages:
        messages = loaded_messages
    else:
        messages = [
            {"role": "system", "content": "You are OPTCode, an autonomous AI Software Engineer running directly on the user's local machine via a Desktop Application. You HAVE full read and write access to their local filesystem and repository. When the user asks for code, your background agents physically create and modify the files on their disk. NEVER say that you cannot create files or that you don't have access to the system, because you do. Be helpful, use rich markdown, and be concise."}
        ]
    
    try:
        while True:
            data = await websocket.receive_text()
            user_input = data.strip()
            
            if not user_input:
                continue
                
            if user_input.startswith("/open ") or user_input.startswith("/cd "):
                new_path = user_input.split(" ", 1)[1].strip()
                if os.path.exists(new_path) and os.path.isdir(new_path):
                    repo_path = os.path.abspath(new_path)
                    await manager.send_message({"type": "system", "content": f"Workspace changed to: {repo_path}"}, websocket)
                    messages.append({"role": "system", "content": f"The user has changed the active workspace directory to: {repo_path}."})
                else:
                    await manager.send_message({"type": "error", "content": f"Error: Directory '{new_path}' does not exist."}, websocket)
                continue
                
            if user_input == "/clear":
                messages = [messages[0]]
                await manager.send_message({"type": "system", "content": "Chat history cleared."}, websocket)
                save_history(messages)
                continue

            # Route intent to appropriate agent pipeline
            await manager.send_message({"type": "status", "content": "Routing intent..."}, websocket)
            
            routing = await asyncio.to_thread(IntentRouter.route_intent, user_input)
            intent = routing.get("intent", "CHAT")
            target = routing.get("target", user_input)

            await manager.send_message({"type": "status", "content": f"Intent: {intent}"}, websocket)

            if intent == "IMPLEMENT":
                messages.append({"role": "user", "content": user_input})
                
                # 1. Create Session
                session = SessionManager.create_session(goal=target)
                session.status = SessionStatus.RUNNING
                SessionManager.save_session(session)
                
                # 2. Create Workspace
                EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, f"Creating workspace for session {session.session_id}...", session_id=session.session_id))
                workspace_path = await asyncio.to_thread(WorkspaceManager.create_workspace, repo_path, session.session_id)
                session.workspace_path = workspace_path
                SessionManager.save_session(session)
                
                if not workspace_path:
                    await manager.send_message({"type": "error", "content": "Failed to create isolated workspace."}, websocket)
                    continue

                try:
                    EventBus.publish(AgentEvent(AgentEventType.PLANNING, "Planning implementation...", session_id=session.session_id))
                    architect = ArchitectAgent(repo_path=workspace_path)
                    plan = await asyncio.to_thread(architect.plan_implementation, target)
                    
                    session.tasks.append(plan)
                    SessionManager.save_session(session)
                    
                    EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, "Executing implementation plan...", session_id=session.session_id))
                    engineer = EngineeringAgent(repo_path=workspace_path)
                    await asyncio.to_thread(engineer.execute_plan, plan)
                    
                    # 3. Apply Workspace back to repo for MVP (IDE Mode will handle this better)
                    EventBus.publish(AgentEvent(AgentEventType.STATUS_UPDATE, "Applying changes back to main repository...", session_id=session.session_id))
                    await asyncio.to_thread(WorkspaceManager.apply_workspace_to_repo, workspace_path, repo_path)
                    
                    session.status = SessionStatus.COMPLETED
                    SessionManager.save_session(session)
                    
                    EventBus.publish(AgentEvent(AgentEventType.COMPLETE, "Implementation complete.", session_id=session.session_id))
                    
                    result_msg = f"✅ Implementation complete in session {session.session_id}.\n\n**Plan executed:**\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send_message({"type": "message", "role": "assistant", "content": result_msg}, websocket)
                    messages.append({"role": "assistant", "content": result_msg})
                except Exception as e:
                    session.status = SessionStatus.FAILED
                    SessionManager.save_session(session)
                    err_msg = f"❌ Implementation error: {e}"
                    EventBus.publish(AgentEvent(AgentEventType.ERROR, err_msg, session_id=session.session_id))
                    await manager.send_message({"type": "error", "content": err_msg}, websocket)
                finally:
                    # Optional cleanup
                    # WorkspaceManager.cleanup_workspace(session.session_id)
                    pass
                continue

            elif intent == "STATUS":
                sessions = SessionManager.list_sessions()
                status_msg = "Active Sessions:\n"
                for s in sessions:
                    sess = SessionManager.get_session(s)
                    status_msg += f"- {s}: {sess.status.value}\n"
                await manager.send_message({"type": "message", "role": "assistant", "content": status_msg}, websocket)
                messages.append({"role": "assistant", "content": status_msg})
                continue
                
            elif intent == "REPO_MAP":
                from services.repo_mapper import RepoMapper
                mapper = RepoMapper(repo_path)
                repo_map = mapper.generate_architecture_summary()
                await manager.send_message({"type": "message", "role": "assistant", "content": repo_map}, websocket)
                messages.append({"role": "assistant", "content": "Repository Map generated."})
                continue
                
            elif intent == "CREATE":
                messages.append({"role": "user", "content": user_input})
                messages = compress_history(messages, max_len=20)
                save_history(messages)
                try:
                    await manager.send_message({"type": "status", "content": "Planning project scaffolding..."}, websocket)
                    architect = ArchitectAgent(repo_path=repo_path)
                    plan = await asyncio.to_thread(architect.plan_scaffolding, target)
                    await manager.send_message({"type": "status", "content": "Scaffolding project..."}, websocket)
                    engineer = EngineeringAgent(repo_path=repo_path)
                    await asyncio.to_thread(engineer.execute_plan, plan)
                    result_msg = f"✅ Project created.\n\n**Scaffolding plan executed:**\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send_message({"type": "message", "role": "assistant", "content": result_msg}, websocket)
                    messages.append({"role": "assistant", "content": result_msg})
                    save_history(messages)
                except Exception as e:
                    err_msg = f"❌ Scaffolding error: {e}"
                    await manager.send_message({"type": "error", "content": err_msg}, websocket)
                await manager.send_message({"type": "status", "content": "Idle"}, websocket)
                continue

            elif intent == "FIX":
                messages.append({"role": "user", "content": user_input})
                messages = compress_history(messages, max_len=20)
                save_history(messages)
                try:
                    await manager.send_message({"type": "status", "content": "Generating repair plan..."}, websocket)
                    repair_agent = RepairAgent(repo_path=repo_path)
                    plan = await asyncio.to_thread(repair_agent.generate_repair_plan, target, "")
                    await manager.send_message({"type": "status", "content": "Executing repair..."}, websocket)
                    await asyncio.to_thread(repair_agent.execute_repair, plan)
                    result_msg = f"✅ Fix applied.\n\n**Repair plan executed:**\n```json\n{json.dumps(plan, indent=2)}\n```"
                    await manager.send_message({"type": "message", "role": "assistant", "content": result_msg}, websocket)
                    messages.append({"role": "assistant", "content": result_msg})
                    save_history(messages)
                except Exception as e:
                    err_msg = f"❌ Repair error: {e}"
                    await manager.send_message({"type": "error", "content": err_msg}, websocket)
                await manager.send_message({"type": "status", "content": "Idle"}, websocket)
                continue

            # CHAT intent — fall through to the generic agent loop
            
            messages.append({"role": "user", "content": user_input})
            messages = compress_history(messages, max_len=20)
            save_history(messages)
            
            tools = AgentTools.get_tool_definitions()
            
            while True:
                await manager.send_message({"type": "status", "content": "Agent is thinking..."}, websocket)
                
                # In a real app we'd make this async, but for MVP we run it in a thread
                response_msg = await asyncio.to_thread(LLMService.agent_chat, messages, tools)
                
                if not response_msg:
                    await manager.send_message({"type": "error", "content": "LLM returned empty response."}, websocket)
                    break
                    
                messages.append(response_msg)
                save_history(messages)
                
                if "tool_calls" in response_msg and response_msg["tool_calls"]:
                    for tool_call in response_msg["tool_calls"]:
                        func_name = tool_call.get("function", {}).get("name")
                        args = tool_call.get("function", {}).get("arguments", {})
                        
                        await manager.send_message({
                            "type": "tool_call",
                            "func_name": func_name,
                            "args": args
                        }, websocket)
                        
                        try:
                            # Actually run the tools
                            if func_name == "read_file":
                                output = await asyncio.to_thread(AgentTools.read_file, args.get("path", ""))
                            elif func_name == "list_directory":
                                output = await asyncio.to_thread(AgentTools.list_directory, args.get("path", "."))
                            elif func_name == "run_command":
                                output = await asyncio.to_thread(AgentTools.run_command, args.get("command", ""))
                            else:
                                output = f"Error: Unknown tool {func_name}"
                        except Exception as e:
                            output = f"Error executing tool: {e}"
                            
                        tool_msg = {"role": "tool", "content": str(output), "name": func_name}
                        if "id" in tool_call:
                            tool_msg["tool_call_id"] = tool_call["id"]
                        messages.append(tool_msg)
                        save_history(messages)
                else:
                    final_text = response_msg.get("content", "")
                    await manager.send_message({"type": "message", "role": "assistant", "content": final_text}, websocket)
                    await manager.send_message({"type": "status", "content": "Idle"}, websocket)
                    save_history(messages)
                    break

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)
        print(f"WebSocket Error: {e}")

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8007, reload=True)