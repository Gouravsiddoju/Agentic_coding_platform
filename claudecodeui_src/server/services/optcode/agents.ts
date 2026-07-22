/**
 * OPTCode Agent Pipeline — TypeScript Port
 * 
 * Agent Pipeline: IntentRouter → Agent → Engineer → Verify → Repair
 * 
 * Agents:
 *   - ArchitectAgent: Plans file creation/modification for IMPLEMENT and CREATE intents
 *   - DebugAgent: Investigates and diagnoses issues for FIX intent
 *   - TestAgent: Generates test files for TEST intent
 *   - ReviewAgent: Code review analysis for REVIEW intent
 *   - EngineeringAgent: Executes file creation/modification plans
 *   - VerificationAgent: Detects and runs test commands
 *   - RepairAgent: Analyzes test failures and generates repair plans
 *   - ChatAgent: Conversational agent with read-only tool access
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { LLMService, LLMServiceError, type ChatMessage } from './llm-service.js';
import { AgentTools } from './agent-tools.js';
import { extractJSON, stripCodeFences } from './json-parser.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface FilePlan {
  path: string;
  description: string;
}

export interface ImplementationPlan {
  plan_summary: string;
  files_to_create: FilePlan[];
  files_to_modify: FilePlan[];
}

/** Callback for streaming agent progress to the UI */
export type ProgressCallback = (agent: string, message: string) => void;

// ── Shared Agentic Loop Helper ──────────────────────────────────────────

interface AgenticLoopOptions {
  messages: ChatMessage[];
  tools: ReturnType<typeof AgentTools.getToolDefinitions>;
  maxIterations: number;
  agentName: string;
  cwd: string;
  onProgress?: ProgressCallback;
  onInteractive?: (toolName: string, args: any) => Promise<any>;
  permissionMode?: string;
  blockCommands?: boolean;
  blockWrites?: boolean;
  aborted?: { value: boolean };
  enforceJson?: boolean;
}

/**
 * Shared agentic loop: repeatedly calls the LLM, dispatches tool calls,
 * and stops when the LLM produces a final text response.
 */
async function agenticLoop(opts: AgenticLoopOptions): Promise<string> {
  const { messages, tools, maxIterations, agentName, cwd, onProgress, onInteractive, blockCommands = false, blockWrites = false, aborted } = opts;
  let response = '';

  for (let i = 0; i < maxIterations; i++) {
    if (aborted?.value) break;
    
    onProgress?.(agentName, `Thinking... (step ${i + 1})`);
    
    // Force final response if nearing max iterations
    if (i === maxIterations - 2) {
      messages.push({
        role: 'system',
        content: `CRITICAL INSTRUCTION: You are nearing the maximum time allowed. You MUST immediately stop calling tools and output your final response now.`
      });
    }

    const currentTools = (i === maxIterations - 1) ? undefined : tools;

    let msg: ChatMessage | null = null;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      if (aborted?.value) break;
      try {
        msg = await LLMService.agentChat(messages, currentTools);
        break;
      } catch (e) {
        attempt++;
        if (attempt >= maxAttempts) {
          console.error(`[${agentName}] LLM call failed at step ${i + 1} after ${maxAttempts} attempts:`, e);
          onProgress?.(agentName, `Error communicating with LLM after retries: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        console.warn(`[${agentName}] LLM call failed (attempt ${attempt}/${maxAttempts}). Retrying in ${attempt * 2}s...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      }
    }

    if (!msg || (!msg.content && !msg.tool_calls?.length)) {
      console.warn(`[${agentName}] LLM returned empty message at step ${i + 1}`);
      break;
    }

    if (msg.reasoning) {
      onProgress?.(agentName, 'REASONING:' + msg.reasoning);
    }

    // Capture any text content
    if (msg.content) {
      console.log(`[${agentName}] msg.content:`, msg.content);
      response = msg.content;
      
      // If the LLM outputted text BEFORE making a tool call, this is its thought process!
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        onProgress?.(agentName, 'REASONING:' + msg.content);
      }
    }

    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      console.log(`[${agentName}] msg.tool_calls:`, msg.tool_calls.map(tc => tc.function.name));
      for (const tc of msg.tool_calls) {
        if (aborted?.value) break;
        
        const funcName = tc.function.name;
        let args = tc.function.arguments;
        // Handle stringified args
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {} as Record<string, string>; }
        }

        onProgress?.(agentName, `Tool call: ${funcName}(${JSON.stringify(args)})`);

        // Safety blocks removed: Agents are fully empowered to write and execute commands
        let output: string;
        output = await AgentTools.executeToolAsync(funcName, args as Record<string, string>, cwd, onInteractive, opts.permissionMode);

        const toolMsg: ChatMessage = {
          role: 'tool',
          content: output,
          name: funcName,
        };
        if (tc.id) toolMsg.tool_call_id = tc.id;
        messages.push(toolMsg);
      }
    } else {
      // No tool calls — this is the final response
      if (opts.enforceJson) {
        const parsed = extractJSON(response);
        if (!parsed) {
          console.warn(`[${agentName}] Invalid JSON response, prompting retry...`);
          onProgress?.(agentName, 'Formatting response as JSON...');
          messages.push({
            role: 'user',
            content: `Your last response was not valid JSON, or it contained extra conversational text. Please output ONLY the raw JSON object as instructed.`
          });
          continue;
        }
      }
      break;
    }
  }

  if (!response) {
    console.warn(`[${agentName}] Agentic loop completed with no final response after ${maxIterations} iterations`);
  }

  return response;
}

