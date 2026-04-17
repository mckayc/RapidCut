import React, { useMemo } from 'react'
import { useStore } from '../store/useStore'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

function WordChip({ index }: { index: number }) {
  const { words, isWordCut, manualToggles, toggleWord, cutRegions } = useStore()
  const word = words[index]
  const cut = isWordCut(index)
  const override = manualToggles[index]

  // Determine color/style
  let chipClass = ''
  let title = word.word

  if (override === 'keep') {
    chipClass = 'bg-green-600/20 text-green-300 border border-green-600/50 line-through-none'
    title += ' (manually kept)'
  } else if (override === 'cut') {
    chipClass = 'bg-red-600/30 text-red-300 border border-red-600/50 line-through'
    title += ' (manually cut)'
  } else if (cut) {
    // Determine the reason
    const region = cutRegions.find((r) => r.start <= word.start && r.end >= word.end)
    if (region?.reason === 'filler_word') {
      chipClass = 'bg-orange-500/20 text-orange-300 border border-orange-500/40 line-through'
      title += ' (filler word)'
    } else {
      chipClass = 'bg-red-500/20 text-red-300 border border-red-500/40 line-through'
      title += ' (will be cut)'
    }
  } else {
    chipClass = 'bg-gray-700/60 text-gray-200 border border-gray-600/40 hover:border-blue-500/60 hover:bg-gray-700'
  }

  return (
    <span
      onClick={() => toggleWord(index)}
      title={title}
      className={`inline-block px-1.5 py-0.5 m-0.5 rounded text-sm cursor-pointer transition-all select-none ${chipClass}`}
    >
      {word.word}
    </span>
  )
}

function SilenceGap({ durationSecs }: { durationSecs: number }) {
  if (durationSecs < 0.1) return null
  const width = Math.min(Math.max(durationSecs * 20, 8), 64)
  return (
    <span
      className="inline-block align-middle mx-1 bg-gray-700/50 rounded"
      style={{ width, height: 4 }}
      title={`${durationSecs.toFixed(2)}s gap`}
    />
  )
}

export default function TranscriptEditor() {
  const { words, cutRegions, getKeepSegments, videoDuration } = useStore()

  const keepSegments = useMemo(() => getKeepSegments(), [words, cutRegions])

  const totalKeptSecs = keepSegments.reduce((acc, s) => acc + (s.end - s.start), 0)
  const totalCutSecs = videoDuration - totalKeptSecs

  if (!words.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        No transcript available
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
        <span>{words.length} words</span>
        <span className="text-green-400">Keeping: {formatTime(totalKeptSecs)}</span>
        <span className="text-red-400">Cutting: {formatTime(totalCutSecs)}</span>
        <span className="text-gray-600">Original: {formatTime(videoDuration)}</span>
        <span className="ml-auto text-gray-600 italic">Click any word to toggle cut/keep</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-700 border border-gray-600 inline-block" />
          Keep
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/40 inline-block" />
          Filler
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40 inline-block" />
          Silence cut
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-600/30 border border-green-600/40 inline-block" />
          Manually kept
        </span>
      </div>

      {/* Words */}
      <div className="flex-1 overflow-y-auto p-4 leading-loose">
        {words.map((word, i) => {
          const prevEnd = i > 0 ? words[i - 1].end : 0
          const gap = word.start - prevEnd
          return (
            <React.Fragment key={i}>
              {gap > 0.15 && <SilenceGap durationSecs={gap} />}
              <WordChip index={i} />
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
