import React from 'react'
import { useStore } from '../store/useStore'

interface Props {
  onSetup?: () => void
}

export default function Header({ onSetup }: Props) {
  const { clearFile, filePath } = useStore()

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

      <div className="flex items-center gap-2">
        {onSetup && (
          <button
            onClick={onSetup}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
            title="Setup / Dependencies"
          >
            ⚙
          </button>
        )}
      </div>
    </header>
  )
}
