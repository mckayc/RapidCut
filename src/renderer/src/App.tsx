import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from './store/useStore'
import { probeFile, analyzeFile, exportXml } from './api'
import Header from './components/Header'
import DropZone from './components/DropZone'
import SettingsPanel from './components/SettingsPanel'
import SetupScreen from './components/SetupScreen'

type AppPhase = 'setup' | 'setup-from-main' | 'main'

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('setup')

  const status = useStore((s) => s.status)
  const statusMessage = useStore((s) => s.statusMessage)
  const showTerminal = useStore((s) => s.showTerminal)
  const logs = useStore((s) => s.logs)
  const presets = useStore((s) => s.presets)
  const activePreset = useStore((s) => s.activePreset)

  const setFile = useStore((s) => s.setFile)
  const setDuration = useStore((s) => s.setDuration)
  const setStatus = useStore((s) => s.setStatus)
  const setCutRegions = useStore((s) => s.setCutRegions)
  const addLog = useStore((s) => s.addLog)
  const setShowTerminal = useStore((s) => s.setShowTerminal)

  const [toast, setToast] = useState<string | null>(null)
  const presetsSaveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presetsLoaded = useRef(false)
  const currentFileId = useRef<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const fileQueue = useRef<Array<{ path: string; name: string }>>([])
  const handleFileRef = useRef<((fp: string, fn: string) => Promise<void>) | null>(null)
  const [queueRemaining, setQueueRemaining] = useState(0)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<string>('app-log', (event: { payload: string }) => addLog(event.payload)).then((f: () => void) => { unlisten = f })
    return () => { unlisten?.() }
  }, [])

  useEffect(() => {
    if (showTerminal && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, showTerminal])

  // Load presets from disk on startup
  useEffect(() => {
    ;(async () => {
      try {
        const dataPath = await invoke<string>('get_user_data_path')
        const raw = await invoke<string | null>('read_file', { path: `${dataPath}/presets.json` })
        if (raw) {
          useStore.getState().loadPresetsFromDisk(JSON.parse(raw))
        } else {
          useStore.getState().initDefaultPreset()
        }
      } catch {
        useStore.getState().initDefaultPreset()
      } finally {
        presetsLoaded.current = true
      }
    })()
  }, [])

  // Auto-save presets whenever they change (debounced 500ms)
  useEffect(() => {
    if (!presetsLoaded.current) return
    if (presetsSaveDebounce.current) clearTimeout(presetsSaveDebounce.current)
    presetsSaveDebounce.current = setTimeout(async () => {
      try {
        const dataPath = await invoke<string>('get_user_data_path')
        await invoke('write_file', {
          path: `${dataPath}/presets.json`,
          content: JSON.stringify({ active: activePreset, presets }, null, 2),
        })
      } catch { /* ignore */ }
    }, 500)
  }, [presets, activePreset])

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  const handleFile = useCallback(
    async (fp: string, fn: string) => {
      const fileId = Math.random().toString(36).substring(7)
      currentFileId.current = fileId

      const { settings } = useStore.getState()
      setFile(fp, fn)
      setStatus('analyzing', 'Probing media…')

      let duration = 0
      try {
        const result = await probeFile(fp)
        if (currentFileId.current !== fileId) return
        duration = result.duration
        setDuration(duration)
      } catch (err) {
        if (currentFileId.current !== fileId) return
        setStatus('error', err instanceof Error ? err.message : String(err))
        const next = fileQueue.current.shift()
        setQueueRemaining(fileQueue.current.length)
        if (next) handleFileRef.current?.(next.path, next.name)
        return
      }

      setStatus('analyzing', 'Analyzing…')
      try {
        const analysis = await analyzeFile(fp, settings)
        if (currentFileId.current !== fileId) return
        setCutRegions(analysis.cut_regions)
      } catch (err) {
        if (currentFileId.current !== fileId) return
        setStatus('error', err instanceof Error ? err.message : String(err))
        const next = fileQueue.current.shift()
        setQueueRemaining(fileQueue.current.length)
        if (next) handleFileRef.current?.(next.path, next.name)
        return
      }

      setStatus('exporting', 'Saving…')
      try {
        const keepSegments = useStore.getState().getKeepSegments()
        if (!keepSegments.length) {
          setStatus('error', 'Nothing to export — all segments would be cut.')
          const next = fileQueue.current.shift()
          setQueueRemaining(fileQueue.current.length)
          if (next) handleFileRef.current?.(next.path, next.name)
          return
        }

        const sequenceName = fn.replace(/\.[^.]+$/, '') + ' — RapidCut'
        const { xml } = await exportXml(fp, keepSegments, sequenceName)
        const sourceDir = fp.replace(/[/\\][^/\\]+$/, '')
        const savePath = `${sourceDir}/${fn.replace(/\.[^.]+$/, '')}_rapidcut.fcpxml`
        await invoke('write_file', { path: savePath, content: xml })

        showToast(`Saved: ${fn.replace(/\.[^.]+$/, '')}_rapidcut.fcpxml`)

        const next = fileQueue.current.shift()
        setQueueRemaining(fileQueue.current.length)
        if (next) {
          handleFileRef.current?.(next.path, next.name)
        } else {
          useStore.getState().clearFile()
        }
      } catch (err) {
        if (currentFileId.current !== fileId) return
        setStatus('error', err instanceof Error ? err.message : String(err))
        const next = fileQueue.current.shift()
        setQueueRemaining(fileQueue.current.length)
        if (next) handleFileRef.current?.(next.path, next.name)
      }
    },
    [setFile, setDuration, setStatus, setCutRegions],
  )

  useEffect(() => { handleFileRef.current = handleFile }, [handleFile])

  const handleFiles = useCallback(
    (files: Array<{ path: string; name: string }>) => {
      const [first, ...rest] = files
      fileQueue.current = rest
      setQueueRemaining(rest.length)
      if (first) handleFile(first.path, first.name)
    },
    [handleFile],
  )

  const isLoading = status === 'analyzing' || status === 'exporting'
  const isError = status === 'error'

  const handleReady = useCallback(() => setPhase('main'), [])
  const handleSetup = useCallback(() => setPhase('setup-from-main'), [])

  if (phase === 'setup') return <SetupScreen onReady={handleReady} fromMain={false} />
  if (phase === 'setup-from-main') return <SetupScreen onReady={handleReady} fromMain={true} />

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-gray-200 overflow-hidden">
      <Header onSetup={handleSetup} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 text-gray-200 text-sm px-4 py-2 rounded-lg shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {!isLoading && !isError && (
          <>
            <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto bg-[#1a1d27]">
              <div className="px-4 pt-4 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Settings</span>
              </div>
              <SettingsPanel />
            </aside>
            <DropZone onFiles={handleFiles} />
          </>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center w-full gap-5 px-8">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 text-sm font-medium">{statusMessage || 'Processing…'}</p>
              {queueRemaining > 0 && (
                <p className="text-gray-600 text-xs">{queueRemaining} file{queueRemaining !== 1 ? 's' : ''} queued</p>
              )}
            </div>
            <div className="w-full max-w-xl bg-black/60 border border-gray-800 rounded-lg overflow-hidden font-mono text-[10px]">
              <div className="px-3 py-1.5 bg-gray-800/60 border-b border-gray-800 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-gray-500 uppercase tracking-widest font-bold">Activity</span>
              </div>
              <div className="h-40 overflow-y-auto p-3 text-gray-400 whitespace-pre-wrap flex flex-col-reverse">
                {logs.length === 0 ? (
                  <span className="text-gray-700 italic">Waiting for output…</span>
                ) : (
                  [...logs].reverse().map((log, i) => (
                    <div key={i} className="mb-0.5 border-l border-gray-800 pl-2">{log}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center w-full gap-4 px-8">
            <p className="text-red-400 text-sm bg-red-400/10 px-5 py-3 rounded-xl max-w-md text-center">
              {statusMessage}
            </p>
            <button
              onClick={() => useStore.getState().clearFile()}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Start over
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => setShowTerminal(!showTerminal)}
        className="fixed bottom-4 left-4 z-50 p-2 bg-gray-800 border border-gray-700 rounded-full shadow-lg hover:bg-gray-700 transition-colors"
        title="Toggle Background Logs"
      >
        <svg className={`w-5 h-5 ${showTerminal ? 'text-blue-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {showTerminal && (
        <div className="fixed bottom-16 right-4 w-96 h-64 bg-black/90 border border-gray-700 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden font-mono text-[10px]">
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
            <span className="text-gray-400 font-bold uppercase tracking-widest">Background Logs</span>
            <button onClick={() => setShowTerminal(false)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 whitespace-pre-wrap text-gray-300">
            {logs.length === 0 ? (
              <span className="text-gray-600 italic">No activity logs yet...</span>
            ) : (
              logs.map((log, i) => <div key={i} className="mb-0.5">{log}</div>)
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
