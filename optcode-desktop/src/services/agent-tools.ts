/**
 * OPTCode Agent Tools — TypeScript Port
 * Provides file system and command execution tools for the agents.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolDefinition } from './llm-service';

export class AgentTools {

  static getToolDefinitions(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads the content of a file.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The path to the file' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'Lists the files and folders in a directory.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: "The directory path. Use '.' for the current directory." },
            },
            required: ['path'],
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
          name: 'write_file',
          description: 'Writes content to a file. Creates parent directories if needed.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The file path to write to' },
              content: { type: 'string', description: 'The content to write' },
            },
            required: ['path', 'content'],
          },
        },
      },
    ];
  }

  static readFile(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return `Error: File '${filePath}' does not exist.`;
      if (fs.statSync(filePath).isDirectory()) return `Error: '${filePath}' is a directory, not a file.`;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return `Error reading file: ${e}`;
    }
  }

  static listDirectory(dirPath: string): string {
    try {
      if (!fs.existsSync(dirPath)) return `Error: Directory '${dirPath}' does not exist.`;
      if (!fs.statSync(dirPath).isDirectory()) return `Error: '${dirPath}' is a file, not a directory.`;
      const files = fs.readdirSync(dirPath);
      return files.length > 0 ? files.join('\n') : '(Empty directory)';
    } catch (e) {
      return `Error listing directory: ${e}`;
    }
  }

  static runCommand(command: string, cwd?: string): string {
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

  static writeFile(filePath: string, content: string): string {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return `File '${filePath}' written successfully.`;
    } catch (e) {
      return `Error writing file: ${e}`;
    }
  }

  /**
   * Execute a tool call by name and return the result.
   */
  static executeTool(name: string, args: Record<string, string>, cwd?: string): string {
    switch (name) {
      case 'read_file':
        return AgentTools.readFile(args.path ?? '');
      case 'list_directory':
        return AgentTools.listDirectory(args.path ?? '.');
      case 'run_command':
        return AgentTools.runCommand(args.command ?? '', cwd);
      case 'write_file':
        return AgentTools.writeFile(args.path ?? '', args.content ?? '');
      default:
        return `Error: Unknown tool '${name}'`;
    }
  }
}
