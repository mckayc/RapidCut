import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '../store/useStore'
import type { DepInfo, DepsStatus } from '../types'

type InstallState = 'idle' | 'installing' | 'success' | 'error'

interface DepRowProps {
  name: string
  description: string
  info: DepInfo | null
  installState: InstallState
  installOutput: string
  manualUrl?: string
  onInstall?: () => void
}

function StatusIcon({ info, state }: { info: DepInfo | null; state: InstallState }) {
  if (state === 'installing') {
    return <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
  }
  if (info?.available) return <span className="text-green-400 text-lg">✓</span>
  if (info !== null && !info.available) return <span className="text-red-400 text-lg">✗</span>
  return <span className="text-gray-600 text-lg">?</span>
}

function DepRow({ name, description, info, installState, installOutput, manualUrl, onInstall }: DepRowProps) {
  const [showOutput, setShowOutput] = useState(false)
  const missing = info !== null && !info.available
  const done = info?.available

  return (
    <div className="flex flex-col gap-2 py-4 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <StatusIcon info={info} state={installState} />
          <div className="min-w-0">
            <span className="text-white font-medium text-sm">{name}</span>
            <p className="text-gray-500 text-xs mt-0.5">{description}</p>
            {info?.version && <p className="text-gray-600 text-xs font-mono mt-0.5 truncate">{info.version}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {installState === 'error' && (
            <button onClick={() => setShowOutput((s) => !s)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              {showOutput ? 'Hide log' : 'Show log'}
            </button>
          )}
          {manualUrl && missing && (
            <button
              onClick={() => invoke('open_external', { url: manualUrl })}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded border border-blue-400/30 hover:border-blue-300/50"
            >
              Manual
            </button>
          )}
          {onInstall && missing && !done && (
            <button
              onClick={onInstall}
              disabled={installState === 'installing'}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-colors"
            >
              {installState === 'installing' ? 'Installing…' : 'Install'}
            </button>
          )}
          {done && installState !== 'installing' && (
            <span className="text-xs text-green-400 px-2 py-1 bg-green-400/10 rounded">Ready</span>
          )}
        </div>
      </div>
      {showOutput && installOutput && (
        <pre className="text-xs text-gray-400 bg-gray-900 rounded-md p-3 overflow-x-auto max-h-32 font-mono whitespace-pre-wrap">{installOutput}</pre>
      )}
    </div>
  )
}

interface Props {
  onReady: () => void
  fromMain?: boolean
}

export default function SetupScreen({ onReady, fromMain = false }: Props) {
  const { logs } = useStore()
  const [deps, setDeps] = useState<DepsStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [pythonState, setPythonState] = useState<InstallState>('idle')
  const [pythonOutput, setPythonOutput] = useState('')
  const [pythonManual, setPythonManual] = useState<string | undefined>()
  const [pipState, setPipState] = useState<InstallState>('idle')
  const [pipOutput, setPipOutput] = useState('')
  const [ffmpegState, setFfmpegState] = useState<InstallState>('idle')
  const [ffmpegOutput, setFfmpegOutput] = useState('')
  const [ffmpegManual, setFfmpegManual] = useState<string | undefined>()
  const [serverState, setServerState] = useState<InstallState>('idle')
  const [serverError, setServerError] = useState('')
  const [autoInstalling, setAutoInstalling] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const isWorking = pythonState === 'installing' || pipState === 'installing' || ffmpegState === 'installing' || serverState === 'installing' || autoInstalling

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const autoInstallDeps = useCallback(async (depsStatus: DepsStatus) => {
    setAutoInstalling(true)
    try {
      let current = depsStatus

      // Auto-install Python if missing (this can take a while - it's a real installer download)
      if (!current.python?.available) {
        setPythonState('installing')
        const result = await invoke<{ success: boolean; output: string; manual?: string }>('install_python')
        setPythonState(result.success ? 'success' : 'error')
        setPythonOutput(result.output)
        if (result.manual) setPythonManual(result.manual)
        current = await invoke<DepsStatus>('check_deps')
        setDeps(current)
      }

      // Auto-install ffmpeg if missing
      if (!current.ffmpeg?.available) {
        setFfmpegState('installing')
        const result = await invoke<{ success: boolean; output: string; manual?: string }>('install_ffmpeg')
        setFfmpegState(result.success ? 'success' : 'error')
        setFfmpegOutput(result.output)
        if (result.manual) setFfmpegManual(result.manual)
      }

      // Auto-install pip packages if Python is available
      if (current.python?.available && !current.silero_vad?.available) {
        setPipState('installing')
        const result = await invoke<{ success: boolean; output: string }>('install_pip_deps')
        setPipState(result.success ? 'success' : 'error')
        setPipOutput(result.output)
      }

      // Re-check dependencies after auto-install attempts
      await new Promise(r => setTimeout(r, 500))
      const updatedDeps = await invoke<DepsStatus>('check_deps')
      setDeps(updatedDeps)

      // If all deps are now available, start the server
      if (updatedDeps?.python?.available && updatedDeps?.ffmpeg?.available && updatedDeps?.silero_vad?.available) {
        setServerState('installing')
        const serverResult = await invoke<{ success: boolean; error?: string }>('start_server')
        if (serverResult.success) {
          try { await invoke('set_deps_verified') } catch { /* non-fatal */ }
          setServerState('success')
          onReady()
        } else {
          setServerState('error')
          setServerError(serverResult.error ?? 'Unknown error')
        }
      }
    } finally {
      setAutoInstalling(false)
    }
  }, [onReady])

  const checkDeps = useCallback(async (autoLaunch = false) => {
    setChecking(true)
    try {
      const result = await invoke<DepsStatus>('check_deps')
      setDeps(result)
      if (autoLaunch && result?.python?.available && result?.ffmpeg?.available && result?.silero_vad?.available) {
        setServerState('installing')
        const serverResult = await invoke<{ success: boolean; error?: string }>('start_server')
        if (serverResult.success) {
          try { await invoke('set_deps_verified') } catch { /* non-fatal */ }
          setServerState('success')
          onReady()
        } else {
          setServerState('error')
          setServerError(serverResult.error ?? 'Unknown error')
        }
      } else if (autoLaunch && result) {
        // Some deps are missing - attempt to auto-install everything we can
        await autoInstallDeps(result)
      }
    } finally {
      setChecking(false)
    }
  }, [onReady, autoInstallDeps])

  useEffect(() => {
    if (fromMain) {
      checkDeps(false)
      return
    }
    ;(async () => {
      const verified = await invoke<boolean>('get_deps_verified')
      if (verified) {
        setChecking(false)
        setServerState('installing')
        const result = await invoke<{ success: boolean; error?: string }>('start_server')
        if (result.success) {
          setServerState('success')
          onReady()
        } else {
          await invoke('clear_deps_verified')
          setServerState('idle')
          setServerError('')
          checkDeps(false)
        }
      } else {
        checkDeps(true)
      }
    })()
  }, [])

  // Wire up app-log events from Rust to the store
  useEffect(() => {
    const addLog = useStore.getState().addLog
    let unlisten: (() => void) | null = null
    listen<string>('app-log', (event: { payload: string }) => addLog(event.payload)).then((f: () => void) => { unlisten = f })
    return () => { unlisten?.() }
  }, [])

  const allReady = !!(deps?.python?.available && deps?.ffmpeg?.available && deps?.silero_vad?.available)

  async function handleInstallPython() {
    setPythonState('installing')
    setPythonOutput('')
    setPythonManual(undefined)
    const result = await invoke<{ success: boolean; output: string; manual?: string }>('install_python')
    setPythonState(result.success ? 'success' : 'error')
    setPythonOutput(result.output)
    if (result.manual) setPythonManual(result.manual)
    if (result.success) await checkDeps()
  }

  async function handleInstallPip() {
    setPipState('installing')
    setPipOutput('')
    const result = await invoke<{ success: boolean; output: string }>('install_pip_deps')
    setPipState(result.success ? 'success' : 'error')
    setPipOutput(result.output)
    if (result.success) await checkDeps()
  }

  async function handleInstallFfmpeg() {
    setFfmpegState('installing')
    setFfmpegOutput('')
    setFfmpegManual(undefined)
    const result = await invoke<{ success: boolean; output: string; manual?: string }>('install_ffmpeg')
    setFfmpegState(result.success ? 'success' : 'error')
    setFfmpegOutput(result.output)
    if (result.manual) setFfmpegManual(result.manual)
    if (result.success) await checkDeps()
  }

  async function handleLaunch() {
    setServerState('installing')
    setServerError('')
    const result = await invoke<{ success: boolean; error?: string }>('start_server')
    if (result.success) {
      try { await invoke('set_deps_verified') } catch { /* non-fatal */ }
      setServerState('success')
      onReady()
    } else {
      setServerState('error')
      setServerError(result.error ?? 'Unknown error')
    }
  }

  const platform = navigator.platform.toLowerCase()
  const isWin = platform.includes('win')
  const isMac = platform.includes('mac')

  if (serverState === 'installing' && !deps && !checking) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0f1117] gap-4 px-8">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Starting RapidCut…</p>
        <div className="w-full max-w-lg bg-black/50 border border-gray-800 rounded-lg flex flex-col overflow-hidden font-mono text-[10px]" style={{ height: '180px' }}>
          <div className="px-3 py-1.5 bg-gray-800/50 border-b border-gray-800 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-gray-500 uppercase tracking-widest font-bold">Activity</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-gray-400 whitespace-pre-wrap flex flex-col-reverse">
            {logs.length === 0 ? (
              <span className="text-gray-700 italic">Waiting for Python server…</span>
            ) : (
              [...logs].reverse().map((log, i) => (
                <div key={i} className="mb-0.5 border-l border-gray-800 pl-2">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0f1117] px-8">
      <div className="w-full max-w-lg flex flex-col h-full max-h-[85vh]">
        <div className="mb-8 text-center">
          <h1 className="text-blue-400 font-bold text-2xl tracking-tight mb-1">RapidCut</h1>
          <p className="text-gray-500 text-sm">Checking required dependencies…</p>
        </div>

        <div className="bg-[#1a1d27] rounded-xl border border-gray-800 px-5 mb-5">
          <DepRow
            name="Python"
            description="Required to run the analysis engine"
            info={checking ? null : deps?.python ?? { available: false }}
            installState={pythonState}
            installOutput={pythonOutput}
            manualUrl={pythonManual}
            onInstall={!deps?.python?.available ? handleInstallPython : undefined}
          />
          <DepRow
            name="Python packages"
            description="pydub, fastapi, uvicorn, silero-vad"
            info={
              checking ? null
                : deps?.python?.available
                  ? { available: pipState === 'success' || pipState === 'idle' }
                  : { available: false }
            }
            installState={pipState}
            installOutput={pipOutput}
            onInstall={deps?.python?.available ? handleInstallPip : undefined}
          />
          <DepRow
            name="Silero VAD"
            description="Voice Activity Detection engine"
            info={
              checking ? null
                : deps?.python?.available && deps?.silero_vad?.available
                  ? { available: true, version: deps.silero_vad.version }
                  : { available: false }
            }
            installState={pipState}
            installOutput={pipOutput}
            onInstall={deps?.python?.available && !deps?.silero_vad?.available ? handleInstallPip : undefined}
          />
          <DepRow
            name="ffmpeg"
            description={
              isWin ? 'Audio/video processor — installed via winget'
                : isMac ? 'Audio/video processor — installed via Homebrew'
                  : 'Audio/video processor'
            }
            info={checking ? null : deps?.ffmpeg ?? { available: false }}
            installState={ffmpegState}
            installOutput={ffmpegOutput}
            manualUrl={ffmpegManual}
            onInstall={!deps?.ffmpeg?.available ? handleInstallFfmpeg : undefined}
          />
        </div>

        <div className="flex-1 min-h-[150px] mb-5 bg-black/50 border border-gray-800 rounded-lg flex flex-col overflow-hidden font-mono text-[10px]">
          <div className="px-3 py-1.5 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
            <span className="text-gray-500 uppercase tracking-widest font-bold">Activity Logs</span>
            {(checking || isWorking) && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-gray-400 whitespace-pre-wrap">
            {logs.length === 0 ? (
              <span className="text-gray-700 italic">{checking ? 'Setting up environment…' : 'No activity yet.'}</span>
            ) : (
              logs.map((log, i) => <div key={i} className="mb-0.5 border-l border-gray-800 pl-2">{log}</div>)
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {serverState === 'error' && serverError && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs">
            {serverError}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {fromMain && (
              <button onClick={onReady} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                ← Back
              </button>
            )}
            <button
              onClick={() => checkDeps(false)}
              disabled={checking}
              className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40 transition-colors"
            >
              {checking ? 'Checking…' : '↺ Re-check'}
            </button>
          </div>

          {!fromMain && (
            <button
              onClick={handleLaunch}
              disabled={!allReady || serverState === 'installing'}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg"
            >
              {serverState === 'installing' ? 'Starting…' : allReady ? 'Launch RapidCut →' : 'Dependencies required'}
            </button>
          )}
        </div>

        {deps && !deps.python?.available && !checking && pythonManual && (
          <p className="mt-4 text-xs text-gray-600 text-center">
            Automatic Python install failed — install it manually.{' '}
            <button
              onClick={() => invoke('open_external', { url: pythonManual })}
              className="text-blue-400 hover:underline"
            >
              Download Python
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
