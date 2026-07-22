import { ChildProcess, spawn } from 'node:child_process';

export interface ProcessOutput {
  pid: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

class BackgroundProcessManager {
  private processes = new Map<number, ChildProcess>();
  private logs = new Map<number, { stdout: string[], stderr: string[] }>();
  private maxLogLines = 1000;

  constructor() {
    process.on('exit', () => this.killAll());
    process.on('SIGINT', () => this.killAll());
    process.on('SIGTERM', () => this.killAll());
  }

  start(command: string, cwd: string): number {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error('Failed to spawn background process.');
    }

    this.processes.set(pid, child);
    this.logs.set(pid, { stdout: [], stderr: [] });

    const appendLog = (stream: 'stdout' | 'stderr', data: Buffer) => {
      const logObj = this.logs.get(pid);
      if (!logObj) return;

      const lines = data.toString().split('\n');
      logObj[stream].push(...lines);

      if (logObj[stream].length > this.maxLogLines) {
        logObj[stream] = logObj[stream].slice(-this.maxLogLines);
      }
    };

    child.stdout?.on('data', (data: Buffer) => appendLog('stdout', data));
    child.stderr?.on('data', (data: Buffer) => appendLog('stderr', data));

    child.on('close', (code) => {
      this.processes.delete(pid);
    });

    return pid;
  }

  readLogs(pid: number, lines: number = 50): string {
    const logObj = this.logs.get(pid);
    if (!logObj) {
      return `Error: No logs found for PID ${pid}. Process may not exist or has been cleared.`;
    }

    const isRunning = this.processes.has(pid);
    const statusStr = isRunning ? 'RUNNING' : 'TERMINATED';

    const outStr = logObj.stdout.slice(-lines).join('\n');
    const errStr = logObj.stderr.slice(-lines).join('\n');

    return `[Status: ${statusStr}]\n-- STDOUT --\n${outStr}\n-- STDERR --\n${errStr}`;
  }

  stop(pid: number): string {
    const child = this.processes.get(pid);
    if (!child) {
      return `Error: Process with PID ${pid} is not currently running.`;
    }
    
    child.kill('SIGTERM');
    this.processes.delete(pid);
    return `Process ${pid} killed successfully.`;
  }

  private killAll() {
    for (const [pid, child] of this.processes.entries()) {
      try {
        child.kill('SIGKILL');
      } catch (e) {
        // Ignore errors during mass shutdown
      }
    }
    this.processes.clear();
  }
}

export const ProcessManager = new BackgroundProcessManager();
