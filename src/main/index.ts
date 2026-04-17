import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const PYTHON_PORT = 8765
let pythonProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

function spawnPythonServer(): void {
  const scriptPath = join(__dirname, '../../python/main.py')
  const pythonBin = process.platform === 'win32' ? 'python' : 'python3'

  pythonProcess = spawn(pythonBin, [scriptPath], {
    stdio: 'pipe',
    env: { ...process.env },
  })

  pythonProcess.stdout?.on('data', (d) => process.stdout.write(`[Python] ${d}`))
  pythonProcess.stderr?.on('data', (d) => process.stderr.write(`[Python] ${d}`))
  pythonProcess.on('exit', (code) => {
    console.log(`[Python] exited with code ${code}`)
    pythonProcess = null
  })
}

async function waitForPython(maxWaitMs = 20000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/health`)
      if (res.ok) return
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Python server failed to start within timeout')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  spawnPythonServer()
  try {
    await waitForPython()
  } catch (err) {
    console.error(err)
    app.quit()
    return
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
})

// IPC: Save dialog
ipcMain.handle('show-save-dialog', async (_, defaultName: string) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'XML Files', extensions: ['xml'] }],
  })
  return result.canceled ? null : result.filePath
})

// IPC: Write file
ipcMain.handle('write-file', (_event, filePath: string, content: string) => {
  writeFileSync(filePath, content, 'utf-8')
})

// IPC: Read file (returns null if not found)
ipcMain.handle('read-file', (_event, filePath: string) => {
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
})

// IPC: Get userData path for persisting custom filler words
ipcMain.handle('get-user-data-path', () => app.getPath('userData'))