/**
 * Parse an ImplementationPlan from LLM output using the shared JSON parser.
 */
function parsePlan(raw: string, agentName: string): ImplementationPlan {
  const result = extractJSON<ImplementationPlan>(raw, 'plan_summary');
  if (result) {
    result.files_to_create = result.files_to_create || [];
    result.files_to_modify = result.files_to_modify || [];
    return result;
  }

  console.error(`[${agentName}] Failed to parse plan from LLM response (first 500 chars): ${raw.slice(0, 500)}`);
  return { plan_summary: 'Failed to parse plan', files_to_create: [], files_to_modify: [] };
}

/**
 * Serialize history for inclusion in prompts.
 * Filters out tool messages and only includes text content.
 */
function serializeHistory(history: ChatMessage[], maxMessages: number = 6): string {
  if (!history || history.length === 0) return '';
  
  const relevant = history
    .filter(m => m.role !== 'tool' && m.content && m.content.trim())
    .slice(-maxMessages);
  
  if (relevant.length === 0) return '';
  
  return '\n\nRecent Conversation Context:\n' + relevant.map(m => `${m.role}: ${m.content}`).join('\n');
}


import { generateRepoMap } from './repo-mapper.js';

// ── Clarification Agent ───────────────────────────────────────────────────

export class ClarificationAgent {
  constructor(protected cwd: string = '.') {}

