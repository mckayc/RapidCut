import React from 'react'
import { useStore } from '../store/useStore'
import type { WhisperModel } from '../types'

const WHISPER_MODELS: { value: WhisperModel; label: string }[] = [
  { value: 'tiny', label: 'Tiny (fastest, lower accuracy)' },
  { value: 'base.en', label: 'Base English (recommended)' },
  { value: 'small', label: 'Small (slower, better accuracy)' },
  { value: 'medium', label: 'Medium (slowest, best accuracy)' },
]

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
  disabled?: boolean
}

function Slider({ label, value, min, max, step, unit, onChange, disabled }: SliderProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-blue-400 font-mono">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

interface Props {
  onSettingsChange?: () => void
  showModelSelector?: boolean
}

export default function SettingsPanel({ onSettingsChange, showModelSelector = false }: Props) {
  const { settings, updateSettings, fillerWords } = useStore()

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    updateSettings({ [key]: value })
    onSettingsChange?.()
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Whisper model — only shown on idle/auto mode */}
      {showModelSelector && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
            Transcription Model
          </span>
          <select
            value={settings.whisperModel}
            onChange={(e) => update('whisperModel', e.target.value as WhisperModel)}
            className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {WHISPER_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filler words */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Filler Words
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div
              onClick={() => update('removeFillerWords', !settings.removeFillerWords)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                settings.removeFillerWords ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  settings.removeFillerWords ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span className="text-xs text-gray-400">
              {settings.removeFillerWords ? 'On' : 'Off'}
            </span>
          </label>
        </div>
        {settings.removeFillerWords && (
          <p className="text-xs text-gray-600">
            {fillerWords.length} word{fillerWords.length !== 1 ? 's' : ''} configured
          </p>
        )}
      </div>

      {/* Silence removal */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Silence Removal
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div
              onClick={() => update('removeSilence', !settings.removeSilence)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                settings.removeSilence ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  settings.removeSilence ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span className="text-xs text-gray-400">{settings.removeSilence ? 'On' : 'Off'}</span>
          </label>
        </div>

        {settings.removeSilence && (
          <div className="flex flex-col gap-3 pl-0">
            {/* Mode */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-gray-500">Detection method</span>
              <div className="flex gap-2">
                {(['no_speech', 'audio'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { update('silenceMode', m); onSettingsChange?.() }}
                    className={`flex-1 py-1 rounded text-xs transition-colors ${
                      settings.silenceMode === m
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {m === 'no_speech' ? 'No Speech' : 'Audio Level'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-600">
                {settings.silenceMode === 'no_speech'
                  ? 'Removes gaps between transcribed words (accurate)'
                  : 'Removes regions below the dB threshold'}
              </p>
            </div>

            {/* Silence Threshold — only for audio mode */}
            <Slider
              label="Silence Threshold"
              value={settings.silenceThresholdDb}
              min={-70}
              max={-10}
              step={1}
              unit=" dB"
              onChange={(v) => update('silenceThresholdDb', v)}
              disabled={settings.silenceMode !== 'audio'}
            />

            {/* Min silence duration */}
            <Slider
              label="Minimum Silence Duration"
              value={settings.minSilenceDurationMs}
              min={100}
              max={2000}
              step={50}
              unit=" ms"
              onChange={(v) => update('minSilenceDurationMs', v)}
            />

            {/* Pre/Post padding */}
            <Slider
              label="Pre-cut Padding"
              value={settings.preCutPaddingMs}
              min={0}
              max={500}
              step={10}
              unit=" ms"
              onChange={(v) => update('preCutPaddingMs', v)}
            />
            <Slider
              label="Post-cut Padding"
              value={settings.postCutPaddingMs}
              min={0}
              max={500}
              step={10}
              unit=" ms"
              onChange={(v) => update('postCutPaddingMs', v)}
            />
          </div>
        )}
      </div>

      {/* FPS */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          Timeline FPS
        </span>
        <select
          value={settings.fps}
          onChange={(e) => update('fps', Number(e.target.value))}
          className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        >
          {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
