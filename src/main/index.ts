import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, delimiter } from 'path'
import { spawn, exec, ChildProcess } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { promisify } from 'util'
import { pathToFileURL } from 'url'

const execAsync = promisify(exec)
const PYTHON_PORT = 8765
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3'
const PIP_BIN = process.platform === 'win32' ? 'pip' : 'pip3'

let pythonProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

// Register media protocol to allow loading local audio/video files
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, stream: true } }
])

// ─── ffmpeg path persistence ───────────────────────────────────────────────
// Stores a known-good ffmpeg bin dir across sessions (survives winget / download).

function ffmpegPathFile(): string {
  return join(app.getPath('userData'), 'ffmpeg-bin-path.txt')
}

function storedFfmpegBin(): string | null {
  try {
    const f = ffmpegPathFile()
    if (!existsSync(f)) return null
    const v = readFileSync(f, 'utf-8').trim()
    return v || null
  } catch {
    return null
  }
}

function storeFfmpegBin(binDir: string): void {
  try {
    writeFileSync(ffmpegPathFile(), binDir, 'utf-8')
  } catch {}
}

// ─── Local downloaded ffmpeg ───────────────────────────────────────────────

function localFfmpegDir(): string {
  return join(app.getPath('userData'), 'ffmpeg')
}

function findLocalFfmpegBin(): string | null {
  const base = localFfmpegDir()
  if (!existsSync(base)) return null
  // Extracted zip: base/<version-folder>/bin/ffmpeg.exe  OR  base/bin/ffmpeg.exe
  for (const entry of readdirSync(base)) {
    const binDir = join(base, entry, 'bin')
    if (existsSync(join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))) {
      return binDir
    }
  }
  const directBin = join(base, 'bin')
  if (existsSync(join(directBin, 'ffmpeg.exe'))) return directBin
  return null
}

/** Build env with every known ffmpeg bin dir prepended to PATH. */
function envWithFfmpeg(): NodeJS.ProcessEnv {
  const dirs = [findLocalFfmpegBin(), storedFfmpegBin()].filter(Boolean) as string[]
  if (!dirs.length) return { ...process.env }
  return { ...process.env, PATH: dirs.join(delimiter) + delimiter + (process.env.PATH ?? '') }
}

// ─── Registry PATH lookup (Windows only) ─────────────────────────────────
// winget modifies the registry PATH but not the current process PATH.
// This queries the registry to find ffmpeg installed in the same session.

async function findFfmpegInRegistryPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const ps = [
    `$m = [System.Environment]::GetEnvironmentVariable('PATH','Machine')`,
    `$u = [System.Environment]::GetEnvironmentVariable('PATH','User')`,
    `$env:PATH = $m + ';' + $u + ';' + $env:PATH`,
    `$c = Get-Command ffmpeg -ErrorAction SilentlyContinue`,
    `if ($c) { Split-Path -Parent $c.Source } else { '' }`,
  ].join('; ')
  try {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 10_000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

// ─── Dependency checks ────────────────────────────────────────────────────

async function checkPython(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execAsync(`${PYTHON_BIN} --version`)
    return { available: true, version: stdout.trim() }
  } catch {
    return { available: false }
  }
}

async function checkFfmpeg(): Promise<{ available: boolean; version?: string }> {
  // 1. Try with known bin dirs already in env
  try {
    const { stdout } = await execAsync('ffmpeg -version', { env: envWithFfmpeg() })
    return { available: true, version: stdout.split('\n')[0].trim() }
  } catch {}

  // 2. Fresh winget install? Check registry PATH (Windows only)
  if (process.platform === 'win32') {
    const registryBin = await findFfmpegInRegistryPath()
    if (registryBin) {
      storeFfmpegBin(registryBin)
      try {
        const env2 = { ...process.env, PATH: `${registryBin}${delimiter}${process.env.PATH}` }
        const { stdout } = await execAsync('ffmpeg -version', { env: env2 })
        return { available: true, version: stdout.split('\n')[0].trim() }
      } catch {}
    }
  }

  return { available: false }
}

// ─── Dependency installation ──────────────────────────────────────────────

async function installPipDeps(): Promise<{ success: boolean; output: string }> {
  const reqPath = join(__dirname, '../../requirements.txt')
  try {
    const { stdout, stderr } = await execAsync(
      `${PIP_BIN} install -r "${reqPath}"`,
      { timeout: 300_000 },
    )
    return { success: true, output: stdout + stderr }
  } catch (err: unknown) {
    return { success: false, output: String((err as { message?: string })?.message ?? err) }
  }
}

