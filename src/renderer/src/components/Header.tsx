import React from 'react'
import { useStore } from '../store/useStore'

export default function Header() {
  const { mode, setMode, view, setView, status, canUndo, canRedo, undo, redo, clearFile, filePath } = useStore()
  const isReady = status === 'ready'

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-[#0f1117] select-none">
      <div className="flex items-center gap-3">
        <span className="text-blue-400 font-bold text-lg tracking-tight">RapidCut</span>
        {filePath && (
          <button
            onClick={clearFile}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-2"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
        {(['auto', 'edit'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === m
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {m === 'auto' ? 'Auto' : 'Edit'}
          </button>
        ))}
      </div>

      {/* View Toggle (Edit vs Script) */}
      {isReady && (
        <div className="flex items-center gap-4">
          <button
            onClick={() => setView('edit')}
            className={`text-sm font-medium ${view === 'edit' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Timeline
          </button>
          <button
            onClick={() => setView('script')}
            className={`text-sm font-medium ${view === 'script' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Full Script
          </button>
          <button
            onClick={() => setView('titles')}
            className={`text-sm font-medium ${view === 'titles' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Titles
          </button>
        </div>
      )}

      {/* Undo / Redo — only in edit mode when ready */}
      <div className="flex items-center gap-2">
        {isReady && mode === 'edit' && (
          <>
            <button
              onClick={undo}
              disabled={!canUndo()}
              className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              ↩ Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo()}
              className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Y)"
            >
              ↪ Redo
            </button>
          </>
        )}
      </div>
    </header>
  )
}
