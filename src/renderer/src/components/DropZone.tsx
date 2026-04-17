import React, { useCallback, useState } from 'react'

interface Props {
  onFile: (filePath: string, fileName: string) => void
}

const ACCEPTED = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mp3', '.wav', '.aac', '.m4a']

export default function DropZone({ onFile }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const handleFile = useCallback(
    (file: File) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      if (!ACCEPTED.includes(ext)) {
        setError(`Unsupported format: ${ext}. Accepted: ${ACCEPTED.join(', ')}`)
        return
      }
      setError('')
      const filePath = window.electronAPI.getFilePath(file)
      onFile(filePath, file.name)
    },
    [onFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ''
    },
    [handleFile],
  )

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
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
          <p className="text-gray-200 font-medium text-lg">Drop your video or audio file here</p>
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
