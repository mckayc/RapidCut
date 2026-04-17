import React, { useState } from 'react'
import { useStore } from '../store/useStore'

const DEFAULT_FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'so', 'basically',
  'literally', 'actually', 'right', 'okay', 'hmm', 'ah',
]

interface Props {
  onClose: () => void
}

export default function FillerWordManager({ onClose }: Props) {
  const { fillerWords, addFillerWord, removeFillerWord, setFillerWords } = useStore()
  const [input, setInput] = useState('')

  function handleAdd() {
    const w = input.trim().toLowerCase()
    if (w) addFillerWord(w)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAdd()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">Filler Word Library</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none">
            ✕
          </button>
        </div>

        {/* Add word */}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add word or phrase…"
            className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAdd}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
          >
            Add
          </button>
        </div>

        {/* Word list */}
        <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
          {fillerWords.map((word) => {
            const isDefault = DEFAULT_FILLER_WORDS.includes(word)
            return (
              <span
                key={word}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-gray-700 text-gray-300 border border-gray-600"
              >
                {word}
                <button
                  onClick={() => removeFillerWord(word)}
                  className="text-gray-500 hover:text-red-400 transition-colors leading-none"
                >
                  ✕
                </button>
              </span>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-between pt-1">
          <button
            onClick={() => setFillerWords([...DEFAULT_FILLER_WORDS])}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
