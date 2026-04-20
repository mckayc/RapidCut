import { useCallback, useEffect, useState } from 'react'
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
    return (
      <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
    )
  }
  if (state === 'success' || info?.available) {
    return <span className="text-green-400 text-lg">✓</span>
  }
  if (info !== null && !info.available) {
    return <span className="text-red-400 text-lg">✗</span>
  }
  return <span className="text-gray-600 text-lg">?</span>
}

function DepRow({ name, description, info, installState, installOutput, manualUrl, onInstall }: DepRowProps) {
  const [showOutput, setShowOutput] = useState(false)
  const missing = info !== null && !info.available
  const done = installState === 'success' || info?.available

  return (
    <div className="flex flex-col gap-2 py-4 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <StatusIcon info={info} state={installState} />
          <div className="min-w-0">
            <span className="text-white font-medium text-sm">{name}</span>
            <p className="text-gray-500 text-xs mt-0.5">{description}</p>
            {info?.version && (
              <p className="text-gray-600 text-xs font-mono mt-0.5 truncate">{info.version}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {installState === 'error' && (
            <button
              onClick={() => setShowOutput((s) => !s)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showOutput ? 'Hide log' : 'Show log'}
            </button>
          )}
          {manualUrl && missing && (
            <button
              onClick={() => window.electronAPI.openExternal(manualUrl)}
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
            <span className="text-xs text-green-400 px-2 py-1 bg-green-400/10 rounded">
              Ready
            </span>
          )}
        </div>
      </div>

      {showOutput && installOutput && (
        <pre className="text-xs text-gray-400 bg-gray-900 rounded-md p-3 overflow-x-auto max-h-32 font-mono whitespace-pre-wrap">
          {installOutput}
        </pre>
      )}
    </div>
  )
}

interface Props {
  onReady: () => void
  fromMain?: boolean
}

export default function SetupScreen({ onReady, fromMain = false }: Props) {
  const { setAvailableFonts } = useStore()
  const [deps, setDeps] = useState<DepsStatus | null>(null)
  const [checking, setChecking] = useState(true)

  const [pipState, setPipState] = useState<InstallState>('idle')
  const [pipOutput, setPipOutput] = useState('')

  const [ffmpegState, setFfmpegState] = useState<InstallState>('idle')
  const [ffmpegOutput, setFfmpegOutput] = useState('')
  const [ffmpegManual, setFfmpegManual] = useState<string | undefined>()

  const [serverState, setServerState] = useState<InstallState>('idle')
  const [serverError, setServerError] = useState('')

  const checkDeps = useCallback(async (autoLaunch = false) => {
    setChecking(true)
    try {
      const result = await window.electronAPI.checkDeps()
      setDeps(result)
      
      // Load system fonts once we know environment is ready
      const fonts = await window.electronAPI.getSystemFonts()
      setAvailableFonts(fonts)

      if (autoLaunch && result.python.available && result.ffmpeg.available) {
        // All deps present — launch immediately without user interaction
        setServerState('installing')
        const serverResult = await window.electronAPI.startServer()
        if (serverResult.success) {
          setServerState('success')
          onReady()
        } else {
          setServerState('error')
          setServerError(serverResult.error ?? 'Unknown error')
        }
      }
    } finally {
      setChecking(false)
    }
  }, [onReady])

  useEffect(() => {
    checkDeps(!fromMain) // auto-launch only when opened at startup, not from within the app
  }, [checkDeps])

  const allReady = deps?.python.available && deps?.ffmpeg.available

  async function handleInstallPip() {
    setPipState('installing')
    setPipOutput('')
    const result = await window.electronAPI.installPipDeps()
    setPipState(result.success ? 'success' : 'error')
    setPipOutput(result.output)
    if (result.success) await checkDeps()
  }

  async function handleInstallFfmpeg() {
    setFfmpegState('installing')
    setFfmpegOutput('')
    setFfmpegManual(undefined)
    const result = await window.electronAPI.installFfmpeg()
    setFfmpegState(result.success ? 'success' : 'error')
    setFfmpegOutput(result.output)
    if (result.manual) setFfmpegManual(result.manual)
    if (result.success) {
      await checkDeps()
    }
  }

  async function handleLaunch() {
    setServerState('installing')
    setServerError('')
    const result = await window.electronAPI.startServer()
    if (result.success) {
      // Verify required Python packages are present
      const KNOWN_PACKAGES = ['whisper', 'pydub', 'pillow']
      try {
        const res = await fetch('http://127.0.0.1:8765/setup/check')
        if (res.ok) {
          const pyCheck = (await res.json()) as Record<string, { available: boolean }>
          const missing = KNOWN_PACKAGES.filter(
            (k) => k in pyCheck && pyCheck[k] && !pyCheck[k].available,
          )
          if (missing.length > 0) {
            await handleInstallPip()
            // Don't recurse — if packages are still missing, errors will surface on use
          }
        }
      } catch {
        // Server reachable but check failed — proceed anyway, errors will surface on use
      }
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

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0f1117] px-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-blue-400 font-bold text-2xl tracking-tight mb-1">RapidCut</h1>
          <p className="text-gray-500 text-sm">Checking required dependencies…</p>
        </div>

        {/* Dep list */}
        <div className="bg-[#1a1d27] rounded-xl border border-gray-800 px-5 mb-5">
          <DepRow
            name="Python"
            description="Required to run the transcription engine"
            info={checking ? null : deps?.python ?? { available: false }}
            installState="idle"
            installOutput=""
            manualUrl="https://www.python.org/downloads/"
          />

          <DepRow
            name="Python packages"
            description="whisper, fastapi, pydub and other libraries"
            info={
              checking
                ? null
                : deps?.python.available
                  ? { available: pipState === 'success' || (deps.python.available && pipState === 'idle') }
                  : { available: false }
            }
            installState={pipState}
            installOutput={pipOutput}
            onInstall={deps?.python.available ? handleInstallPip : undefined}
          />

          <DepRow
            name="ffmpeg"
            description={
              isWin
                ? 'Audio/video processor — installed via winget'
                : isMac
                  ? 'Audio/video processor — installed via Homebrew'
                  : 'Audio/video processor'
            }
            info={checking ? null : deps?.ffmpeg ?? { available: false }}
            installState={ffmpegState}
            installOutput={ffmpegOutput}
            manualUrl={ffmpegManual}
            onInstall={!deps?.ffmpeg.available ? handleInstallFfmpeg : undefined}
          />
        </div>

        {/* Server error */}
        {serverState === 'error' && serverError && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs">
            {serverError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {fromMain && (
              <button
                onClick={onReady}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
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
              {serverState === 'installing'
                ? 'Starting…'
                : allReady
                  ? 'Launch RapidCut →'
                  : 'Dependencies required'}
            </button>
          )}
        </div>

        {!deps?.python.available && !checking && (
          <p className="mt-4 text-xs text-gray-600 text-center">
            Python must be installed manually.{' '}
            <button
              onClick={() => window.electronAPI.openExternal('https://www.python.org/downloads/')}
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
