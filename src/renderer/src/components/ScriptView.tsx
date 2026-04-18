import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Word } from '../types'

export default function ScriptView() {
  const {
    words,
    audioPath,
    currentTime,
    setCurrentTime,
    playbackSpeed,
    setPlaybackSpeed,
    videoDuration,
    isWordCut,
    addTitle,
    titles,
    templates,
    settings,
  } = useStore()
  
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeWordRef = useRef<HTMLSpanElement>(null)

  // State for the title creation popover
  const [addingTitleAtIndex, setAddingTitleAtIndex] = useState<number | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [titleDuration, setTitleDuration] = useState(settings.defaultTitleDuration ?? 3.0)
  
  // Track active word index to prevent jitter and redundant scrolls
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1)

  // Sync playback speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Initialize template + duration when modal opens
  useEffect(() => {
    if (addingTitleAtIndex !== null) {
      if (templates.length > 0 && !selectedTemplateId) setSelectedTemplateId(templates[0].id)
      setTitleDuration(settings.defaultTitleDuration ?? 3.0)
    }
  }, [addingTitleAtIndex, templates])

  // Update active word index based on time
  useEffect(() => {
    const index = words.findIndex(w => currentTime >= w.start && currentTime <= w.end)
    if (index !== -1 && index !== activeWordIndex) {
      setActiveWordIndex(index)
    }
  }, [currentTime, words, activeWordIndex])

  // Auto-scroll only when active word changes and is out of view
  useEffect(() => {
    if (activeWordRef.current && activeWordIndex !== -1) {
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      })
    }
  }, [activeWordIndex])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
    setCurrentTime(time)
  }, [setCurrentTime])

  // Heuristic: Group words into paragraphs based on pauses > 1.5s or sentence breaks
  const paragraphs = useMemo(() => {
    const p: Word[][] = []
    let current: Word[] = []
    words.forEach((w, i) => {
      current.push(w)
      const next = words[i + 1]
      const isLongPause = next && next.start - w.end > 1.5
      const isSentenceEnd = /[.?!]$/.test(w.word.trim()) && next && next.start - w.end > 0.6
      if (isLongPause || isSentenceEnd) {
        p.push(current)
        current = []
      }
    })
    if (current.length > 0) p.push(current)
    return p
  }, [words])

  // If no words exist (e.g. in Audio Level Mode), show a placeholder
  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <p className="text-gray-400 font-medium">No transcript available</p>
        <p className="text-gray-600 text-sm max-w-xs">
          The Full Script view requires a transcript. Switch to <strong>Speech Mode</strong> in settings and re-process the file to generate one.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0f1117] overflow-hidden">
      {/* Audio Player Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-4 px-6 py-3 border-b border-gray-800 bg-[#1a1d27]/95 backdrop-blur-md flex-shrink-0">
        {audioPath ? (
          <>
            <audio
              ref={audioRef}
              key={audioPath}
              src={`media://load?path=${encodeURIComponent(audioPath)}`}
              preload="auto"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            />
            <button 
              onClick={() => audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg hover:scale-105 active:scale-95 flex-shrink-0"
            >
              {audioRef.current?.paused ? (
                <svg className="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              ) : (
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              )}
            </button>
            
            <div className="flex-1 flex items-center gap-4 bg-gray-900/50 px-4 py-2 rounded-full border border-gray-700/50">
              <input
                type="range"
                min={0}
                max={videoDuration || 0}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
              />
              <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                <span className="text-blue-400">{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
                <span className="text-gray-600">/</span>
                <span>{new Date(videoDuration * 1000).toISOString().substr(14, 5)}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50 flex-shrink-0">
              {[1, 1.5, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => setPlaybackSpeed(s)}
                  className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                    playbackSpeed === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 text-xs text-gray-500 italic">
            Audio playback unavailable
          </div>
        )}
      </div>

      {/* Script Content */}
      <div className="flex-1 overflow-y-auto p-8 md:p-12 leading-relaxed text-lg scroll-smooth">
        <div className="max-w-3xl mx-auto space-y-8">
          {paragraphs.map((paragraph, pi) => {
            return (
              <p key={pi} className="text-gray-400 group/para relative">
                {/* Title insertion point at start of paragraph */}
                <button
                  onClick={() => {
                    setAddingTitleAtIndex(words.indexOf(paragraph[0]))
                    setTitleDraft('')
                  }}
                  className="absolute -left-10 top-1 opacity-0 group-hover/para:opacity-100 p-1 text-blue-500 hover:bg-blue-500/10 rounded transition-all"
                  title="Add title at start of paragraph"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>

                {paragraph.map((word, wi) => {
                  const isActive = currentTime >= word.start && currentTime <= word.end
                  const isCut = isWordCut(words.indexOf(word))
                  const wordIndex = words.indexOf(word)
                  const hasTitle = titles.some(t => t.wordIndex === wordIndex)
                  
                  return (
                    <React.Fragment key={wi}>
                      <span
                        ref={isActive ? activeWordRef : null}
                        onClick={() => {
                          if (audioRef.current) {
                            audioRef.current.currentTime = word.start
                            setCurrentTime(word.start)
                            audioRef.current.play().catch(() => {})
                          }
                        }}
                        className={`cursor-pointer transition-colors duration-150 px-0.5 rounded inline-block group/word relative ${isCut ? 'opacity-30 line-through decoration-red-500/50' : ''} ${
                          isActive
                            ? 'bg-blue-500/30 text-blue-300'
                            : 'hover:text-gray-200'
                        }`}
                      >
                        {word.word}
                        {hasTitle && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] bg-blue-600 text-white px-1 rounded-sm font-bold shadow-sm">
                            T
                          </span>
                        )}
                        {/* Title insertion point after word */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setAddingTitleAtIndex(wordIndex)
                            setTitleDraft('')
                          }}
                          className="absolute -right-1 top-0 bottom-0 w-2 opacity-0 group-hover/word:opacity-100 bg-blue-500/20 hover:bg-blue-500/40 rounded-sm z-10 transition-opacity"
                          title="Insert title here"
                        />
                      </span>
                      {' '}
                    </React.Fragment>
                  )
                })}
              </p>
            )
          })}
        </div>
      </div>

      {/* Simple Inline Title Creator */}
      {addingTitleAtIndex !== null && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-gray-200 uppercase tracking-widest">Create New Title</h3>
            
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase font-bold">Title Text</label>
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-blue-500"
                placeholder="Enter title text..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && titleDraft) {
                    addTitle(addingTitleAtIndex, titleDraft, selectedTemplateId, titleDuration)
                    setAddingTitleAtIndex(null)
                  }
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase font-bold">Template Style</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-blue-500"
              >
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase font-bold">Duration (seconds)</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={titleDuration}
                onChange={(e) => setTitleDuration(Math.max(0.5, Number(e.target.value)))}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setAddingTitleAtIndex(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
              <button
                onClick={() => { addTitle(addingTitleAtIndex, titleDraft, selectedTemplateId, titleDuration); setAddingTitleAtIndex(null) }}
                disabled={!titleDraft}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
              >Create Title</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}