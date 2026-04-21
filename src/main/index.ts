import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, delimiter } from 'path'
import { spawn, exec, ChildProcess } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { promisify } from 'util'
import { pathToFileURL } from 'url'

const execAsync = promisify(exec)
const PYTHON_PORT = 8765
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3'

let pythonProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

// Cache for dependency status to speed up load times. Includes faster_whisper.
let cachedDeps: { python: any; ffmpeg: any; whisperx: any; silero_vad: any; faster_whisper: any } | null = null

// Resolves after venv is created and packages are installed (or failed)
let venvInitPromise: Promise<void> | null = null

// ─── Python 3.12 virtual environment ──────────────────────────────────────

function getVenvDir(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'python-venv')
    : join(__dirname, '../../python/venv')
}

function getVenvPython(): string {
  const base = getVenvDir()
  return process.platform === 'win32'
    ? join(base, 'Scripts', 'python.exe')
    : join(base, 'bin', 'python3')
}

function getVenvPip(): string {
  const base = getVenvDir()
  return process.platform === 'win32'
    ? join(base, 'Scripts', 'pip.exe')
    : join(base, 'bin', 'pip3')
}

async function ensureVenv(): Promise<void> {
  const venvPython = getVenvPython()
  if (existsSync(venvPython)) return

  mainWindow?.webContents.send('app-log', '[Main] Creating Python 3.12 virtual environment...')
  const py3 = process.platform === 'win32' ? 'py -3.12' : 'python3.12'
  await execAsync(`${py3} -m venv "${getVenvDir()}"`, { timeout: 60_000 })
  mainWindow?.webContents.send('app-log', '[Main] Virtual environment created. Installing packages...')

  const result = await installPipDeps()
  if (!result.success) {
    mainWindow?.webContents.send('app-log', '[Main] Package installation failed. Use the Install button to retry.')
  }
}

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

async function checkFasterWhisper(): Promise<{ available: boolean }> {
  const venvPython = getVenvPython()
  if (!existsSync(venvPython)) return { available: false }
  try {
    await execAsync(`"${venvPython}" -c "from faster_whisper import WhisperModel"`, { timeout: 15_000 })
    return { available: true }
  } catch {
    return { available: false }
  }
}

async function checkWhisperX(): Promise<{ available: boolean }> {
  const venvPython = getVenvPython()
  if (!existsSync(venvPython)) return { available: false }
  try {
    await execAsync(`"${venvPython}" -c "import whisperx"`, { timeout: 15_000 })
    return { available: true }
  } catch {
    return { available: false }
  }
}

async function checkSileroVad(): Promise<{ available: boolean }> {
  const venvPython = getVenvPython()
  if (!existsSync(venvPython)) return { available: false }
  try {
    await execAsync(`"${venvPython}" -c "from silero_vad import load_silero_vad"`, { timeout: 15_000 })
    return { available: true }
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
  const reqPath = app.isPackaged
    ? join(process.resourcesPath, 'requirements.txt')
    : join(__dirname, '../../requirements.txt')
  const pip = getVenvPip()

  return new Promise((resolve) => {
    const child = spawn(`"${pip}" install --no-compile -r "${reqPath}"`, [], {
      shell: process.platform === 'win32'
    })
    let output = ''

    child.stdout.on('data', (data) => {
      const str = data.toString()
      output += str
      mainWindow?.webContents.send('app-log', str)
    })
    child.stderr.on('data', (data) => {
      const str = data.toString()
      output += str
      mainWindow?.webContents.send('app-log', `[ERR] ${str}`)
    })

    child.on('error', (err) => {
      resolve({ success: false, output: err.message })
    })

    child.on('close', (code) => {
      resolve({ success: code === 0, output })
    })
  })
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
  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'python/main.py')
    : join(__dirname, '../../python/main.py')
  const ffmpegExe = await resolveFfmpegExe()
  const venvPython = getVenvPython()
  mainWindow?.webContents.send('app-log', `[Main] Using ffmpeg: ${ffmpegExe}`)
  pythonProcess = spawn(`"${venvPython}" "${scriptPath}"`, [], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...envWithFfmpeg(), FFMPEG_PATH: ffmpegExe },
  })
  pythonProcess.stdout?.on('data', (d) => mainWindow?.webContents.send('app-log', d.toString()))
  pythonProcess.stderr?.on('data', (d) => mainWindow?.webContents.send('app-log', `[PY-ERR] ${d.toString()}`))
  pythonProcess.on('exit', (code) => {
    const msg = `[Python] Process exited with code ${code}`
    console.log(msg)
    mainWindow?.webContents.send('app-log', `[FATAL] ${msg}`)
    pythonProcess = null
  })
}

