import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Word } from '../types'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\w]/g, '')
}

// Detect spans of ≥4 consecutive words that appear more than once within a window
function findRepeatSpans(words: Word[], minLen = 4, window = 80): Set<number> {
  const hits = new Set<number>()
  for (let i = 0; i < words.length - minLen; i++) {
    const phrase = words.slice(i, i + minLen).map((w) => normalizeWord(w.word)).join(' ')
    const end = Math.min(i + window, words.length - minLen + 1)
    for (let j = i + minLen; j < end; j++) {
      const cand = words.slice(j, j + minLen).map((w) => normalizeWord(w.word)).join(' ')
      if (phrase === cand) {
        for (let k = i; k < i + minLen; k++) hits.add(k)
        for (let k = j; k < j + minLen; k++) hits.add(k)
      }
    }
  }
  return hits
}

// Group words into sentence-like chunks by punctuation or long gaps
function groupIntoSentences(words: Word[]): Word[][] {
  const groups: Word[][] = []
  let current: Word[] = []
  for (let i = 0; i < words.length; i++) {
    current.push(words[i])
    const endsWithPunct = /[.?!]$/.test(words[i].word.trim())
    const nextGap =
      i + 1 < words.length ? words[i + 1].start - words[i].end : 0
    if (endsWithPunct || nextGap > 1.5 || i === words.length - 1) {
      groups.push(current)
      current = []
    }
  }
  return groups
}

// ─── Drag context ─────────────────────────────────────────────────────────────

interface DragCtx {
  onWordMouseDown: (index: number) => void
  onWordMouseEnter: (index: number) => void
}

const DragContext = createContext<DragCtx>({
  onWordMouseDown: () => {},
  onWordMouseEnter: () => {},
})

// ─── Word chip ────────────────────────────────────────────────────────────────

function WordChip({
  index,
  isRepeat,
}: {
  index: number
  isRepeat: boolean
}) {
  const { words, isWordCut, manualToggles, cutRegions } = useStore()
  const { onWordMouseDown, onWordMouseEnter } = useContext(DragContext)
  const word = words[index]
  const cut = isWordCut(index)
  const override = manualToggles[index]

  let chipClass = ''
  let title = word.word

  if (override === 'keep') {
    chipClass = 'bg-green-600/20 text-green-300 border border-green-600/50'
    title += ' (manually kept)'
  } else if (override === 'cut') {
    chipClass = 'bg-red-600/30 text-red-300 border border-red-600/50 line-through'
    title += ' (manually cut)'
  } else if (cut) {
    const region = cutRegions.find((r) => r.start <= word.start && r.end >= word.end)
    if (region?.reason === 'filler_word') {
      chipClass = 'bg-orange-500/20 text-orange-300 border border-orange-500/40 line-through'
      title += ' (filler word)'
    } else {
      chipClass = 'bg-red-500/20 text-red-300 border border-red-500/40 line-through'
      title += ' (will be cut)'
    }
  } else if (isRepeat) {
    chipClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
    title += ' (possible repeat — drag to cut)'
  } else {
    chipClass =
      'bg-gray-700/60 text-gray-200 border border-gray-600/40 hover:border-blue-500/60 hover:bg-gray-700'
  }

  return (
    <span
      onMouseDown={(e) => { e.preventDefault(); onWordMouseDown(index) }}
      onMouseEnter={() => onWordMouseEnter(index)}
      title={title}
      className={`inline-block px-1.5 py-0.5 m-0.5 rounded text-sm cursor-pointer transition-all select-none ${chipClass}`}
    >
      {word.word}
    </span>
  )
}

// ─── Sentence row ─────────────────────────────────────────────────────────────

