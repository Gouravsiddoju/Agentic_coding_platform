import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from 'fs';
import os from 'os';

function logError(title, error) {
  const errorStr = error ? (error.stack || error.toString()) : 'No stack trace';
  try {
    dialog.showErrorBox(title, errorStr);
  } catch (e) {
    // Ignore
  }
}

process.on('uncaughtException', (err) => {
  logError('UNCAUGHT EXCEPTION in Main Process', err);
});

process.on('unhandledRejection', (reason) => {
  logError('UNHANDLED PROMISE REJECTION in Main Process', reason);
});

let win;
let serverProcess;

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function startServerAndCreateWindow() {
  const devUrl = process.env.ELECTRON_DEV_URL;
  let port = 3001;
  let serverUrl = devUrl;

  if (!devUrl) {
    try {
      port = await findOpenPort();
      
      const serverPath = path.join(__dirname, '../dist-server/server/index.js');
        
      const isPackaged = app.isPackaged;
      const nodeExePath = isPackaged 
        ? path.join(process.resourcesPath, 'node.exe')
        : process.execPath;
        
      const dbPath = path.join(app.getPath('userData'), 'auth.db');
      const logPath = path.join(app.getPath('userData'), 'server.log');
      
      const serverEnv = {
        ...process.env,
        SERVER_PORT: port.toString(),
        PORT: port.toString(),
        DATABASE_PATH: dbPath
      };

      if (isPackaged) {
        const { spawn } = await import('child_process');
        serverProcess = spawn(nodeExePath, [serverPath], {
          env: serverEnv,
          stdio: 'pipe'
        });
      } else {
        serverEnv.ELECTRON_RUN_AS_NODE = '1';
        serverProcess = fork(serverPath, [], {
          env: serverEnv,
          stdio: 'pipe'
        });
      }
      
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      if (serverProcess.stdout) serverProcess.stdout.pipe(logStream);
      if (serverProcess.stderr) serverProcess.stderr.pipe(logStream);
      
      serverProcess.on('error', (err) => {
        logError('Failed to start internal backend', err);
        logStream.write(`Process error: ${err.message}\n`);
      });
      
      serverUrl = `http://localhost:${port}`;
      
      // Wait a moment for the server to bind
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      logError('Failed to allocate port or start server', err);
    }
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'CodeMe',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (serverUrl) {
    win.loadURL(serverUrl).catch(() => {
      const html = `
        <html>
          <body style="font-family: system-ui, sans-serif; padding: 3rem; text-align: center; background: #0f172a; color: white;">
            <h2 style="margin-bottom: 1rem;">CodeMe — Server Not Found</h2>
            <p style="color: #94a3b8; margin-bottom: 2rem;">The internal backend failed to start or load.</p>
            <div style="display: flex; justify-content: center; gap: 0.5rem;">
              <input id="serverUrl" type="text" value="${serverUrl}" style="padding: 0.75rem; width: 300px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: white;" />
              <button onclick="window.location.href = document.getElementById('serverUrl').value" style="padding: 0.75rem 1.5rem; border-radius: 6px; border: none; background: #3b82f6; color: white; cursor: pointer; font-weight: bold;">Retry</button>
            </div>
          </body>
        </html>
      `;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch((err) => {
        console.error('Failed to load fallback UI:', err);
      });
    });
  }

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Electron Console] ${message}`);
  });
  
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[Electron Fail] ${errorDescription}`);
  });

  win.webContents.on('render-process-gone', (event, details) => {
    dialog.showErrorBox('Renderer Process Crashed', `Reason: ${details.reason}, Exit Code: ${details.exitCode}`);
  });

  ipcMain.handle('show-open-dialog', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    return result;
  });
}

app.whenReady().then(startServerAndCreateWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
