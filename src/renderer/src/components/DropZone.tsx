import React, { useCallback, useState } from 'react'

interface Props {
  onFiles: (files: Array<{ path: string; name: string }>) => void
}

const ACCEPTED = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mp3', '.wav', '.aac', '.m4a']

export default function DropZone({ onFiles }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const processFiles = useCallback(
    (rawFiles: FileList | File[]) => {
      const valid: Array<{ path: string; name: string }> = []
      const invalid: string[] = []
      for (const file of Array.from(rawFiles)) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (ACCEPTED.includes(ext)) {
          valid.push({ path: window.electronAPI.getFilePath(file), name: file.name })
        } else {
          invalid.push(ext)
        }
      }
      if (invalid.length) {
        setError(`Unsupported format${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`)
      } else {
        setError('')
      }
      if (valid.length) onFiles(valid)
    },
    [onFiles],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      processFiles(e.dataTransfer.files)
    },
    [processFiles],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) processFiles(e.target.files)
      e.target.value = ''
    },
    [processFiles],
  )

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full gap-6 px-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`w-full max-w-lg flex flex-col items-center justify-center gap-4 p-12 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
          dragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-gray-600 bg-gray-800/40 hover:border-gray-500 hover:bg-gray-800/60'
        }`}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div className="text-5xl">🎬</div>
        <div className="text-center">
          <p className="text-gray-200 font-medium text-lg">Drop video or audio files here</p>
          <p className="text-gray-500 text-sm mt-1">or click to browse</p>
        </div>
        <p className="text-gray-600 text-xs text-center">{ACCEPTED.join('  ')}</p>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 px-4 py-2 rounded-lg">{error}</p>
      )}

      <input
        id="file-input"
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  )
}
