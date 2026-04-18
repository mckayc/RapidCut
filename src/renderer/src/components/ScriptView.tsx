import React, { useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'

export default function ScriptView() {
  const { 
    words, 
    audioPath, 
    currentTime, 
    setCurrentTime, 
    playbackSpeed, 
    setPlaybackSpeed 
  } = useStore()
  
  const audioRef = useRef<HTMLAudioElement>(null)

  // Sync playback speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

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
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Audio Player Toolbar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 bg-[#1a1d27]">
        {audioPath ? (
          <audio
            ref={audioRef}
            src={`media://${audioPath.replace(/\\/g, '/')}`}
            controls
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            className="h-8 flex-1"
          />
        ) : (
          <div className="flex-1 text-xs text-gray-500 italic">
            Audio playback unavailable (no source found)
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 uppercase font-bold">Speed</span>
          <div className="flex bg-gray-800 rounded-lg p-1">
            {[0.75, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`px-2 py-1 text-xs rounded ${
                  playbackSpeed === s ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Script Content */}
      <div className="flex-1 overflow-y-auto p-12 leading-loose text-lg">
        <div className="max-w-3xl mx-auto">
          {words.map((word, i) => {
            const isActive = currentTime >= word.start && currentTime <= word.end
            return (
              <span
                key={i}
                onClick={() => {
                  if (audioRef.current) audioRef.current.currentTime = word.start
                }}
                className={`cursor-pointer transition-colors duration-150 px-0.5 rounded ${
                  isActive 
                    ? 'bg-blue-500/30 text-blue-300 font-medium' 
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {word.word}{' '}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}