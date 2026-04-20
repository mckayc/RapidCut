import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { transcribeFile, probeFile, analyzeFile, exportXml } from './api'
import type { Word } from './types'
import Header from './components/Header'
import DropZone from './components/DropZone'
import SettingsPanel from './components/SettingsPanel'
import TranscriptEditor from './components/TranscriptEditor'
import FillerWordManager from './components/FillerWordManager'
import ExportButton from './components/ExportButton'
import SetupScreen from './components/SetupScreen'
import ScriptView from './components/ScriptView'
import TitleManager from './components/TitleManager'

const DEBOUNCE_MS = 400

type AppPhase = 'setup' | 'setup-from-main' | 'main'

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('setup')
  const {
    mode,
    status,
    statusMessage,
    settings,
    presets,
    activePreset,
    setFile,
    setStatus,
    setWords,
    setCutRegions,
  } = useStore()

  const [showFillerManager, setShowFillerManager] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const analyzeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presetsSaveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presetsLoaded = useRef(false)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        useStore.getState().undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        useStore.getState().redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Load presets from disk on startup
  useEffect(() => {
    ;(async () => {
      try {
        const dataPath = await window.electronAPI.getUserDataPath()
        const raw = await window.electronAPI.readFile(`${dataPath}/presets.json`)
        if (raw) {
          const data = JSON.parse(raw)
          useStore.getState().loadPresetsFromDisk(data)
        } else {
          // Try migrating legacy filler-words.json
          const legacyRaw = await window.electronAPI.readFile(`${dataPath}/filler-words.json`)
          if (legacyRaw) {
            const parsed = JSON.parse(legacyRaw) as string[]
            useStore.getState().setFillerWords(parsed)
          }
          useStore.getState().initDefaultPreset()
        }
      } catch {
        useStore.getState().initDefaultPreset()
      } finally {
        presetsLoaded.current = true
      }
    })()
  }, [])

  // Persist presets to disk whenever they change (debounced)
  useEffect(() => {
    if (!presetsLoaded.current) return
    if (presetsSaveDebounce.current) clearTimeout(presetsSaveDebounce.current)
    presetsSaveDebounce.current = setTimeout(async () => {
      try {
        const dataPath = await window.electronAPI.getUserDataPath()
        await window.electronAPI.writeFile(
          `${dataPath}/presets.json`,
          JSON.stringify({ active: activePreset, presets }, null, 2),
        )
      } catch {
        // ignore
      }
    }, 500)
  }, [presets, activePreset])

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  const runAnalyze = useCallback(async () => {
    const { filePath: fp, words } = useStore.getState()
    if (!fp) return
    setStatus('analyzing', 'Analyzing…')
    try {
      const result = await analyzeFile(words, fp, settings)
      setCutRegions(result.cut_regions)
      setStatus('ready', '')
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }, [settings.processingMode, settings.removeNoSpeech, settings.silenceThresholdDb, settings.preCutPaddingMs, settings.postCutPaddingMs, settings.minSilenceDurationMs])

  // Re-analyze via Python only when silence-detection settings change.
  // Filler words and repeated phrase detection are handled purely in the frontend store.
  const pythonAnalysisKey = [
    settings.processingMode,
    settings.removeNoSpeech,
    settings.silenceThresholdDb,
    settings.preCutPaddingMs,
    settings.postCutPaddingMs,
    settings.minSilenceDurationMs,
  ].join('|')

  useEffect(() => {
    if (status !== 'ready' && status !== 'analyzing') return
    const { filePath: fp } = useStore.getState()
    if (!fp) return
    if (analyzeDebounce.current) clearTimeout(analyzeDebounce.current)
    analyzeDebounce.current = setTimeout(runAnalyze, DEBOUNCE_MS)
    return () => {
      if (analyzeDebounce.current) clearTimeout(analyzeDebounce.current)
    }
  }, [pythonAnalysisKey])

  const handleFile = useCallback(
    async (fp: string, fn: string) => {
      setFile(fp, fn)

      let words: { word: string; start: number; end: number }[] = []
      let duration = 0

      if (settings.processingMode === 'speech') {
        setStatus('transcribing', 'Transcribing audio…')
        const t0 = Date.now()
        try {
          const result = await transcribeFile(fp, settings.whisperModel)
          useStore.getState().setTranscribeDuration((Date.now() - t0) / 1000)
          words = result.words as Word[]
          duration = result.duration
          setWords(words, duration, result.audio_path)
        } catch (err) {
          setStatus('error', err instanceof Error ? err.message : String(err))
          return
        }
      } else {
        setStatus('analyzing', 'Probing media…')
        try {
          const result = await probeFile(fp)
          duration = result.duration
          setWords([], duration)
        } catch (err) {
          setStatus('error', err instanceof Error ? err.message : String(err))
          return
        }
      }

      setStatus('analyzing', 'Analyzing…')
      try {
        const analysis = await analyzeFile(words, fp, settings)
        setCutRegions(analysis.cut_regions)

        if (mode === 'auto') {
          setStatus('exporting', 'Saving…')
          const keepSegments = useStore.getState().getKeepSegments()
          if (!keepSegments.length) {
            setStatus('error', 'Nothing to export — all segments would be cut.')
            return
          }
          const sequenceName = fn.replace(/\.[^.]+$/, '') + ' — RapidCut'
          const { xml } = await exportXml(fp, keepSegments, sequenceName)
          const sourceDir = fp.replace(/[/\\][^/\\]+$/, '')
          const savePath = `${sourceDir}/${fn.replace(/\.[^.]+$/, '')}_rapidcut.fcpxml`
          await window.electronAPI.writeFile(savePath, xml)
          useStore.getState().clearFile()
          showToast(`Saved: ${fn.replace(/\.[^.]+$/, '')}_rapidcut.fcpxml`)
        } else {
          setStatus('ready', '')
        }
      } catch (err) {
        setStatus('error', err instanceof Error ? err.message : String(err))
      }
    },
    [mode, settings],
  )

  const isIdle = status === 'idle'
  const isLoading = status === 'transcribing' || status === 'analyzing'
  const isReady = status === 'ready'
  const view = useStore((s) => s.view)
  const isError = status === 'error'

  const handleReady = useCallback(() => setPhase('main'), [])
  const handleSetup = useCallback(() => setPhase('setup-from-main'), [])

  if (phase === 'setup') {
    return <SetupScreen onReady={handleReady} fromMain={false} />
  }

  if (phase === 'setup-from-main') {
    return <SetupScreen onReady={handleReady} fromMain={true} />
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-gray-200 overflow-hidden">
      <Header onSetup={handleSetup} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 text-gray-200 text-sm px-4 py-2 rounded-lg shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Idle: settings sidebar + drop zone */}
        {isIdle && (
          <>
            <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto bg-[#1a1d27]">
              <div className="px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Settings
                </span>
              </div>
              <SettingsPanel
                showModelSelector={settings.processingMode === 'speech'}
                onOpenFillerManager={() => setShowFillerManager(true)}
              />
            </aside>
            <DropZone onFile={handleFile} />
          </>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center w-full gap-4">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">{statusMessage || 'Processing…'}</p>
          </div>
        )}

        {/* Error state */}
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

        {/* Ready state */}
        {isReady && (
          <>
            <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto bg-[#1a1d27]">
              <div className="px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Settings
                </span>
              </div>
              <SettingsPanel
                showModelSelector={settings.processingMode === 'speech'}
                onOpenFillerManager={() => setShowFillerManager(true)}
              />
            </aside>

            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {view === 'edit' ? (
                <TranscriptEditor />
              ) : view === 'script' ? (
                <ScriptView />
              ) : (
                <TitleManager />
              )}

              {/* Sticky export bar */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-[#0f1117] flex-shrink-0">
                {statusMessage ? (
                  <p className="text-xs text-gray-500">{statusMessage}</p>
                ) : (
                  <span />
                )}
                <ExportButton />
              </div>
            </div>
          </>
        )}
      </div>

      {showFillerManager && <FillerWordManager onClose={() => setShowFillerManager(false)} />}
    </div>
  )
}
