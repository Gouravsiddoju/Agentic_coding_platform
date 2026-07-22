/**
 * OPTCode SDK Integration
 * Connects to OptGPT-4:latest and implements the Architect -> Engineer pipeline.
 */

import crypto from 'crypto';
import fsSync from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getOpenCodeDatabasePath } from './shared/utils.js';
import { sessionsDb } from './modules/database/index.js';
import { LLMService } from './services/optcode/llm-service.js';
import { 
  ArchitectAgent, 
  EngineeringAgent, 
  VerificationAgent, 
  RepairAgent, 
  DebugAgent, 
  ReviewAgent, 
  ChatAgent, 
  TestAgent,
  ClarificationAgent
} from './services/optcode/agents.js';
import { IntentRouter } from './services/optcode/intent-router.js';


const notifyRunFailed = (a, b) => {};
const notifyRunStopped = (a, b) => {};

const activeSessions = new Map();

// Stub for tool approvals since autonomous agents don't require manual approvals
const pendingToolApprovals = new Map();

export function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

export function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input || {}
      });
    }
  }
  return pending;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function loadSessionHistory(sessionId) {
  const dbPath = getOpenCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT
        m.id AS message_id,
        m.data AS message_data,
        p.id AS part_id,
        p.data AS part_data
      FROM message m
      LEFT JOIN part p
        ON p.session_id = m.session_id
       AND p.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY
        COALESCE(m.time_created, 0),
        m.id,
        COALESCE(p.time_created, 0),
        p.id
    `).all(sessionId);

    const messages = [];
    for (const row of rows) {
      const msgData = JSON.parse(row.message_data || '{}');
      const partData = JSON.parse(row.part_data || '{}');
      
      const role = msgData.role;
      if (!role) continue;
      
      if (partData.type === 'text' || partData.type === 'reasoning') {
        messages.push({
          role: role,
          content: partData.text || partData.content || ''
        });
      } else if (partData.type === 'tool') {
        const state = partData.state || {};
        const toolName = partData.tool;
        const toolInput = state.input || partData.input || {};
        const toolOutput = state.output || state.error || '';
        
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: partData.callID || row.part_id,
            type: 'function',
            function: {
              name: toolName,
              arguments: toolInput
            }
          }]
        });
        
        messages.push({
          role: 'tool',
          content: toolOutput,
          name: toolName,
          tool_call_id: partData.callID || row.part_id
        });
      }
    }
    return messages;
  } catch (e) {
    console.error('Failed to load session history:', e);
    return [];
  } finally {
    db.close();
  }
}

function saveSessionMessage(sessionId, messageId, role, parts, cwd) {
  const dbPath = getOpenCodeDatabasePath();
  const dbDir = path.dirname(dbPath);
  if (!fsSync.existsSync(dbDir)) {
    fsSync.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        worktree TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        directory TEXT,
        title TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        time_archived INTEGER,
        model TEXT,
        agent TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        data TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS part (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        message_id TEXT,
        time_created INTEGER,
        data TEXT
      )
    `).run();

    const now = Date.now();
    const projectId = 'default_project';
    
    let fallbackTitle = 'OptCode Chat Session';
    if (role === 'user' && parts && parts.length > 0 && typeof parts[0].text === 'string') {
      const firstLine = parts[0].text.split('\n')[0].trim();
      if (firstLine) {
        fallbackTitle = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;
      }
    }
    
    db.prepare(`
      INSERT OR IGNORE INTO project (id, worktree)
      VALUES (?, ?)
    `).run(projectId, cwd);

    db.prepare(`
      INSERT OR REPLACE INTO session (id, project_id, directory, title, time_created, time_updated)
      VALUES (?, ?, ?, COALESCE((SELECT title FROM session WHERE id = ? AND title != 'OptCode Chat Session'), ?), COALESCE((SELECT time_created FROM session WHERE id = ?), ?), ?)
    `).run(sessionId, projectId, cwd, sessionId, fallbackTitle, sessionId, now, now);

    const msgData = JSON.stringify({ role });
    db.prepare(`
      INSERT OR REPLACE INTO message (id, session_id, time_created, data)
      VALUES (?, ?, ?, ?)
    `).run(messageId, sessionId, now, msgData);

    for (const part of parts) {
      const partId = createRequestId();
      const partData = JSON.stringify(part);
      db.prepare(`
        INSERT OR REPLACE INTO part (id, session_id, message_id, time_created, data)
        VALUES (?, ?, ?, ?, ?)
      `).run(partId, sessionId, messageId, now, partData);
    }
  } catch (e) {
    console.error('Failed to write to opencode.db:', e);
  } finally {
    db.close();
  }
}