  async clarifyRequirements(story: string, onProgress?: ProgressCallback, history?: ChatMessage[], sessionState?: { aborted: boolean }, onInteractive?: (toolName: string, args: any) => Promise<any>, opts: any = {}): Promise<string> {
    onProgress?.('Clarification', 'Analyzing request for missing requirements...');

    const systemPrompt = `You are a Technical Clarification Agent.
Your job is to analyze the user's project request and determine if any crucial technical decisions are missing (e.g., Tech Stack, UI Framework, Database, etc.).
If the request is broad and lacks these details, you MUST use the "ask_question" tool to present the user with multiple-choice options (e.g., "What frontend framework do you want to use?", options: ["React + Tailwind", "Vue + CSS"]).
If you use the "ask_question" tool, output a JSON response after the tool completes to summarize the decision.
If the request already has enough detail, simply output a text summary of the requirements without calling tools.`;

    const historyContext = serializeHistory(history ?? []);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `User Request:\n${story}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getToolDefinitions().filter(t => t.function.name === 'ask_question'), // Only allow ask_question
      maxIterations: 10,
      agentName: 'Clarification',
      cwd: this.cwd,
      onProgress,
      onInteractive,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      ...opts
    });

    return response;
  }
}

// ── Architect Agent ──────────────────────────────────────────────────────

export class ArchitectAgent {
  constructor(private repoPath: string = '.') {}

  async planImplementation(story: string, onProgress?: ProgressCallback, history?: ChatMessage[], sessionState?: { aborted: boolean }, opts: any = {}): Promise<ImplementationPlan> {
    onProgress?.('Architect', 'Retrieving repository context...');

    const systemPrompt = `You are an expert Software Architect. Your job is to plan code changes.
Given the user story and codebase context, investigate the project using tools, then output a JSON plan.

INSTRUCTIONS:
1. ANALYZE FIRST: You MUST use tools (search_files, read_file) to thoroughly investigate the existing project structure, dependencies, and relevant files BEFORE creating your plan.
2. THINK TASK-BY-TASK: Think step-by-step. Break the implementation down into clear, modular tasks.
3. TEST-DRIVEN DEVELOPMENT (TDD): Whenever applicable, draft tasks to write or update tests FIRST, then implement the feature, or vice versa. Ensure the plan is rock-solid.
4. WRITE PLAN TO DISK: Use the write_file tool to create a file named "implementation_plan.md" in the root directory. Document your goal, open questions, proposed changes (files to create/modify), and verification plan.
5. FINALIZE: Once you have written "implementation_plan.md", output your final response in pure JSON format ONLY:

{
  "plan_summary": "Wrote plan to implementation_plan.md",
  "files_to_create": [],
  "files_to_modify": []
}

CRITICAL: When you output this JSON, it must be the ONLY thing in your response. No markdown, no prose before or after. Your response will be parsed directly as JSON.`;

    const historyContext = serializeHistory(history ?? []);

    let contextStr = '';
    try {
      contextStr = `Repository Map (Classes & Functions):\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `User Story:\n${story}\n\nInitial Context:\n${contextStr}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getToolDefinitions(),
      maxIterations: 60,
      agentName: 'Architect',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    return parsePlan(response, 'Architect');
  }

  async planScaffolding(description: string, onProgress?: ProgressCallback, history?: ChatMessage[], sessionState?: { aborted: boolean }, opts: any = {}): Promise<ImplementationPlan> {
    onProgress?.('Architect', 'Designing project scaffolding...');

    const systemPrompt = `You are an expert Software Architect designing a new project from scratch.
Given the user's description, design a complete, production-ready directory structure and initial files.

INSTRUCTIONS:
1. INVESTIGATE: Use tools to check if any scaffolding exists.
2. WRITE PLAN TO DISK: Use the write_file tool to create "implementation_plan.md" detailing the complete directory structure and initial files needed.
3. FINALIZE: Output your final response in pure JSON format ONLY:

{
  "plan_summary": "Wrote scaffolding plan to implementation_plan.md",
  "files_to_create": [],
  "files_to_modify": []
}

CRITICAL: Your final response must be ONLY the JSON object. No markdown, no explanation.`;

    const historyContext = serializeHistory(history ?? []);

    let contextStr = '';
    try {
      contextStr = `\nRepository Map:\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Project Description:\n${description}${contextStr}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getReadOnlyToolDefinitions(),
      maxIterations: 60,
      agentName: 'Architect',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    return parsePlan(response, 'Architect');
  }
}

// ── Debug Agent (FIX intent) ─────────────────────────────────────────────

export class DebugAgent {
  constructor(private repoPath: string = '.') {}