async function waitForPython(maxWaitMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  let attempts = 0
  while (Date.now() < deadline) {
    try {
      attempts++
      if (attempts % 10 === 0) {
        mainWindow?.webContents.send('app-log', `[Main] Connection attempt ${attempts} to http://127.0.0.1:${PYTHON_PORT}...`)
      }
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

  // Note: installPipDeps is now handled by the SetupScreen and doesn't run on every launch,
  // which significantly speeds up the startup time.
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
    try {
      const url = new URL(request.url)
      const decodedPath = decodeURIComponent(url.searchParams.get('path') || '')
      if (!decodedPath) throw new Error('No path provided to media protocol')
      
      const fileUrl = pathToFileURL(decodedPath).toString()
      return net.fetch(fileUrl, { headers: request.headers })
    } catch (err) {
      console.error(`[Main] Media protocol error: ${err}`)
      return new Response('Invalid Path', { status: 400 })
    }
  })

  createWindow()

  // Ensure venv exists and packages are installed, then cache dep results.
  // check-deps IPC awaits this before returning so the UI always sees final state.
  venvInitPromise = ensureVenv()
    .then(async () => {
      const [p, f, w, v, fw] = await Promise.all([
        checkPython(),
        checkFfmpeg(),
        checkWhisperX(),
        checkSileroVad(),
        checkFasterWhisper()
      ])
      cachedDeps = { python: p, ffmpeg: f, whisperx: w, silero_vad: v, faster_whisper: fw }
    })
    .catch((err: unknown) => {
      mainWindow?.webContents.send('app-log', `[Main] Auto-setup error: ${err}`)
    })
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
  // Wait for venv init (no-op if already resolved)
  if (venvInitPromise) await venvInitPromise
  if (cachedDeps) return cachedDeps

  const [python, ffmpeg, whisperx, silero_vad, faster_whisper] = await Promise.all([
    checkPython(),
    checkFfmpeg(),
    checkWhisperX(),
    checkSileroVad(),
    checkFasterWhisper()
  ])
  cachedDeps = { python, ffmpeg, whisperx, silero_vad, faster_whisper }
  return cachedDeps
})

ipcMain.handle('install-pip-deps', async () => {
  // Ensure venv exists before installing (handles manual retry after first-run failure)
  await ensureVenv().catch(() => {})
  const res = await installPipDeps()
  if (res.success) cachedDeps = null
  return res
})
ipcMain.handle('install-ffmpeg', async () => {
  const res = await installFfmpeg()
  if (res.success) cachedDeps = null // Force re-check after install
  return res
})
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

ipcMain.handle('get-system-fonts', async () => {
  const fonts: Array<{ name: string; path: string }> = []
  if (process.platform === 'win32') {
    const fontDir = 'C:\\Windows\\Fonts'
    if (existsSync(fontDir)) {
      const files = readdirSync(fontDir)
      for (const file of files) {
        const lower = file.toLowerCase()
        if (lower.endsWith('.ttf') || lower.endsWith('.otf')) {
          fonts.push({ 
            name: file.replace(/\.(ttf|otf)$/i, ''), 
            path: join(fontDir, file) 
          })
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const dirs = ['/Library/Fonts', '/System/Library/Fonts', join(app.getPath('home'), 'Library/Fonts')]
    for (const dir of dirs) {
      if (existsSync(dir)) {
        const files = readdirSync(dir)
        for (const file of files) {
          const lower = file.toLowerCase()
          if (lower.endsWith('.ttf') || lower.endsWith('.otf')) {
            fonts.push({ 
              name: file.replace(/\.(ttf|otf)$/i, ''), 
              path: join(dir, file) 
            })
          }
        }
      }
    }
  }
  return fonts.sort((a, b) => a.name.localeCompare(b.name))
})