export function abortOptCodeSession(sessionId) {
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    session.aborted = true;
    activeSessions.delete(sessionId);
    notifyRunStopped('OPTCode', sessionId);
  }
}

export async function queryOptCode(command, options, ws) {
  let { sessionId, appSessionId, cwd } = options;
  if (!sessionId) {
    sessionId = appSessionId || createRequestId();
  }
  
  if (activeSessions.has(sessionId)) {
    ws.send(JSON.stringify({ type: 'error', message: 'A task is already running in this session.' }));
    return;
  }

  const sessionState = { aborted: false };
  activeSessions.set(sessionId, sessionState);

  // 1. Assign provider session ID so server DB tracks it
  try {
    sessionsDb.assignProviderSessionId(sessionId, sessionId);
  } catch (e) {
    console.error('Failed to assign provider session ID:', e);
  }

  // 2. Load previous history
  const history = loadSessionHistory(sessionId);

  // 3. Save current user message
  const userMessageId = createRequestId();
  saveSessionMessage(sessionId, userMessageId, 'user', [{ type: 'text', text: command }], cwd);

  // Helper to send items to the UI exactly like Claude Code SDK expects (NormalizedMessage)
  const sendItem = (itemType, content, opts = {}) => {
    if (sessionState.aborted) return;
    
    let msgObj;
    const timestamp = new Date().toISOString();
    const messageId = opts.id || createRequestId();

    if (itemType === 'agent_message') {
      msgObj = {
        id: messageId,
        sessionId,
        timestamp,
        provider: 'optcode',
        kind: 'text',
        role: 'assistant',
        text: content,
        content: content,
        ...opts
      };
    } else if (itemType === 'tool_use') {
      msgObj = {
        id: messageId,
        sessionId,
        timestamp,
        provider: 'optcode',
        kind: 'tool_use',
        role: 'assistant',
        toolName: opts.toolName,
        toolInput: opts.toolInput,
        toolId: opts.toolId || createRequestId()
      };
      if (opts.status === 'success' || opts.status === 'error' || opts.status === 'completed') {
        msgObj.toolResult = {
          content: opts.output || 'Tool execution completed.',
          isError: opts.status === 'error',
          exitCode: opts.exitCode
        };
      }
    } else if (itemType === 'tool_result') {
      msgObj = {
        id: messageId,
        sessionId,
        timestamp,
        provider: 'optcode',
        kind: 'tool_result',
        toolName: opts.toolName,
        toolId: opts.toolId,
        content: opts.output || '',
        isError: opts.status === 'error',
        exitCode: opts.exitCode
      };
    } else if (itemType === 'thinking') {
      msgObj = {
        id: messageId,
        sessionId,
        timestamp,
        provider: 'optcode',
        kind: 'thinking',
        content: content,
        ...opts
      };
    } else {
      msgObj = {
        id: messageId,
        sessionId,
        timestamp,
        provider: 'optcode',
        kind: 'status',
        text: content,
        ...opts
      };
    }

    // Save to opencode.db for persistence
    try {
      if (itemType === 'agent_message') {
        saveSessionMessage(sessionId, messageId, 'assistant', [{ type: 'text', text: content }], cwd);
      } else if (itemType === 'thinking') {
        saveSessionMessage(sessionId, messageId, 'assistant', [{ type: 'reasoning', text: content }], cwd);
      } else if (itemType === 'command_execution') {
        if (opts.status === 'success' || opts.status === 'error') {
          const toolId = msgObj.toolId;
          saveSessionMessage(sessionId, messageId, 'assistant', [{
            type: 'tool',
            tool: 'Bash',
            callID: toolId,
            state: {
              input: { command: opts.command },
              status: opts.status,
              output: opts.output || 'Tool execution completed.'
            }
          }], cwd);
        }
      } else if (itemType === 'command_execution_result') {
        saveSessionMessage(sessionId, messageId, 'assistant', [{
          type: 'tool',
          tool: 'Bash',
          callID: opts.toolId,
          state: {
            input: { command: opts.command },
            status: opts.status,
            output: opts.output || ''
          }
        }], cwd);
      } else if (itemType === 'file_creation') {
        const toolId = msgObj.toolId;
        saveSessionMessage(sessionId, messageId, 'assistant', [{
          type: 'tool',
          tool: 'GlobTool',
          callID: toolId,
          state: {
            input: { path: opts.path },
            status: 'completed',
            output: `File created: ${opts.path}`
          }
        }], cwd);
      } else if (itemType === 'tool_use') {
        const toolId = msgObj.toolId || crypto.randomUUID();
        saveSessionMessage(sessionId, messageId, 'assistant', [{
          type: 'tool',
          tool: msgObj.toolName || 'UnknownTool',
          callID: toolId,
          state: {
            input: opts.toolInput || {},
            status: opts.status || 'success',
            output: opts.output || ''
          }
        }], cwd);
      }
    } catch (e) {
      console.error('Failed to auto-save realtime event to database:', e);
    }

    // ChatSessionWriter expects an object!
    ws.send(msgObj);
  };

  try {
    const handleProgress = (agent, msg) => {
      if (!msg) return;
      if (msg.startsWith('Tool call:')) {
        const cmdMatch = msg.match(/Tool call:\s*([a-zA-Z_]+)\((.+)\)/s);
        if (cmdMatch) {
           const funcName = cmdMatch[1];
           let toolInput = {};
           try { toolInput = JSON.parse(cmdMatch[2]); } catch (e) {}

           // Map backend tool names to UI-expected names
           let uiToolName = 'Bash';
           if (funcName === 'read_file') uiToolName = 'Read';
           else if (funcName === 'write_file') { uiToolName = 'Write'; toolInput.file_path = toolInput.path; }
           else if (funcName === 'list_directory') { uiToolName = 'Glob'; toolInput.pattern = toolInput.path; }
           else if (funcName === 'search_files') { uiToolName = 'Glob'; toolInput.pattern = toolInput.pattern; }
           
           sendItem('tool_use', undefined, { 
             toolName: uiToolName, 
             toolInput: toolInput, 
             status: 'success', 
             output: 'Tool execution completed.' 
           });
           return;
        }
      }
      
      // Convert internal representations to UI-friendly ones
      if (msg.startsWith('Executing tool: ')) {
        let [funcName, ...args] = msg.replace('Executing tool: ', '').split(' ');
        try {
           let argsJson = args.join(' ');
           const toolInput = JSON.parse(argsJson);
           let uiToolName = funcName;
           
           // Mapping
           if (funcName === 'write_file') uiToolName = 'Write';
           else if (funcName === 'read_file') uiToolName = 'Read';
           else if (funcName === 'run_command') uiToolName = 'Bash';
           else if (funcName === 'list_directory') { uiToolName = 'Glob'; toolInput.pattern = toolInput.path; }
           else if (funcName === 'search_files') { uiToolName = 'Glob'; toolInput.pattern = toolInput.pattern; }
           
           sendItem('tool_use', undefined, { 
             toolName: uiToolName, 
             toolInput: toolInput, 
             status: 'success', 
             toolId: createRequestId() 
           });
           return;
        } catch(e) {
          // fallback
        }
      }

      if (msg.startsWith('REASONING:')) {
        sendItem('thinking', msg.substring(10));
        return;
      }
      if (msg.startsWith('Thinking...')) {
        sendItem('agent_message', `ℹ️ [${agent}] ${msg}`);
        return;
      }
      sendItem('agent_message', `[${agent}] ${msg}`);
    };

    // Helper for interactive tool calls
    const handleInteractive = (toolName, args) => {
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        
        let payload = args;
        if (toolName === 'ask_question' && args.question && Array.isArray(args.options)) {
          // Transform standard ask_question args to AskUserQuestionPanel format
          payload = {
            questions: [
              {
                question: args.question,
                options: args.options.map(opt => ({ label: String(opt) })),
                multiSelect: !!args.is_multi_select
              }
            ]
          };
        }

        const resolver = (decision) => {
          pendingToolApprovals.delete(requestId);
          if (toolName === 'ask_question') {
            const answers = decision.updatedInput?.answers || {};
            const firstAnswer = Object.values(answers)[0];
            resolve(firstAnswer ? firstAnswer.split(', ') : []);
          } else {
            resolve(decision.updatedInput);
          }
        };
        resolver._sessionId = sessionId;
        resolver._toolName = toolName;
        resolver._input = payload;
        
        pendingToolApprovals.set(requestId, resolver);

        // Send the request natively!
        ws.send({
          type: 'permission_request',
          toolName,
          input: payload,
          requestId
        });
      });
    };

    // 1. Intent Routing
    sendItem('agent_message', 'Analyzing intent...');
    const route = await IntentRouter.routeIntent(command, history);
    sendItem('agent_message', `Intent routed to: **${route.intent}**`);

    // ─── CHAT Intent ───────────────────────────────────────────────
    if (route.intent === 'CHAT') {
       const chatAgent = new ChatAgent(cwd);
       const reply = await chatAgent.chat(command, handleProgress, history, sessionState, options);
       sendItem('agent_message', reply);
       return;
    }

    // ─── REVIEW Intent ─────────────────────────────────────────────
    if (route.intent === 'REVIEW') {
       const reviewAgent = new ReviewAgent(cwd);
       const review = await reviewAgent.reviewCode(route.target, handleProgress, history, sessionState, options);
       sendItem('agent_message', review);
       return;
    }

    // ─── FIX Intent (DebugAgent) ───────────────────────────────────
    let plan;
    if (route.intent === 'FIX') {
      const debugAgent = new DebugAgent(cwd);
      plan = await debugAgent.diagnoseAndFix(route.target, handleProgress, history, sessionState, options);
    }
    // ─── CREATE Intent ─────────────────────────────────────────────
    else if (route.intent === 'CREATE') {
      // 1. Clarification Phase
      const clarifier = new ClarificationAgent(cwd);
      const clarifiedContext = await clarifier.clarifyRequirements(route.target, handleProgress, history, sessionState, handleInteractive, options);
      
      if (sessionState.aborted) return;
      
      // Pass the clarified context into the Architect
      const enhancedTarget = `Original Request: ${route.target}\n\nClarified Requirements:\n${clarifiedContext}`;
      
      const architect = new ArchitectAgent(cwd);
      plan = await architect.planScaffolding(enhancedTarget, handleProgress, history, sessionState, options);
    }
    // ─── TEST Intent (TestAgent) ───────────────────────────────────
    else if (route.intent === 'TEST') {
      const testAgent = new TestAgent(cwd);
      plan = await testAgent.generateTests(route.target, handleProgress, history, sessionState, options);
    }
    // ─── IMPLEMENT / REFACTOR Intent ───────────────────────────────
    else {
      const isProceed = command.trim().toLowerCase() === 'proceed' || command.trim().toLowerCase() === 'proceed!';
      const planPath = path.join(cwd, 'implementation_plan.md');
      const planExists = fsSync.existsSync(planPath);

      if (isProceed && planExists) {
        plan = { plan_summary: 'Executing existing implementation_plan.md' };
        sendItem('agent_message', '🚀 Proceeding with the execution of `implementation_plan.md`...');
      } else {
        const architect = new ArchitectAgent(cwd);
        plan = await architect.planImplementation(route.target, handleProgress, history, sessionState, options);
      }
    }

    if (sessionState.aborted) return;

    if (plan.files_to_create || plan.files_to_modify) {
      // It came from the architect
      let planDetails = `**Plan Created:** ${plan.plan_summary}\n\n`;
      if (plan.files_to_create && plan.files_to_create.length > 0) {
        planDetails += `**Files to Create:**\n${plan.files_to_create.map(f => {
          if (typeof f === 'string') return `- \`${f}\``;
          return `- \`${f.path || 'unknown'}\`: ${f.description || ''}`;
        }).join('\n')}\n\n`;
      }
      if (plan.files_to_modify && plan.files_to_modify.length > 0) {
        planDetails += `**Files to Modify:**\n${plan.files_to_modify.map(f => {
          if (typeof f === 'string') return `- \`${f}\``;
          return `- \`${f.path || 'unknown'}\`: ${f.description || ''}`;
        }).join('\n')}\n\n`;
      }
      
      sendItem('agent_message', planDetails.trim());
      sendItem('agent_message', '📝 **Implementation plan is ready.** Please review it on the side. Add any comments directly on the plan, then type `proceed` to begin execution.');
      
      // Stop here to wait for the user's explicit 'proceed' command in the next chat message
      return;
    }


    // (Interactive approval modal has been removed in favor of asynchronous proceed command)
    
    // 3. Execution
    const engineer = new EngineeringAgent(cwd);
    const { approved, filesChanged, summary } = await engineer.executePlan(plan, false, (agent, msg) => {
      handleProgress(agent, msg);
    }, sessionState, handleInteractive, options);

    if (sessionState.aborted) return;

    if (filesChanged.length > 0) {
      sendItem('agent_message', `✅ Modified ${filesChanged.length} file(s):\n${filesChanged.map(f => `  - ${f}`).join('\n')}`);
    }

    // 4. Verification & Repair Loop (max 3 attempts)
    const verifier = new VerificationAgent(cwd);
    const testCmd = verifier.detectTestCommand();
    
    if (testCmd) {
      const MAX_REPAIR_ATTEMPTS = 3;
      const repair = new RepairAgent(cwd);

      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
        if (sessionState.aborted) break;

        const attemptLabel = attempt > 0 ? ` (attempt ${attempt + 1}/${MAX_REPAIR_ATTEMPTS})` : '';
        const toolId = createRequestId();
        sendItem('tool_use', undefined, { toolId, toolName: 'Bash', toolInput: { command: testCmd }, status: 'running' });
        
        const testResult = await verifier.runTests(testCmd);
        sendItem('tool_result', undefined, { 
          toolId,
          toolName: 'Bash',
          output: testResult.stdout + '\n' + testResult.stderr,
          exitCode: testResult.returncode,
          status: testResult.success ? 'success' : 'error'
        });

        if (testResult.success) {
          sendItem('agent_message', `✅ Tests passed!${attemptLabel}`);
          break;
        }



        if (attempt < MAX_REPAIR_ATTEMPTS - 1) {
          sendItem('agent_message', `❌ Tests failed${attemptLabel}. Initiating Repair Agent...`);
          const repairPlan = await repair.generateRepairPlan(
            testResult.stdout + testResult.stderr, 
            testCmd, 
            handleProgress,
            sessionState
          );

          if (repairPlan.plan_summary.toLowerCase().includes('cannot fix') || repairPlan.plan_summary.toLowerCase().includes('unable to fix')) {
            sendItem('agent_message', '⚠️ Repair agent could not identify changes to make. Stopping repair loop.');
            break;
          } else {
            await repair.executeRepair(repairPlan, handleProgress, sessionState);
            sendItem('agent_message', `Repair attempt ${attempt + 1} complete. Re-running tests...`);
          }
        } else {
          sendItem('agent_message', `❌ Tests still failing after ${MAX_REPAIR_ATTEMPTS} repair attempts. Manual intervention may be needed.`);
        }
      }
    } else {
      sendItem('agent_message', 'No test command detected. Skipping verification.');
    }

    if (summary) {
      sendItem('agent_message', `🎉 **Task completed successfully!**\n\n${summary}`);
    } else {
      sendItem('agent_message', '🎉 Task completed successfully!');
    }

  } catch (err) {
    console.error('OPTCode Error:', err);
    sendItem('agent_message', `**Error:** ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    activeSessions.delete(sessionId);
    ws.send({ kind: 'complete', aborted: sessionState.aborted, tokenBudget: null });
  }
}