  async diagnoseAndFix(
    errorDescription: string,
    onProgress?: ProgressCallback,
    history?: ChatMessage[],
    sessionState?: { aborted: boolean },
    opts: any = {}
  ): Promise<ImplementationPlan> {
    onProgress?.('Debug', 'Investigating the issue...');

    const systemPrompt = `You are an expert Software Debugger and Diagnostician.
Your job is to investigate bugs, errors, and issues in the codebase and produce a minimal, targeted fix plan.

CRITICAL: When you output this JSON, it must be the ONLY thing in your response. No markdown, no prose before or after.`;

    const historyContext = serializeHistory(history ?? []);

    let contextStr = '';
    try {
      contextStr = `Repository Map (Classes & Functions):\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Bug/Error Report:\n${errorDescription}\n\nProject Context:\n${contextStr}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getReadOnlyToolDefinitions(),
      maxIterations: 60,
      agentName: 'Debug',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    return parsePlan(response, 'Debug');
  }
}

// ── Test Agent (TEST intent) ─────────────────────────────────────────────

export class TestAgent {
  constructor(private repoPath: string = '.') {}

  async generateTests(
    description: string,
    onProgress?: ProgressCallback,
    history?: ChatMessage[],
    sessionState?: { aborted: boolean },
    opts: any = {}
  ): Promise<ImplementationPlan> {
    onProgress?.('TestGen', 'Analyzing code to generate tests...');

    const systemPrompt = `You are an expert Test Engineer.
Your job is to analyze existing code and generate comprehensive test files.

INSTRUCTIONS:
1. Review the Repository Map to find the files containing the components to test.
2. Use tools to read the source files that need testing.
2. Understand the functions, classes, and logic to test.
3. Detect the testing framework used in the project (check package.json for jest/vitest/mocha, requirements.txt for pytest, etc).
4. Generate test files with proper imports, mocking, and comprehensive test cases.

After investigation, output your final response in pure JSON format ONLY:
{
  "plan_summary": "Generating tests for [components]. Using [framework].",
  "files_to_create": [{"path": "tests/test_module.ts", "description": "Test file description with specific test cases to include"}],
  "files_to_modify": []
}

If test config needs updating (e.g., jest.config.js), include it in files_to_modify.
CRITICAL: Your final response must be ONLY the JSON object. No markdown, no explanation.`;

    const historyContext = serializeHistory(history ?? []);

    let contextStr = '';
    try {
      contextStr = `Repository Map (Classes & Functions):\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Test Generation Request:\n${description}\n\nProject Context:\n${contextStr}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getReadOnlyToolDefinitions(),
      maxIterations: 60,
      agentName: 'TestGen',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    return parsePlan(response, 'TestGen');
  }
}

// ── Review Agent (REVIEW intent) ────────────────────────────────────────

export class ReviewAgent {
  constructor(private repoPath: string = '.') {}

  async reviewCode(
    description: string,
    onProgress?: ProgressCallback,
    history?: ChatMessage[],
    sessionState?: { aborted: boolean },
    opts: any = {}
  ): Promise<string> {
    onProgress?.('Review', 'Analyzing code for review...');

    const systemPrompt = `You are an expert Code Reviewer performing a thorough code review.
Your job is to analyze code quality, find issues, suggest improvements, and assess overall design.

INSTRUCTIONS:
1. Use tools to read the relevant source files.
2. Use search_files to find patterns, potential issues, or related code.
3. Analyze for:
   - Bugs and logic errors
   - Security vulnerabilities
   - Performance issues
   - Code style and readability
   - Missing error handling
   - Dead code
   - Design pattern violations
4. Produce a structured review.

CRITICAL: NEVER ask the user to provide files, upload files, or paste code. YOU have access to the filesystem. Use your tools (list_directory, read_file, search_files) to find and read the files yourself! If the project map is empty or doesn't show the files you need, use list_directory to explore the workspace.

Your final response should be a well-formatted markdown review:

## Code Review Summary
[Overall assessment]

## Issues Found
### 🔴 Critical
- [Issue description with file:line references]

### 🟡 Warnings
- [Issue description]

### 🟢 Suggestions
- [Improvement suggestions]

## Positive Observations
- [What's done well]

Be specific — reference file paths and line numbers where possible.`;

    const historyContext = serializeHistory(history ?? []);

    let contextStr = '';
    try {
      contextStr = `Repository Map (Classes & Functions):\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Review Request:\n${description}\n\nProject Context:\n${contextStr}${historyContext}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getReadOnlyToolDefinitions(),
      maxIterations: 60,
      agentName: 'Review',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      ...opts
    });

    return response || 'Unable to complete the code review. Please try again with more specific files or context.';
  }
}


// ── Engineering Agent ────────────────────────────────────────────────────

export class EngineeringAgent {
  constructor(private repoPath: string = '.') {}

  async executePlan(
    plan: ImplementationPlan, // Kept for backwards compatibility in interface
    safeMode: boolean = false,
    onProgress?: ProgressCallback,
    sessionState?: { aborted: boolean },
    onInteractive?: (toolName: string, args: any) => Promise<any>,
    opts: any = {}
  ): Promise<{ approved: boolean; filesChanged: string[]; summary?: string }> {
    onProgress?.('Engineer', `Starting execution of Markdown Plan...`);

    // In safe mode, we return the plan for UI approval — don't execute yet
    if (safeMode) {
      onProgress?.('Engineer', '⚠️ Safe Mode — awaiting user approval in UI...');
      return { approved: false, filesChanged: [] };
    }

    const systemPrompt = `You are an expert Software Engineer executing a plan.
    
INSTRUCTIONS:
1. READ PLAN: If there is an "implementation_plan.md" file in the root directory, read it. Otherwise read the user's prompt carefully.
2. CREATE TASKS: Write a "task.md" file in the root directory breaking down the work. Format tasks like "- [ ] Task 1".
3. EXECUTE: Iteratively complete the tasks. Use write_file, run_command, search_files, read_file. 
4. UPDATE PROGRESS: After completing a file or command, update "task.md" to check it off: "- [x] Task 1".
5. FINALIZE: Once all tasks are checked off, output your final response in pure JSON format ONLY:

{
  "status": "success",
  "files_changed": ["path1", "path2"],
  "summary": "A detailed, user-friendly summary explaining what has been executed, implemented, and tested end-to-end. Make it sound professional."
}

CRITICAL: Your final response MUST be ONLY the JSON object. No markdown, no prose.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Start executing the plan. Read implementation_plan.md if it exists, otherwise rely on the initial plan summary: ${plan.plan_summary}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getToolDefinitions(),
      maxIterations: 100, // Long loop for execution
      agentName: 'Engineer',
      cwd: this.repoPath,
      onProgress,
      onInteractive,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    let filesChanged: string[] = [];
    let summary: string = '';
    try {
      const parsed = extractJSON<{ status: string, files_changed?: string[], summary?: string }>(response);
      if (parsed) {
        filesChanged = parsed.files_changed || [];
        summary = parsed.summary || '';
      } else {
        const rawParsed = JSON.parse(response);
        filesChanged = rawParsed.files_changed || [];
        summary = rawParsed.summary || '';
      }
    } catch {
      // fallback
    }

    return { approved: true, filesChanged, summary };
  }

  // Removed unused legacy methods (createFile, modifyFile, applySearchReplaceBlocks)
}

// ── Verification Agent ───────────────────────────────────────────────────

export interface TestResult {
  success: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
}

export class VerificationAgent {
  constructor(private repoPath: string = '.') {
    this.repoPath = path.resolve(repoPath);
  }

