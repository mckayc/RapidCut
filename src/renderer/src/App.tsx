import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { transcribeFile, analyzeFile } from './api'
import Header from './components/Header'
import DropZone from './components/DropZone'
import SettingsPanel from './components/SettingsPanel'
import TranscriptEditor from './components/TranscriptEditor'
import FillerWordManager from './components/FillerWordManager'
import ExportButton from './components/ExportButton'

const DEBOUNCE_MS = 400

export default function App() {
  const {
    mode,
    filePath,
    fileName,
    status,
    statusMessage,
    words,
    settings,
    fillerWords,
    setFile,
    setStatus,
    setWords,
    setCutRegions,
  } = useStore()

  const [showFillerManager, setShowFillerManager] = useState(false)
  const analyzeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Load persisted filler words on startup
  useEffect(() => {
    ;(async () => {
      try {
        const dataPath = await window.electronAPI.getUserDataPath()
        const raw = await window.electronAPI.readFile(`${dataPath}/filler-words.json`)
        if (raw) {
          const parsed = JSON.parse(raw) as string[]
          useStore.getState().setFillerWords(parsed)
        }
      } catch {
        // ignore — use defaults
      }
    })()
  }, [])

  // Persist filler words when they change
  useEffect(() => {
    ;(async () => {
      try {
        const dataPath = await window.electronAPI.getUserDataPath()
        await window.electronAPI.writeFile(
          `${dataPath}/filler-words.json`,
          JSON.stringify(fillerWords),
        )
      } catch {
        // ignore
      }
    })()
  }, [fillerWords])

  const runAnalyze = useCallback(async () => {
    if (!filePath || !words.length) return
    setStatus('analyzing', 'Analyzing…')
    try {
      const result = await analyzeFile(words, filePath, settings, fillerWords)
      setCutRegions(result.cut_regions)
      setStatus('ready', '')
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }, [filePath, words, settings, fillerWords])

  // Re-analyze when settings or filler words change (debounced)
  useEffect(() => {
    if (status !== 'ready' && status !== 'analyzing') return
    if (!words.length) return
    if (analyzeDebounce.current) clearTimeout(analyzeDebounce.current)
    analyzeDebounce.current = setTimeout(runAnalyze, DEBOUNCE_MS)
    return () => {
      if (analyzeDebounce.current) clearTimeout(analyzeDebounce.current)
    }
  }, [settings, fillerWords])

  const handleFile = useCallback(
    async (fp: string, fn: string) => {
      setFile(fp, fn)
      setStatus('transcribing', 'Transcribing audio…')
      try {
        const result = await transcribeFile(fp, settings.whisperModel)
        setWords(result.words, result.duration)
        setStatus('analyzing', 'Analyzing…')
        const analysis = await analyzeFile(result.words, fp, settings, fillerWords)
        setCutRegions(analysis.cut_regions)
        setStatus('ready', '')
      } catch (err) {
        setStatus('error', err instanceof Error ? err.message : String(err))
      }
    },
    [settings, fillerWords],
  )

  const isIdle = status === 'idle'
  const isLoading = status === 'transcribing' || status === 'analyzing'
  const isReady = status === 'ready'
  const isError = status === 'error'

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-gray-200 overflow-hidden">
      <Header />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Drop zone when idle */}
        {isIdle && <DropZone onFile={handleFile} />}

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center w-full gap-4">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">{statusMessage || 'Processing…'}</p>
            <p className="text-gray-600 text-xs">{fileName}</p>
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
            {/* Settings sidebar */}
            <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto bg-[#1a1d27]">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Settings
                </span>
                <button
                  onClick={() => setShowFillerManager(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Edit filler words
                </button>
              </div>
              <SettingsPanel onSettingsChange={runAnalyze} />
            </aside>

            {/* Main panel */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {mode === 'edit' ? (
                <TranscriptEditor />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                  <p className="text-gray-300 font-medium">Auto mode</p>
                  <p className="text-gray-500 text-sm max-w-sm">
                    Your file has been analyzed. Configure settings on the left, then export the
                    XML when ready.
                  </p>
                  <p className="text-gray-600 text-xs">{fileName}</p>
                </div>
              )}

              {/* Export bar */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-[#0f1117]">
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

      {/* Filler word manager modal */}
      {showFillerManager && <FillerWordManager onClose={() => setShowFillerManager(false)} />}
    </div>
  )
}
