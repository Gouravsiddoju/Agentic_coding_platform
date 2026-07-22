# Opt Code Feature Backlog

## Terminal Manager Bridge (Pending)
**Description**: Currently, when the Opt Code Python backend runs long-running applications (e.g., `npm start`, `python main.py`) via the agent, they are hidden in the background executor (`subprocess.run`). The user requested that these background agent processes be visible in the React frontend's "Shell" tabs.

**Proposed Solution**: 
Build a bridge between the Python backend and the Node.js frontend. 
1. Expose PTY/WebSockets in the Python backend's `ProcessManager`.
2. Map the React frontend's "Shell" tabs to automatically connect to these agent-spawned background processes so the user can see live logs and interact with them directly.
