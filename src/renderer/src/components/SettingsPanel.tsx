import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

// ─── InfoTip ──────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group inline-block ml-1.5 align-middle">
      <span className="w-3.5 h-3.5 rounded-full bg-gray-700 text-gray-500 text-[9px] inline-flex items-center justify-center cursor-default leading-none select-none">?</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-gray-900 border border-gray-700 text-gray-300 text-[10px] leading-relaxed px-2.5 py-2 rounded-md shadow-xl z-50 invisible group-hover:visible pointer-events-none normal-case tracking-normal font-normal">
        {text}
      </span>
    </span>
  )
}

// ─── Slider ───────────────────────────────────────────────────────────────────

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
  tip?: string
  formatValue?: (v: number) => string
}

function Slider({ label, value, min, max, step, unit, onChange, tip, formatValue }: SliderProps) {
  const safeValue = value ?? min
  const [draft, setDraft] = useState(safeValue)
  const draftRef = useRef(safeValue)

  useEffect(() => {
    const v = value ?? min
    setDraft(v)
    draftRef.current = v
  }, [value, min])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400 flex items-center">
          {label}
          {tip && <InfoTip text={tip} />}
        </span>
        <span className="text-xs text-blue-400 font-mono">
          {formatValue ? formatValue(draft) : draft}{unit}
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex items-center gap-1.5" onClick={() => onChange(!checked)}>
        <div className={`w-8 h-4 rounded-full transition-colors relative ${checked ? 'bg-blue-600' : 'bg-gray-600'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-xs text-gray-400 w-6">{checked ? 'On' : 'Off'}</span>
      </div>
    </label>
  )
}

// ─── Presets panel ────────────────────────────────────────────────────────────

function PresetsPanel() {
  const { presets, activePreset, switchPreset, createPreset, clonePreset, deletePreset, renamePreset } = useStore()
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
      <button onClick={() => setOpen((o) => !o)} className="flex items-center justify-between w-full px-0 text-left">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Presets</span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-blue-400 truncate max-w-[90px]">{activePreset}</span>
          <svg className={`w-3 h-3 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {presetNames.map((name) => (
            <div key={name} className={`flex items-center gap-1 rounded px-2 py-1 group ${name === activePreset ? 'bg-blue-600/20' : 'hover:bg-gray-700/50'}`}>
              {renaming === name ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(null); setRenameValue('') } }}
                  className="flex-1 bg-gray-700 text-xs text-gray-200 px-1 py-0.5 rounded outline-none border border-blue-500"
                />
              ) : (
                <button
                  onClick={() => { if (name !== activePreset) switchPreset(name) }}
                  onDoubleClick={() => { setRenaming(name); setRenameValue(name) }}
                  className={`flex-1 text-left text-xs truncate ${name === activePreset ? 'text-blue-300 font-medium' : 'text-gray-300'}`}
                  title="Click to switch · Double-click to rename"
                >
                  {name === activePreset && <span className="mr-1 text-blue-400">✓</span>}
                  {name}
                </button>
              )}
              <button onClick={() => clonePreset(name)} title="Clone" className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 text-xs px-0.5">⧉</button>
              <button
                onClick={() => { if (presetNames.length > 1) deletePreset(name) }}
                title="Delete"
                disabled={presetNames.length <= 1}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-0.5 disabled:opacity-20"
              >✕</button>
            </div>
          ))}

          {creating ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Preset name…"
              onBlur={() => { setCreating(false); setNewName('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
              className="mt-1 bg-gray-700 text-xs text-gray-200 px-2 py-1 rounded outline-none border border-blue-500"
            />
          ) : (
            <button onClick={() => setCreating(true)} className="mt-1 text-xs text-gray-500 hover:text-blue-400 text-left px-2">+ New preset</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main settings panel ──────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { settings, updateSettings } = useStore()

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    updateSettings({ [key]: value })
  }

  const showAudio = settings.useAudioDetection
  const showSpeech = settings.useSpeechDetection
  const showPadding = showAudio || showSpeech

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Speech Detection */}
      <div className="flex flex-col gap-2">
        <Toggle
          label="Speech Detection"
          checked={settings.useSpeechDetection}
          onChange={(v) => update('useSpeechDetection', v)}
        />
        {showSpeech && (
          <div className="flex flex-col gap-3 pl-1">
            <Slider
              label="Minimum Gap Duration"
              value={settings.minSilenceDurationMs}
              min={30} max={2000} step={10} unit=" ms"
              tip="The shortest non-speech gap that will be cut."
              onChange={(v) => update('minSilenceDurationMs', v)}
            />
            <Slider
              label="Speech Threshold"
              value={settings.vadSensitivity ?? 0.5}
              min={0.3} max={0.8} step={0.05} unit=""
              tip="How confident the detector must be before keeping audio as speech. Raise to cut breaths; lower if real speech is being cut."
              formatValue={(v) => v.toFixed(2)}
              onChange={(v) => update('vadSensitivity', v)}
            />
          </div>
        )}
      </div>

      {/* Audio Level Detection */}
      <div className="flex flex-col gap-2">
        <Toggle
          label="Audio Level Detection"
          checked={settings.useAudioDetection}
          onChange={(v) => update('useAudioDetection', v)}
        />
        {showAudio && (
          <div className="flex flex-col gap-3 pl-1">
            <Slider
              label="Silence Threshold"
              value={settings.silenceThresholdDb}
              min={-70} max={-10} step={1} unit=" dB"
              tip="Audio below this volume is treated as silence."
              onChange={(v) => update('silenceThresholdDb', v)}
            />
            <Slider
              label="Minimum Silence Duration"
              value={settings.minSilenceDurationMs}
              min={30} max={2000} step={10} unit=" ms"
              tip="Only silences longer than this are cut."
              onChange={(v) => update('minSilenceDurationMs', v)}
            />
          </div>
        )}
      </div>

      {/* Shared padding */}
      {showPadding && (
        <div className="flex flex-col gap-3">
          <Slider
            label="Clip Start Padding"
            value={settings.postCutPaddingMs}
            min={0} max={500} step={10} unit=" ms"
            tip="Extra audio kept at the start of each clip so words don't sound clipped."
            onChange={(v) => update('postCutPaddingMs', v)}
          />
          <Slider
            label="Clip End Padding"
            value={settings.preCutPaddingMs}
            min={0} max={500} step={10} unit=" ms"
            tip="Extra audio kept at the end of each clip so words don't sound clipped."
            onChange={(v) => update('preCutPaddingMs', v)}
          />
        </div>
      )}

      {!showAudio && !showSpeech && (
        <p className="text-xs text-yellow-500/80">Enable at least one detector to cut audio.</p>
      )}

      <PresetsPanel />
    </div>
  )
}