async function installFfmpegWindows(): Promise<{ success: boolean; output: string; manual?: string }> {
  // Method 1: winget
  try {
    const { stdout, stderr } = await execAsync(
      'winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements',
      { timeout: 300_000 },
    )
    // winget modifies registry PATH; find and persist the bin dir for this session
    const registryBin = await findFfmpegInRegistryPath()
    if (registryBin) storeFfmpegBin(registryBin)
    return { success: true, output: (stdout + stderr).trim() }
  } catch {
    // winget unavailable or failed — fall through to direct download
  }

  // Method 2: PowerShell download from gyan.dev into userData
  const destDir = localFfmpegDir()
  mkdirSync(destDir, { recursive: true })

  const psLines = [
    `$ProgressPreference = 'SilentlyContinue'`,
    `$ErrorActionPreference = 'Stop'`,
    `$tmp = [System.IO.Path]::GetTempFileName() + '.zip'`,
    `Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $tmp -UseBasicParsing`,
    `Expand-Archive -Path $tmp -DestinationPath '${destDir.replace(/\\/g, '\\\\')}' -Force`,
    `Remove-Item $tmp -Force`,
    `Write-Output 'done'`,
  ]
  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psLines.join('; ')}"`,
      { timeout: 600_000 },
    )
    const binDir = findLocalFfmpegBin()
    if (binDir) {
      return { success: true, output: `ffmpeg installed to: ${binDir}\n${stdout}`.trim() }
    }
    return {
      success: false,
      output: `Download finished but ffmpeg.exe not found.\n${stdout}\n${stderr}`.trim(),
      manual: 'https://ffmpeg.org/download.html#build-windows',
    }
  } catch (err: unknown) {
    return {
      success: false,
      output: String((err as { message?: string })?.message ?? err),
      manual: 'https://ffmpeg.org/download.html#build-windows',
    }
  }
}

async function installFfmpeg(): Promise<{ success: boolean; output: string; manual?: string }> {
  if (process.platform === 'win32') return installFfmpegWindows()

  if (process.platform === 'darwin') {
    try {
      const { stdout, stderr } = await execAsync('brew install ffmpeg', { timeout: 600_000 })
      return { success: true, output: (stdout + stderr).trim() }
    } catch (err: unknown) {
      return {
        success: false,
        output: String((err as { message?: string })?.message ?? err),
        manual: 'https://formulae.brew.sh/formula/ffmpeg',
      }
    }
  }

  return {
    success: false,
    output: 'Automatic install not supported on this platform.',
    manual: 'https://ffmpeg.org/download.html',
  }
}

// ─── Python server ─────────────────────────────────────────────────────────

async function killPortWin(port: number): Promise<void> {
  if (process.platform !== 'win32') return
  const ps = `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
  try {
    await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 8_000 })
  } catch {}
}

async function resolveFfmpegExe(): Promise<string> {
  const env = envWithFfmpeg()
  const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
  try {
    const { stdout } = await execAsync(cmd, { env, timeout: 5_000 })
    const first = stdout.trim().split('\n')[0].trim()
    if (first) return first
  } catch {}
  // Fall back to bare name; Python will raise a clear error if missing
  return 'ffmpeg'
}

async function spawnPythonServer(): Promise<void> {
  const scriptPath = join(__dirname, '../../python/main.py')
  const ffmpegExe = await resolveFfmpegExe()
  console.log(`[Main] Using ffmpeg: ${ffmpegExe}`)
  pythonProcess = spawn(PYTHON_BIN, [scriptPath], {
    stdio: 'pipe',
    env: { ...envWithFfmpeg(), FFMPEG_PATH: ffmpegExe },
  })
  pythonProcess.stdout?.on('data', (d) => process.stdout.write(`[Python] ${d}`))
  pythonProcess.stderr?.on('data', (d) => process.stderr.write(`[Python] ${d}`))
  pythonProcess.on('exit', (code) => {
    console.log(`[Python] exited with code ${code}`)
    pythonProcess = null
  })
}

async function waitForPython(maxWaitMs = 25_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/health`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Python server failed to start within timeout')
}

async function startServer(): Promise<{ success: boolean; error?: string }> {
  // Always kill any existing server (ensures fresh code + correct FFMPEG_PATH env)
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
  await killPortWin(PYTHON_PORT)

  await spawnPythonServer()
  try {
    await waitForPython()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// ─── Window ────────────────────────────────────────────────────────────────

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

// ─── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    // Safely extract the path, handling potential double-slashes from URL joining
    const rawPath = request.url.replace(/^media:\/\/+/, '')
    const decodedPath = decodeURIComponent(rawPath)
    const fileUrl = pathToFileURL(decodedPath).toString()
    return net.fetch(fileUrl)
  })

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

// ─── IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('check-deps', async () => {
  const [python, ffmpeg] = await Promise.all([checkPython(), checkFfmpeg()])
  return { python, ffmpeg }
})

ipcMain.handle('install-pip-deps', async () => installPipDeps())
ipcMain.handle('install-ffmpeg', async () => installFfmpeg())
ipcMain.handle('start-server', async () => startServer())
ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url))

ipcMain.handle('show-save-dialog', async (_, defaultName: string) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'FCPXML Files', extensions: ['fcpxml'] }],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('write-file', (_event, filePath: string, content: string) => {
  writeFileSync(filePath, content, 'utf-8')
})

ipcMain.handle('read-file', (_event, filePath: string) => {
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle('get-user-data-path', () => app.getPath('userData'))
