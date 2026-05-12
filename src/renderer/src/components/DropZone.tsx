import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DragDropEvent } from '@tauri-apps/api/webview'

interface Props {
  onFiles: (files: Array<{ path: string; name: string }>) => void
}

const ACCEPTED = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mp3', '.wav', '.aac', '.m4a']

function nameFromPath(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

function isAccepted(name: string): boolean {
  return ACCEPTED.includes('.' + name.split('.').pop()?.toLowerCase())
}

export default function DropZone({ onFiles }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cleanup: (() => void) | null = null
    getCurrentWindow()
      .onDragDropEvent((event: { payload: DragDropEvent }) => {
        const p = event.payload
        if (p.type === 'enter' || p.type === 'over') {
          setDragging(true)
        } else if (p.type === 'leave') {
          setDragging(false)
        } else if (p.type === 'drop') {
          setDragging(false)
          const paths = p.paths
          const valid: Array<{ path: string; name: string }> = []
          const invalid: string[] = []
          for (const path of paths) {
            const name = nameFromPath(path)
            if (isAccepted(name)) {
              valid.push({ path, name })
            } else {
              invalid.push('.' + name.split('.').pop()?.toLowerCase())
            }
          }
          if (invalid.length) {
            setError(`Unsupported format${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`)
          } else {
            setError('')
          }
          if (valid.length) onFiles(valid)
        }
      })
      .then((unlisten: () => void) => { cleanup = unlisten })
    return () => { cleanup?.() }
  }, [onFiles])

  const handleBrowse = useCallback(async () => {
    const paths = await invoke<string[] | null>('open_file_dialog')
    if (paths?.length) {
      const valid = paths
        .map((p: string) => ({ path: p, name: nameFromPath(p) }))
        .filter((f: { path: string; name: string }) => isAccepted(f.name))
      if (valid.length) onFiles(valid)
    }
  }, [onFiles])

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full gap-6 px-8">
      <div
        onClick={handleBrowse}
        className={`w-full max-w-lg flex flex-col items-center justify-center gap-4 p-12 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
          dragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-gray-600 bg-gray-800/40 hover:border-gray-500 hover:bg-gray-800/60'
        }`}
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
    </div>
  )
}
