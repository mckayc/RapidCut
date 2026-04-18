import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { WhisperModel, ProcessingMode } from '../types'

const WHISPER_MODELS: { value: WhisperModel; label: string }[] = [
  { value: 'tiny', label: 'Tiny (fastest, lower accuracy)' },
  { value: 'base.en', label: 'Base English (recommended)' },
  { value: 'small', label: 'Small (slower, better accuracy)' },
  { value: 'medium', label: 'Medium (slowest, best accuracy)' },
]

// ─── Slider ──────────────────────────────────────────────────────────────────

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
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)

  useEffect(() => {
    setDraft(value)
    draftRef.current = value
  }, [value])

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-blue-400 font-mono">
          {draft}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          draftRef.current = v
        }}
        onPointerUp={() => onChange(draftRef.current)}
        className="w-full"
      />
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex items-center gap-1.5" onClick={() => onChange(!checked)}>
        <div
          className={`w-8 h-4 rounded-full transition-colors relative ${
            checked ? 'bg-blue-600' : 'bg-gray-600'
          }`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
        <span className="text-xs text-gray-400 w-6">{checked ? 'On' : 'Off'}</span>
      </div>
    </label>
  )
}

// ─── Presets panel ────────────────────────────────────────────────────────────

function PresetsPanel() {
  const {
    presets,
    activePreset,
    switchPreset,
    createPreset,
    clonePreset,
    deletePreset,
    renamePreset,
  } = useStore()

  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const presetNames = Object.keys(presets)

  function commitRename() {
    if (renaming && renameValue.trim()) renamePreset(renaming, renameValue.trim())
    setRenaming(null)
    setRenameValue('')
  }

  function commitCreate() {
    if (newName.trim()) createPreset(newName.trim())
    setCreating(false)
    setNewName('')
  }

  return (
    <div className="border-t border-gray-800 pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-0 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Presets
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-blue-400 truncate max-w-[90px]">{activePreset}</span>
          <svg
            className={`w-3 h-3 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {presetNames.map((name) => (
            <div
              key={name}
              className={`flex items-center gap-1 rounded px-2 py-1 group ${
                name === activePreset ? 'bg-blue-600/20' : 'hover:bg-gray-700/50'
              }`}
            >
              {renaming === name ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') { setRenaming(null); setRenameValue('') }
                  }}
                  className="flex-1 bg-gray-700 text-xs text-gray-200 px-1 py-0.5 rounded outline-none border border-blue-500"
                />
              ) : (
                <button
                  onClick={() => { if (name !== activePreset) switchPreset(name) }}
                  onDoubleClick={() => { setRenaming(name); setRenameValue(name) }}
                  className={`flex-1 text-left text-xs truncate ${
                    name === activePreset ? 'text-blue-300 font-medium' : 'text-gray-300'
                  }`}
                  title="Click to switch · Double-click to rename"
                >
                  {name === activePreset && (
                    <span className="mr-1 text-blue-400">✓</span>
                  )}
                  {name}
                </button>
              )}
              <button
                onClick={() => clonePreset(name)}
                title="Clone"
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 text-xs px-0.5"
              >
                ⧉
              </button>
              <button
                onClick={() => {
                  if (presetNames.length > 1) deletePreset(name)
                }}
                title="Delete"
                disabled={presetNames.length <= 1}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-0.5 disabled:opacity-20"
              >
                ✕
              </button>
            </div>
          ))}

          {creating ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Preset name…"
              onBlur={() => { setCreating(false); setNewName('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              className="mt-1 bg-gray-700 text-xs text-gray-200 px-2 py-1 rounded outline-none border border-blue-500"
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mt-1 text-xs text-gray-500 hover:text-blue-400 text-left px-2"
            >
              + New preset
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main settings panel ──────────────────────────────────────────────────────

interface Props {
  showModelSelector?: boolean
  onOpenFillerManager?: () => void
}

export default function SettingsPanel({ showModelSelector = false, onOpenFillerManager }: Props) {
  const { settings, updateSettings, fillerWords } = useStore()

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    updateSettings({ [key]: value })
  }

  const isAudioLevel = settings.processingMode === 'audio_level'
  const isSpeech = settings.processingMode === 'speech'

  return (
    <div className="flex flex-col gap-5 p-4">

      {/* Processing mode toggle */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Mode
        </span>
        <div className="flex gap-2">
          {(['audio_level', 'speech'] as ProcessingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => update('processingMode', m)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                settings.processingMode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'audio_level' ? 'Audio Level' : 'Speech'}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600">
          {isAudioLevel
            ? 'Cuts regions below the dB threshold — no transcription needed'
            : 'Uses Whisper transcript to remove non-speech and filler words'}
        </p>
      </div>

      {/* Audio Level settings */}
      {isAudioLevel && (
        <div className="flex flex-col gap-3">
          <Slider
            label="Silence Threshold"
            value={settings.silenceThresholdDb}
            min={-70} max={-10} step={1} unit=" dB"
            onChange={(v) => update('silenceThresholdDb', v)}
          />
          <Slider
            label="Minimum Silence Duration"
            value={settings.minSilenceDurationMs}
            min={100} max={2000} step={50} unit=" ms"
            onChange={(v) => update('minSilenceDurationMs', v)}
          />
          <Slider
            label="Pre-cut Padding"
            value={settings.preCutPaddingMs}
            min={0} max={500} step={10} unit=" ms"
            onChange={(v) => update('preCutPaddingMs', v)}
          />
          <Slider
            label="Post-cut Padding"
            value={settings.postCutPaddingMs}
            min={0} max={500} step={10} unit=" ms"
            onChange={(v) => update('postCutPaddingMs', v)}
          />
        </div>
      )}

      {/* Speech settings */}
      {isSpeech && (
        <div className="flex flex-col gap-4">
          {/* Remove no-speech toggle */}
          <div className="flex flex-col gap-2">
            <Toggle
              label="Remove Non-Speech"
              checked={settings.removeNoSpeech}
              onChange={(v) => update('removeNoSpeech', v)}
            />
            {settings.removeNoSpeech && (
              <div className="flex flex-col gap-3 pl-1">
                <Slider
                  label="Minimum Gap Duration"
                  value={settings.minSilenceDurationMs}
                  min={100} max={2000} step={50} unit=" ms"
                  onChange={(v) => update('minSilenceDurationMs', v)}
                />
                <Slider
                  label="Pre-cut Padding"
                  value={settings.preCutPaddingMs}
                  min={0} max={500} step={10} unit=" ms"
                  onChange={(v) => update('preCutPaddingMs', v)}
                />
                <Slider
                  label="Post-cut Padding"
                  value={settings.postCutPaddingMs}
                  min={0} max={500} step={10} unit=" ms"
                  onChange={(v) => update('postCutPaddingMs', v)}
                />
              </div>
            )}
          </div>

          {/* Remove filler words toggle */}
          <div className="flex flex-col gap-1.5">
            <Toggle
              label="Remove Filler Words"
              checked={settings.removeFillerWords}
              onChange={(v) => update('removeFillerWords', v)}
            />
            {settings.removeFillerWords && (
              <div className="flex items-center justify-between pl-1">
                <span className="text-xs text-gray-600">
                  {fillerWords.length} word{fillerWords.length !== 1 ? 's' : ''} configured
                </span>
                {onOpenFillerManager && (
                  <button
                    onClick={onOpenFillerManager}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Whisper model — shown when idle/before first drop */}
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
        </div>
      )}

      {/* Presets */}
      <PresetsPanel />
    </div>
  )
}
