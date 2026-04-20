import { useState } from 'react'
import { useStore } from '../store/useStore'
import { exportXml } from '../api'

interface Props {
  onAnalyze?: () => void
}

export default function ExportButton({ onAnalyze }: Props) {
  const {
    filePath,
    fileName,
    getKeepSegments,
    setStatus,
    status,
    templates,
    titles,
    settings,
    getCleanTranscript
  } = useStore()
  const [error, setError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)
  const isExporting = status === 'exporting'

  async function handleExport() {
    if (!filePath || !fileName) return
    const keepSegments = getKeepSegments()
    if (!keepSegments.length) {
      setError('Nothing to export — all segments would be cut.')
      return
    }

    setStatus('exporting', 'Choosing save location…')
    setError('')

    try {
      const sequenceName = fileName.replace(/\.[^.]+$/, '') + ' — RapidCut'
      const sourceDir = filePath.replace(/[/\\][^/\\]+$/, '')
      const defaultName = sourceDir + '/' + fileName.replace(/\.[^.]+$/, '') + '_rapidcut.fcpxml'

      // Ask where to save first so the server can place PNGs next to the output file
      const savePath = await window.electronAPI.showSaveDialog(defaultName)
      if (!savePath) {
        setStatus('ready', '')
        return
      }

      setStatus('exporting', 'Generating FCPXML…')

      const { xml } = await exportXml(
        filePath,
        keepSegments,
        sequenceName,
        { titles, templates, resolution: settings.titleResolution, savePath }
      )

      if (xml) {
        await window.electronAPI.writeFile(savePath, xml)
        setStatus('ready', 'Export saved successfully')
      } else {
        setStatus('ready', '')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('ready', '')
    }
  }

  const handleCopyForAI = () => {
    const transcript = getCleanTranscript()
    const activePrompt = templates[0]?.aiPrompt || ''
    const fullText = `${activePrompt}\n\n${transcript}`
    navigator.clipboard.writeText(fullText)
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
  }

  const keepSegments = getKeepSegments()
  const totalKept = keepSegments.reduce((acc, s) => acc + s.end - s.start, 0)
  const mins = Math.floor(totalKept / 60)
  const secs = Math.round(totalKept % 60)
  const durationLabel = `${mins}m ${secs}s`

  return (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p className="text-red-400 text-xs bg-red-400/10 px-3 py-1.5 rounded-lg max-w-xs text-right">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        {keepSegments.length > 0 && (
          <span className="text-xs text-gray-500">
            {keepSegments.length} segment{keepSegments.length !== 1 ? 's' : ''} · {durationLabel}
          </span>
        )}
        {onAnalyze && (
          <button
            onClick={onAnalyze}
            disabled={isExporting || status === 'transcribing' || status === 'analyzing'}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-blue-400 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 border border-blue-900/30 h-[38px]"
          >
            {status === 'analyzing' || status === 'transcribing' ? '...' : 'Analyze'}
          </button>
        )}
        <button
          onClick={handleCopyForAI}
          disabled={isExporting}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-700 h-[38px]"
        >
          {copyFeedback ? '✓ Copied!' : '📋 Copy for AI'}
        </button>
        <button
          onClick={handleExport}
          disabled={isExporting || !filePath}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg"
        >
          {isExporting ? 'Exporting…' : 'Export FCPXML'}
        </button>
      </div>
    </div>
  )
}
