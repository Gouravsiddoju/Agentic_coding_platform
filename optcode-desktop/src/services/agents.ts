/**
 * OPTCode Agent Pipeline — TypeScript Port
 * Architect → Engineer → Verifier → Repair
 * 
 * All agents connect to OptGPT-4:latest on the company's private server.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { LLMService, type ChatMessage } from './llm-service';
import { AgentTools } from './agent-tools';

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

// ── Architect Agent ──────────────────────────────────────────────────────

export class ArchitectAgent {
  constructor(private repoPath: string = '.') {}

  async planImplementation(story: string, onProgress?: ProgressCallback): Promise<ImplementationPlan> {
    onProgress?.('Architect', 'Retrieving repository context...');

    const systemPrompt = `You are an expert Software Architect.
Given the user story and codebase context, output a JSON plan detailing files to create and modify.
You have access to tools. Use them to read files or list directories to understand the codebase BEFORE finalizing your plan.
Once you are done investigating, output your final response in pure JSON format ONLY:
{
  "plan_summary": "...",
  "files_to_create": [{"path": "...", "description": "..."}],
  "files_to_modify": [{"path": "...", "description": "..."}]
}
Do NOT include any markdown formatting, output pure JSON.`;

    // Build initial context by listing the project root
    let contextStr = '';
    try {
      contextStr = `Project files:\n${AgentTools.listDirectory(this.repoPath)}`;
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `User Story:\n${story}\n\nInitial Context:\n${contextStr}` },
    ];

    const tools = AgentTools.getToolDefinitions();
    let response = '';

    // Agentic loop — let the LLM call tools until it produces a final answer
    for (let i = 0; i < 10; i++) {
      onProgress?.('Architect', `Thinking... (step ${i + 1})`);
      const msg = await LLMService.agentChat(messages, tools);
      if (!msg) break;

      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const funcName = tc.function.name;
          let args = tc.function.arguments;
          // Handle stringified args
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {} as Record<string, string>; }
          }

          onProgress?.('Architect', `Tool call: ${funcName}(${JSON.stringify(args)})`);

          // Safety: block command execution during Architect phase
          let output: string;
          if (funcName === 'run_command') {
            output = 'Command execution disabled during Architect phase for safety.';
          } else {
            output = AgentTools.executeTool(funcName, args as Record<string, string>, this.repoPath);
          }

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: output,
            name: funcName,
          };
          if (tc.id) toolMsg.tool_call_id = tc.id;
          messages.push(toolMsg);
        }
      } else {
        response = msg.content ?? '';
        break;
      }
    }

    return this.parsePlan(response);
  }

  async planScaffolding(description: string, onProgress?: ProgressCallback): Promise<ImplementationPlan> {
    onProgress?.('Architect', 'Designing project scaffolding...');

    const systemPrompt = `You are an expert Software Architect designing a new project from scratch.
Given the user's description, design a complete, production-ready directory structure and initial files.
Output your design in pure JSON format ONLY:
{
  "plan_summary": "...",
  "files_to_create": [{"path": "...", "description": "..."}],
  "files_to_modify": []
}
Include base files like README.md, requirements.txt, or package.json as appropriate.
Do NOT include any markdown formatting, output pure JSON.`;

    const response = await LLMService.generateCompletion(
      `Project Description:\n${description}`,
      systemPrompt
    );

    return this.parsePlan(response);
  }

  private parsePlan(raw: string): ImplementationPlan {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      return JSON.parse(cleaned.trim());
    } catch (e) {
      console.error(`Error parsing Architect plan: ${e}\nRaw: ${raw}`);
      return { plan_summary: 'Failed to parse plan', files_to_create: [], files_to_modify: [] };
    }
  }
}

// ── Engineering Agent ────────────────────────────────────────────────────

export class EngineeringAgent {
  constructor(private repoPath: string = '.') {}

  async executePlan(
    plan: ImplementationPlan,
    safeMode: boolean = false,
    onProgress?: ProgressCallback
  ): Promise<{ approved: boolean; filesChanged: string[] }> {
    onProgress?.('Engineer', `Executing plan: ${plan.plan_summary}`);

    // In safe mode, we return the plan for UI approval — don't execute yet
    if (safeMode) {
      onProgress?.('Engineer', '⚠️ Safe Mode — awaiting user approval in UI...');
      return { approved: false, filesChanged: [] };
    }

    const filesChanged: string[] = [];

    // Files to Create
    for (const file of plan.files_to_create) {
      onProgress?.('Engineer', `Creating ${file.path}...`);
      await this.createFile(file.path, file.description);
      filesChanged.push(file.path);
    }

    // Files to Modify
    for (const file of plan.files_to_modify) {
      onProgress?.('Engineer', `Modifying ${file.path}...`);
      await this.modifyFile(file.path, file.description);
      filesChanged.push(file.path);
    }

    return { approved: true, filesChanged };
  }

  private async createFile(filePath: string, description: string): Promise<void> {
    const systemPrompt =
      'You are an expert Software Engineer. Generate complete, working code based on the description. Do NOT use markdown code blocks, just output the pure code text.';
    const prompt = `File to create: ${filePath}\nDescription: ${description}`;
    let code = await LLMService.generateCompletion(prompt, systemPrompt);

    // Strip markdown if the LLM wraps it anyway
    code = code.trim();
    if (code.startsWith('```')) {
      const firstNewline = code.indexOf('\n');
      code = code.slice(firstNewline + 1);
    }
    if (code.endsWith('```')) code = code.slice(0, -3).trimEnd();

    const fullPath = path.join(this.repoPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, code, 'utf-8');
  }

  private async modifyFile(filePath: string, description: string): Promise<void> {
    const fullPath = path.join(this.repoPath, filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: ${filePath} does not exist.`);
      return;
    }

    const originalCode = fs.readFileSync(fullPath, 'utf-8');
    const systemPrompt =
      'You are an expert Software Engineer. You will be given the original code and a description of modifications. Output the FULL modified code. Do NOT use markdown code blocks, just output the pure code text.';
    const prompt = `File: ${filePath}\nDescription of changes: ${description}\n\nOriginal Code:\n${originalCode}`;

    let newCode = await LLMService.generateCompletion(prompt, systemPrompt);

    newCode = newCode.trim();
    if (newCode.startsWith('```')) {
      const firstNewline = newCode.indexOf('\n');
      newCode = newCode.slice(firstNewline + 1);
    }
    if (newCode.endsWith('```')) newCode = newCode.slice(0, -3).trimEnd();

    fs.writeFileSync(fullPath, newCode, 'utf-8');
  }
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
    // Check for Python projects
    const reqPath = path.join(this.repoPath, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf-8').toLowerCase();
      if (content.includes('pytest')) return 'pytest';
      if (content.includes('unittest')) return 'python -m unittest discover';
    }

    // Check for Node.js projects
    const pkgPath = path.join(this.repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test) return 'npm test';
      } catch { /* ignore */ }
    }

    return null;
  }

  runTests(command: string = 'pytest'): TestResult {
    try {
      const stdout = execSync(command, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, stdout, stderr: '', returncode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return {
        success: false,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
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
    onProgress?: ProgressCallback
  ): Promise<ImplementationPlan> {
    onProgress?.('Repair', 'Analyzing test failures...');

    const systemPrompt = `You are an expert Software Engineer analyzing test/build failures.
Given the failure logs, output a JSON plan detailing files to modify to fix the issue.
JSON Format expected:
{
  "plan_summary": "...",
  "files_to_create": [],
  "files_to_modify": [{"path": "...", "description": "..."}]
}
Do NOT include any markdown formatting, output pure JSON.`;

    let failedStr = '';
    if (this.failedAttempts.length > 0) {
      failedStr = '\nPREVIOUS FAILED APPROACHES (DO NOT REPEAT THESE):\n';
      this.failedAttempts.forEach((plan, i) => {
        failedStr += `${i + 1}. ${plan.plan_summary}\n`;
      });
    }

    const prompt = `Command Failed: ${failedCommand}\n\nLogs:\n${testOutput}\n${failedStr}`;
    const response = await LLMService.generateCompletion(prompt, systemPrompt);

    const plan = this.parsePlan(response);
    this.failedAttempts.push(plan);
    return plan;
  }

  async executeRepair(plan: ImplementationPlan, onProgress?: ProgressCallback) {
    await this.engineer.executePlan(plan, false, onProgress);
  }

  private parsePlan(raw: string): ImplementationPlan {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      return JSON.parse(cleaned.trim());
    } catch (e) {
      console.error(`Error parsing Repair plan: ${e}\nRaw: ${raw}`);
      return { plan_summary: 'Failed to parse plan', files_to_create: [], files_to_modify: [] };
    }
  }
}