  detectTestCommand(): string | null {
    // Check for Node.js projects first (prioritize over Python if both exist)
    const pkgPath = path.join(this.repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          return 'npm test';
        }
      } catch { /* ignore */ }
    }

    // Check for Python projects
    const pyprojectPath = path.join(this.repoPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      const content = fs.readFileSync(pyprojectPath, 'utf-8').toLowerCase();
      if (content.includes('pytest')) return 'pytest';
    }
    
    const reqPath = path.join(this.repoPath, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf-8').toLowerCase();
      if (content.includes('pytest')) return 'pytest';
      if (content.includes('unittest')) return 'python -m unittest discover';
    }

    // Check for Go projects
    const goModPath = path.join(this.repoPath, 'go.mod');
    if (fs.existsSync(goModPath)) return 'go test ./...';

    // Check for Rust projects  
    const cargoPath = path.join(this.repoPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) return 'cargo test';

    return null;
  }

  async runTests(command: string): Promise<TestResult> {
    try {
      const output = await AgentTools.runCommandAsync(command, this.repoPath);
      return { success: !output.startsWith('Error executing command:'), stdout: output, stderr: '', returncode: 0 };
    } catch (e: unknown) {
      const err = e as any;
      const stderr = err.stderr ? err.stderr.toString() : '';
      const stdout = err.stdout ? err.stdout.toString() : '';
      return {
        success: false,
        stdout: stdout,
        stderr: stderr || err.message || '',
        returncode: err.status ?? -1,
      };
    }
  }
}

// ── Repair Agent ─────────────────────────────────────────────────────────

export class RepairAgent {
  private failedAttempts: ImplementationPlan[] = [];
  private engineer: EngineeringAgent;

  constructor(private repoPath: string = '.') {
    this.engineer = new EngineeringAgent(repoPath);
  }

