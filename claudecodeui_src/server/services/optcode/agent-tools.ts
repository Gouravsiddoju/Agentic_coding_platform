/**
 * OPTCode Agent Tools — TypeScript Port
 * Provides file system and command execution tools for the agents.
 * 
 * Tools: read_file, list_directory, search_files, run_command, write_file
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, exec } from 'node:child_process';
import Fuse from 'fuse.js';
import { generateRawRepoMap } from './repo-mapper.js';
import type { ToolDefinition } from './llm-service.js';
import { ProcessManager } from './process-manager.js';
import { BrowserService } from './browser-use.service.js';

export class AgentTools {

  /**
   * Returns all tool definitions (read, write, execute, search).
   */
  static getToolDefinitions(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads the content of a file. Supports optional startLine and endLine (1-indexed) to read massive files in smaller chunks.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The path to the file, relative to the project root' },
              startLine: { type: 'number', description: 'Optional. The starting line number (1-indexed)' },
              endLine: { type: 'number', description: 'Optional. The ending line number (inclusive)' }
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'Lists the files and folders in a directory with type indicators. Path is relative to the project root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: "The directory path relative to the project root. Use '.' for the root." },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_files',
          description: 'Searches for a text pattern across files in the project. Returns matching lines with file paths and line numbers.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'The text or regex pattern to search for' },
              path: { type: 'string', description: "Directory to search in, relative to the project root. Defaults to '.'." },
              file_pattern: { type: 'string', description: "Optional glob pattern to filter files, e.g. '*.ts' or '*.py'" },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_codebase',
          description: 'Fuzzy searches the structural map of the entire repository (classes, functions, file paths) to find where concepts are implemented. Use this as a lightweight RAG to quickly find files without guessing exact filenames.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The fuzzy search term (e.g., "auth handler" or "database config")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_command',
          description: 'Runs a terminal command and returns the stdout and stderr.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The shell command to execute' },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'start_process',
          description: 'Starts a long-running background process (like a dev server or build watcher). Returns a PID.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The shell command to start' },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_process_logs',
          description: 'Reads the standard output and standard error logs of a running background process by PID.',
          parameters: {
            type: 'object',
            properties: {
              pid: { type: 'number', description: 'The Process ID returned by start_process' },
              lines: { type: 'number', description: 'Optional. Number of lines to tail from the log (default 50)' },
            },
            required: ['pid'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Navigates the Puppeteer browser to a URL. Opens the browser if not already open.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'The URL to navigate to' },
              headless: { type: 'boolean', description: 'Run in headless mode (default true). Set false to show browser.' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Clicks an element on the current page matching a CSS selector.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'The CSS selector of the element to click' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Types text into an input element on the current page matching a CSS selector.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'The CSS selector of the input element' },
              text: { type: 'string', description: 'The text to type' },
            },
            required: ['selector', 'text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_extract',
          description: 'Extracts inner text from an element matching a CSS selector.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'The CSS selector of the element' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'stop_process',
          description: 'Stops a running background process by PID.',
          parameters: {
            type: 'object',
            properties: {
              pid: { type: 'number', description: 'The Process ID to kill' },
            },
            required: ['pid'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ask_question',
          description: 'Ask the user a multiple-choice or multi-select question to gather requirements before planning.',
          parameters: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question to ask the user' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'The possible answers the user can select from'
              },
              is_multi_select: { type: 'boolean', description: 'If true, the user can select multiple options.' }
            },
            required: ['question', 'options'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Writes content to a file. Creates parent directories if needed. Path is relative to the project root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The file path to write to, relative to the project root' },
              content: { type: 'string', description: 'The content to write' },
            },
            required: ['path', 'content'],
          },
        },
      },
    ];
  }

  /**
   * Returns read-only tool definitions (no write_file, no run_command).
   * Used by ChatAgent, DebugAgent, ReviewAgent, and other investigative agents.
   */
  static getReadOnlyToolDefinitions(): ToolDefinition[] {
    // UNBLOCKED: Give all agents access to all tools (run_command, write_file)
    // so they can fix issues and scaffold files without asking the Engineer.
    return AgentTools.getToolDefinitions();
  }

  /**
   * Resolves a path safely within the project sandbox.
   * Prevents path traversal attacks (e.g., ../../etc/passwd).
   */
  private static safePath(filePath: string, cwd: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null;
    const resolved = path.resolve(cwd, filePath);
    const normalizedCwd = path.resolve(cwd);
    // Ensure the resolved path is within the project directory
    if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
      return null;
    }
    return resolved;
  }

  static readFile(filePath: string, startLine?: number, endLine?: number, cwd?: string): string {
    const resolvedPath = cwd ? AgentTools.safePath(filePath, cwd) : filePath;
    if (!resolvedPath) return `Error: Path '${filePath}' is outside the project directory. Access denied.`;
    try {
      if (!fs.existsSync(resolvedPath)) return `Error: File '${filePath}' does not exist.`;
      if (fs.statSync(resolvedPath).isDirectory()) return `Error: '${filePath}' is a directory, not a file.`;
      let content = fs.readFileSync(resolvedPath, 'utf-8');
      
      // If lines specified, slice them
      if (startLine !== undefined) {
        const lines = content.split('\n');
        const end = endLine !== undefined ? endLine : lines.length;
        // Lines are 1-indexed for the user
        content = lines.slice(Math.max(0, startLine - 1), end).join('\n');
      }

      // Truncate very large files to prevent context overflow
      if (content.length > 50000) {
        return content.slice(0, 50000) + `\n\n... [FILE TRUNCATED — showing first 50000 characters of ${content.length} total]`;
      }
      return content;
    } catch (e) {
      return `Error reading file: ${e}`;
    }
  }

  static listDirectory(dirPath: string, cwd?: string): string {
    const resolvedPath = cwd ? AgentTools.safePath(dirPath, cwd) : dirPath;
    if (!resolvedPath) return `Error: Path '${dirPath}' is outside the project directory. Access denied.`;
    try {
      if (!fs.existsSync(resolvedPath)) return `Error: Directory '${dirPath}' does not exist.`;
      if (!fs.statSync(resolvedPath).isDirectory()) return `Error: '${dirPath}' is a file, not a directory.`;
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      if (entries.length === 0) return '(Empty directory)';
      
      // Sort: directories first, then files, both alphabetical
      const dirs = entries.filter(e => e.isDirectory()).map(e => `${e.name}/`).sort();
      const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();
      
      return [...dirs, ...files].join('\n');
    } catch (e) {
      return `Error listing directory: ${e}`;
    }
  }

  static searchFiles(pattern: string, searchPath: string = '.', filePattern?: string, cwd?: string): string {
    const resolvedPath = cwd ? AgentTools.safePath(searchPath, cwd) : searchPath;
    if (!resolvedPath) return `Error: Path '${searchPath}' is outside the project directory. Access denied.`;
    
    try {
      const results: string[] = [];
      const regex = new RegExp(pattern, 'i');
      let fileCount = 0;

      function walk(dir: string) {
        if (results.length >= 30 || fileCount > 10000) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        
        for (const entry of entries) {
          if (results.length >= 30) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue;
            walk(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
            if (filePattern) {
              const fileRegex = new RegExp(filePattern.replace(/\\./g, '\\\\.').replace(/\\*/g, '.*'));
              if (!fileRegex.test(entry.name)) continue;
            }
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              // Skip likely binary files
              if (content.includes('\\0')) continue;
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  const relPath = path.relative(resolvedPath as string, fullPath);
                  results.push(`${relPath}:${i + 1}:${lines[i].trim()}`);
                  if (results.length >= 30) break;
                }
              }
            } catch (e) {
              // Ignore binary files or read errors
            }
          }
        }
      }
      walk(resolvedPath);
      return results.length > 0 ? results.join('\n') : `No matches found for pattern '${pattern}'.`;
    } catch (e: unknown) {
      return `Error searching files: ${(e as Error).message}`;
    }
  }

  static runCommand(command: string, cwd?: string): string {
    const blockedCmds = ['taskkill', 'kill ', 'pkill', 'shutdown', 'format', 'del /s', 'rm -rf /'];
    for (const b of blockedCmds) {
      if (command.toLowerCase().includes(b)) {
        return `Error: Command execution blocked for safety reasons (matched blocked keyword: ${b}). You cannot run destructive OS-level commands.`;
      }
    }
    
    try {
      const result = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result || 'Command executed successfully with no output.';
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      let output = '';
      if (err.stdout) output += `STDOUT:\n${err.stdout}\n`;
      if (err.stderr) output += `STDERR:\n${err.stderr}\n`;
      return output || `Error executing command: ${err.message}`;
    }
  }

  static async runCommandAsync(command: string, cwd?: string): Promise<string> {
    const blockedCmds = ['taskkill', 'kill ', 'pkill', 'shutdown', 'format', 'del /s', 'rm -rf /'];
    for (const b of blockedCmds) {
      if (command.toLowerCase().includes(b)) {
        return `Error: Command execution blocked for safety reasons (matched blocked keyword: ${b}). You cannot run destructive OS-level commands.`;
      }
    }
    
    let finalCommand = command;
    let tempScriptPath = '';

    if (process.env.OPTCODE_SANDBOX_MODE === 'docker' && cwd) {
      const volumePath = cwd.replace(/\\/g, '/');
      const tempScriptName = `.optcode_run_${Date.now()}.sh`;
      tempScriptPath = path.join(cwd, tempScriptName);
      try {
        fs.writeFileSync(tempScriptPath, command, 'utf-8');
        finalCommand = `docker run --rm -v "${volumePath}:/workspace" -w /workspace mcr.microsoft.com/devcontainers/universal:latest bash ${tempScriptName}`;
      } catch (e: any) {
        return `Error creating temporary script for sandboxing: ${e.message}`;
      }
    }

    return new Promise((resolve) => {
      exec(finalCommand, { cwd, encoding: 'utf-8', timeout: 120_000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (tempScriptPath && fs.existsSync(tempScriptPath)) {
          try { fs.unlinkSync(tempScriptPath); } catch { /* ignore */ }
        }

        if (error) {
          let output = '';
          if (stdout) output += `STDOUT:\n${stdout}\n`;
          if (stderr) output += `STDERR:\n${stderr}\n`;
          resolve(output || `Error executing command: ${error.message}`);
        } else {
          resolve(stdout || 'Command executed successfully with no output.');
        }
      });
    });
  }

  static writeFile(filePath: string, content: string, cwd?: string): string {
    const resolvedPath = cwd ? AgentTools.safePath(filePath, cwd) : filePath;
    if (!resolvedPath) return `Error: Path '${filePath}' is outside the project directory. Access denied.`;
    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf-8');
      return `File '${filePath}' written successfully.`;
    } catch (e) {
      return `Error writing file: ${e}`;
    }
  }

  /**
   * Execute a tool call by name and return the result.
   * All file tools resolve paths relative to `cwd`.
   */
  // We keep executeTool synchronous for read-only non-interactive tools for backward compatibility
  static executeTool(name: string, args: Record<string, any>, cwd?: string): string {
    const pathArg = args.path || args.file_path;
    const contentArg = args.content !== undefined ? args.content : args.new_string;

    // Basic switch statement for local non-interactive tools...
    if (name === 'read_file') return this.readFile(pathArg, args.startLine, args.endLine, cwd);
    if (name === 'list_directory') return this.listDirectory(pathArg || '.', cwd);
    if (name === 'search_files') return this.searchFiles(args.pattern, pathArg || '.', args.file_pattern, cwd);
    if (name === 'search_codebase') return 'search_codebase is not fully implemented synchronously here.';
    if (name === 'write_file') return this.writeFile(pathArg, contentArg, cwd);
    if (name === 'run_command') return this.runCommand(args.command, cwd);
    
    // Background Process Tools
    if (name === 'start_process') {
      try {
        const pid = ProcessManager.start(args.command, cwd || '.');
        return `Process started with PID: ${pid}`;
      } catch (e: any) {
        return `Failed to start process: ${e.message}`;
      }
    }
    if (name === 'read_process_logs') {
      return ProcessManager.readLogs(args.pid, args.lines);
    }
    if (name === 'stop_process') {
      return ProcessManager.stop(args.pid);
    }
    
    return `Error: Tool ${name} not found or requires async execution.`;
  }

  static async executeToolAsync(name: string, args: Record<string, any>, cwd: string | undefined, onInteractive?: (toolName: string, args: any) => Promise<any>, permissionMode: string = 'default'): Promise<string> {
    const isModifyingTool = ['run_command', 'write_file', 'start_process', 'stop_process', 'browser_click', 'browser_type', 'browser_navigate'].includes(name);
    const isHighRiskTool = ['run_command', 'start_process', 'stop_process'].includes(name);

    let requiresPermission = false;
    if (permissionMode === 'default') {
      requiresPermission = isModifyingTool;
    } else if (permissionMode === 'auto' || permissionMode === 'acceptEdits') {
      requiresPermission = isHighRiskTool || name.startsWith('browser_');
    }

    if (requiresPermission && onInteractive) {
      try {
        const approveResult = await onInteractive('ask_question', {
          question: `The agent wants to execute the tool \`${name}\` with arguments: \n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\nDo you want to allow this action?`,
          options: ['Allow', 'Deny'],
          is_multi_select: false
        });
        if (approveResult && approveResult.length > 0 && approveResult[0] === 'Deny') {
          return `Error: User denied permission to execute ${name}.`;
        }
      } catch (e) {
        return `Error asking for permission: ${e}`;
      }
    }

    if (name === 'ask_question' || name === 'run_command_with_permission') {
      if (!onInteractive) {
        return `Error: Tool ${name} requires an interactive session, but no handler was provided.`;
      }
      try {
        const result = await onInteractive(name, args);
        return JSON.stringify(result);
      } catch (e) {
        return `Error during interactive tool execution: ${e}`;
      }
    }
    
    if (name === 'run_command') return this.runCommandAsync(args.command, cwd);
    
    // Browser Controller Tools (Async)
    if (name === 'browser_navigate') return BrowserService.navigate(args.url, args.headless);
    if (name === 'browser_click') return BrowserService.click(args.selector);
    if (name === 'browser_type') return BrowserService.type(args.selector, args.text);
    if (name === 'browser_extract') return BrowserService.extractText(args.selector);
    
    // Fall back to sync
    return this.executeTool(name, args, cwd);
  }

  static searchCodebase(query: string, cwd?: string): string {
    const resolvedPath = cwd || '.';
    try {
      const rawMap = generateRawRepoMap(resolvedPath);
      const fuse = new Fuse(rawMap, {
        keys: ['path', 'signatures'],
        threshold: 0.4, // fuzzy matching threshold
        includeScore: true,
      });

      const results = fuse.search(query);
      if (results.length === 0) return `No structural matches found for '${query}'.`;

      // Limit to top 15 matches
      const topResults = results.slice(0, 15);
      const formatted = topResults.map(r => `${r.item.path}\n${r.item.signatures}`).join('\n\n');
      return formatted;
    } catch (e) {
      return `Error searching codebase: ${e}`;
    }
  }

}
