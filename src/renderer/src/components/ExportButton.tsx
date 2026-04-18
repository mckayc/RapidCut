import { useState } from 'react'
import { useStore } from '../store/useStore'
import { exportXml } from '../api'

export default function ExportButton() {
  const {
    filePath,
    fileName,
    getKeepSegments,
    setStatus,
    status,
    manualToggles,
    manualTimeCuts
  } = useStore()
  const [error, setError] = useState('')
  const isExporting = status === 'exporting'

  async function handleExport() {
    if (!filePath || !fileName) return
    const keepSegments = getKeepSegments()
    if (!keepSegments.length) {
      setError('Nothing to export — all segments would be cut.')
      return
    }

    setStatus('exporting', 'Generating FCPXML…')
    setError('')

    try {
      const sequenceName = fileName.replace(/\.[^.]+$/, '') + ' — RapidCut'
      const { xml } = await exportXml(filePath, keepSegments, sequenceName)

      const sourceDir = filePath.replace(/[/\\][^/\\]+$/, '')
      const defaultName = sourceDir + '/' + fileName.replace(/\.[^.]+$/, '') + '_rapidcut.fcpxml'
      const savePath = await window.electronAPI.showSaveDialog(defaultName)

      if (savePath) {
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