  async generateRepairPlan(
    testOutput: string,
    failedCommand: string,
    onProgress?: ProgressCallback,
    sessionState?: { aborted: boolean },
    opts: any = {}
  ): Promise<ImplementationPlan> {
    onProgress?.('Repair', 'Analyzing test failures...');

    const systemPrompt = `You are an expert Software Engineer analyzing test/build/environment failures.
Given the failure logs, investigate the issue using tools, then output a JSON fix plan. The issue might be a code bug, a missing dependency, or a configuration error.

INSTRUCTIONS:
1. Read the error logs carefully to identify the root cause.
2. If it's a code bug, use read_file to inspect the failing source code.
3. If it's a missing module or dependency error (e.g., "module not found", "command not recognized"), determine the exact bash command needed to fix it (e.g., "npm install", "pip install").
4. Produce a minimal fix plan. If no files need changing and only a bash command is needed, leave the files arrays empty and put the command instructions in the plan_summary.
5. IMPORTANT: You MUST use tools to investigate the codebase FIRST. Do NOT output the final JSON immediately. Use your tools across multiple turns until you are fully ready.

After investigation and once you are ready to finalize, output your final response in pure JSON format ONLY:
{
  "plan_summary": "Root cause: [explanation]. Fix: [bash commands to run or logical changes to make]",
  "files_to_create": [],
  "files_to_modify": [{"path": "...", "description": "..."}]
}

CRITICAL: Your final response must be ONLY the JSON object.`;

    let failedStr = '';
    if (this.failedAttempts.length > 0) {
      failedStr = '\nPREVIOUS FAILED APPROACHES (DO NOT REPEAT THESE):\n';
      this.failedAttempts.forEach((plan, i) => {
        failedStr += `${i + 1}. ${plan.plan_summary}\n`;
      });
    }

    let contextStr = '';
    try {
      contextStr = `\nRepository Map:\n${generateRepoMap(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Command Failed: ${failedCommand}\n\nLogs:\n${testOutput}\n${failedStr}${contextStr}` },
    ];

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getReadOnlyToolDefinitions(),
      maxIterations: 60,
      agentName: 'Repair',
      cwd: this.repoPath,
      onProgress,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      enforceJson: true,
      ...opts
    });

    const plan = parsePlan(response, 'Repair');
    this.failedAttempts.push(plan);
    return plan;
  }

  async executeRepair(plan: ImplementationPlan, onProgress?: ProgressCallback, sessionState?: { aborted: boolean }, opts: any = {}) {
    await this.engineer.executePlan(plan, false, onProgress, sessionState, undefined, opts);
  }
}


// ── Chat Agent ────────────────────────────────────────────────────────────

export class ChatAgent {
  constructor(protected cwd: string = '.') {}

  async chat(userPrompt: string, onProgress?: ProgressCallback, history?: ChatMessage[], sessionState?: { aborted: boolean }, opts: any = {}): Promise<string> {
    onProgress?.('Chat', 'Thinking...');

    const systemPrompt = `You are a powerful, autonomous coding assistant integrated into an IDE.
Your goal is to help the user with any coding tasks, answer questions, analyze codebases, and debug issues.
You have access to tools that allow you to read files, run terminal commands, and create or modify files.
When creating or updating files, output the full file contents if it's new, or clear edit instructions if modifying.
Always strive to be helpful, concise, and technically accurate.`;

    let contextStr = '';
    try {
      contextStr = `Project context:\n${generateRepoMap(this.cwd)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [];
    messages.push({ role: 'system', content: systemPrompt + contextStr });
    
    if (history && history.length > 0) {
      // Include recent structured history (last 10 messages)
      const recent = history.slice(-10);
      messages.push(...recent);
    }
    
    messages.push({ role: 'user', content: userPrompt });

    const response = await agenticLoop({
      messages,
      tools: AgentTools.getToolDefinitions(),
      maxIterations: 60,
      agentName: 'Chat',
      cwd: this.cwd,
      onProgress,
      blockCommands: false,
      blockWrites: false,
      aborted: sessionState ? { value: sessionState.aborted } : undefined,
      ...opts
    });

    return response || 'I apologize, but I was unable to generate a response. Could you try rephrasing your question?';
  }
}