function SentenceRow({
  words,
  indices,
  repeatSpans,
}: {
  words: Word[]
  indices: number[]
  repeatSpans: Set<number>
}) {
  const [expanded, setExpanded] = useState(false)
  const { isWordCut, addTimeCut, removeTimeCutsOverlapping } = useStore()

  const cutCount = indices.filter((i) => isWordCut(i)).length
  const total = indices.length
  const allCut = cutCount === total
  const noneCut = cutCount === 0
  const hasRepeat = indices.some((i) => repeatSpans.has(i))
  const text = words.map((w) => w.word).join(' ')

  const sentenceStart = words[0].start
  const sentenceEnd = words[words.length - 1].end

  const barColor = allCut
    ? 'bg-red-500'
    : hasRepeat
      ? 'bg-amber-500'
      : noneCut
        ? 'bg-green-600'
        : 'bg-yellow-500'

  const barTitle = hasRepeat && !allCut ? 'Contains possible repeated phrase — expand to review' : undefined

  function cutSentence() {
    addTimeCut(sentenceStart, sentenceEnd)
  }

  function keepSentence() {
    removeTimeCutsOverlapping(sentenceStart, sentenceEnd)
  }

  return (
    <div className="border-b border-gray-800/60 last:border-0">
      {/* Collapsed row */}
      <div
        className="flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-800/30 group"
        onClick={() => setExpanded((e) => !e)}
      >
        <div
          className={`w-1 rounded-full flex-shrink-0 mt-1.5 ${barColor} ${hasRepeat && !allCut ? 'h-5' : 'h-4'}`}
          title={barTitle}
        />
        <p
          className={`flex-1 text-sm leading-snug ${
            allCut ? 'text-gray-600 line-through' : 'text-gray-300'
          }`}
        >
          {text}
        </p>
        <span className="text-xs text-gray-600 flex-shrink-0 mt-0.5">
          {cutCount}/{total}
        </span>
        <div
          className="flex gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={keepSentence}
            title="Keep entire sentence"
            className="text-xs px-1.5 py-0.5 rounded bg-green-700/40 text-green-300 hover:bg-green-700/70"
          >
            Keep
          </button>
          <button
            onClick={cutSentence}
            title="Cut entire sentence"
            className="text-xs px-1.5 py-0.5 rounded bg-red-700/40 text-red-300 hover:bg-red-700/70"
          >
            Cut
          </button>
        </div>
        <svg
          className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform mt-0.5 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded words */}
      {expanded && (
        <div className="px-3 pb-2 pt-1 leading-loose">
          {indices.map((wi) => (
            <WordChip key={wi} index={wi} isRepeat={repeatSpans.has(wi)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TranscriptEditor() {
  const { words, cutRegions, getKeepSegments, videoDuration, settings } = useStore()

  const keepSegments = useMemo(() => getKeepSegments(), [words, cutRegions])
  const totalKeptSecs = keepSegments.reduce((acc, s) => acc + (s.end - s.start), 0)
  const totalCutSecs = videoDuration - totalKeptSecs

  const sentences = useMemo(() => groupIntoSentences(words), [words])
  const repeatSpans = useMemo(() => findRepeatSpans(words), [words])

  // ─── Drag-to-select ────────────────────────────────────────────────────────

  const dragIntent = useRef<'cut' | 'keep' | null>(null)

  const onWordMouseDown = useCallback((index: number) => {
    const store = useStore.getState()
    const intent = store.isWordCut(index) ? 'keep' : 'cut'
    dragIntent.current = intent
    store.pushHistory()
    store.setWordOverride(index, intent)
  }, [])

  const onWordMouseEnter = useCallback((index: number) => {
    if (dragIntent.current === null) return
    useStore.getState().setWordOverride(index, dragIntent.current)
  }, [])

  useEffect(() => {
    const handler = () => { dragIntent.current = null }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [])

  const dragCtx = useMemo<DragCtx>(
    () => ({ onWordMouseDown, onWordMouseEnter }),
    [onWordMouseDown, onWordMouseEnter],
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  // Audio level mode: no transcript available
  if (!words.length) {
    const cutCount = cutRegions.length
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center px-8">
        <p className="text-gray-400 font-medium">
          {settings.processingMode === 'audio_level' ? 'Audio Level Mode' : 'No transcript'}
        </p>
        {cutCount > 0 && (
          <p className="text-gray-500 text-sm">
            {cutCount} silence region{cutCount !== 1 ? 's' : ''} detected ·{' '}
            {formatTime(totalKeptSecs)} kept
          </p>
        )}
        <p className="text-gray-700 text-xs max-w-xs">
          Switch to Speech mode before dropping a file to get an editable transcript.
        </p>
      </div>
    )
  }

  return (
    <DragContext.Provider value={dragCtx}>
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Stats bar */}
        <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 flex-shrink-0">
          <span>{words.length} words</span>
          <span className="text-green-400">Keeping: {formatTime(totalKeptSecs)}</span>
          <span className="text-red-400">Cutting: {formatTime(totalCutSecs)}</span>
          <span className="text-gray-600">Original: {formatTime(videoDuration)}</span>
          {repeatSpans.size > 0 && (
            <span className="text-amber-400">{repeatSpans.size} repeated words</span>
          )}
          <span className="ml-auto text-gray-600 italic text-xs">
            Click to expand · Drag words to cut/keep · Keep/Cut to bulk toggle
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 text-xs flex-shrink-0">
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
            Cut
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-green-600/30 border border-green-600/40 inline-block" />
            Manually kept
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40 inline-block" />
            Repeat
          </span>
        </div>

        {/* Sentences */}
        <div className="flex-1 overflow-y-auto">
          {sentences.map((sentenceWords, si) => {
            const firstWordIdx = sentences.slice(0, si).reduce((acc, s) => acc + s.length, 0)
            const indices = sentenceWords.map((_, wi) => firstWordIdx + wi)
            return (
              <SentenceRow
                key={si}
                words={sentenceWords}
                indices={indices}
                repeatSpans={repeatSpans}
              />
            )
          })}
        </div>
      </div>
    </DragContext.Provider>
  )
}
