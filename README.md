# Agentic Coding Platform (Opt Code) 🤖🚀

The **Agentic Coding Platform** is an advanced, AI-powered desktop development environment and orchestration system. It acts as an autonomous software engineering assistant that leverages Large Language Models (LLMs) and the Model Context Protocol (MCP) to plan, write, edit, and test code dynamically across your workspaces.

## 📖 Table of Contents
- [Project Overview](#project-overview)
- [Monorepo Structure](#monorepo-structure)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running the Application](#running-the-application)
- [Tech Stack](#tech-stack)

---

## 🏗️ Monorepo Structure

This repository is structured as a monorepo containing both a dedicated Python intelligence ecosystem and a full-featured Desktop Application.

```bash
Opt Code/
│
├── claudecodeui_src/      # 🖥️ The Desktop Application Ecosystem
│   ├── electron/          # Native desktop window & OS integrations
│   ├── server/            # Node.js Agent Backend (Express, WebSockets, intent-routing)
│   ├── src/               # React UI Frontend (Vite, TypeScript, TailwindCSS)
│   └── plugins/           # Dynamically loaded tools and extensions
│
├── .venv/                 # 🐍 Python Virtual Environment (Dependencies)
├── api.py                 # FastAPI/Flask backend for OptGPT models
├── optcode.py             # Main Python-based agent intelligence runner
├── ssh_check.py           # Remote machine & GPU orchestration scripts
├── services/              # Supplemental Python modules and routines
└── evaluate_optgpt.py     # Evaluation scripts for assessing AI capabilities
```

---

## ✨ Key Features
- **Intelligent Orchestration**: Backend intent-routing to autonomously divide complex goals into smaller tasks using `Architect` and `Engineer` agents.
- **Embedded Desktop IDE**: Integrated code editor and live terminal shell (`xterm.js`) built directly into the Electron client.
- **Visual Kanban Board**: Task Master UI to visualize AI-generated Implementation Plans as tasks move from `Todo` -> `In Progress` -> `Done`.
- **Persistent Sessions**: Safe, isolated SQLite database integration handling multiple concurrent AI chats and user configurations.
- **Model Context Protocol (MCP)**: Dynamic tool loading to extend your agent's capabilities directly into local or external databases.

---

## ⚙️ Prerequisites
Before setting up the project, ensure you have the following installed on your machine:
- **Node.js** (v18.x or v22.x recommended)
- **Python** (3.10+)
- **Git**

---

## 🚀 Installation & Setup

### 1. Python Environment Setup
Navigate to the root directory and activate the virtual environment to install the required Python scripts:
```bash
# Windows
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Desktop Application Setup
Navigate to the Desktop UI folder and install the Node modules:
```bash
cd claudecodeui_src
npm install
```

---

## 💻 Running the Application

### Starting the Desktop App (Development Mode)
To run the full React + Node.js + Electron stack locally:
```bash
cd claudecodeui_src

# Clean builds and starts the full application suite
npm run start
```
*Note: The backend gracefully stores its SQLite databases in a safe, persistent location (`~/.optcode/auth.db`) so your authentication and settings survive clean builds!*

### Building for Production
To package the Desktop App into a native `.exe` or `.dmg` installer:
```bash
cd claudecodeui_src
npm run desktop:pack
```

---

## 🛠️ Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Lucide Icons
- **Backend (JS)**: Node.js, Express, WebSockets, Better-SQLite3
- **Backend (Python)**: Python 3, PyTorch (for evaluation), Requests
- **Desktop Wrapper**: Electron
- **Agent Intelligence**: Claude API, OptGPT, LLM Intent Routing

---
*Developed and maintained by Gourav Siddoju.*
