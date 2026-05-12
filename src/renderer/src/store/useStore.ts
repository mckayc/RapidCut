import { create } from 'zustand'
import type { CutRegion, Settings, PresetData, AppStatus, Segment } from '../types'

export const DEFAULT_SETTINGS: Settings = {
  useAudioDetection: false,
  useSpeechDetection: true,
  silenceThresholdDb: -40,
  preCutPaddingMs: 50,
  postCutPaddingMs: 50,
  minSilenceDurationMs: 300,
  vadSensitivity: 0.5,
}

const DEFAULT_PRESET_NAME = 'Default'

function syncPreset(
  presets: Record<string, PresetData>,
  activePreset: string,
  settings: Settings,
): Record<string, PresetData> {
  if (!activePreset || !presets[activePreset]) return presets
  return { ...presets, [activePreset]: { settings } }
}

function mergeRegions(regions: CutRegion[]): CutRegion[] {
  if (!regions.length) return []
  const sorted = [...regions].sort((a, b) => a.start - b.start)
  const merged: CutRegion[] = [{ ...sorted[0] }]
  for (const r of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged
}

interface AppState {
  // File
  filePath: string | null
  fileName: string | null
  videoDuration: number
  setFile: (filePath: string, fileName: string) => void
  setDuration: (duration: number) => void
  clearFile: () => void

  // Status
  status: AppStatus
  statusMessage: string
  setStatus: (status: AppStatus, message?: string) => void

  // Cut regions from analysis
  cutRegions: CutRegion[]
  setCutRegions: (regions: CutRegion[]) => void

  // Settings
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void

  // Presets
  presets: Record<string, PresetData>
  activePreset: string
  loadPresetsFromDisk: (data: { active: string; presets: Record<string, PresetData> }) => void
  initDefaultPreset: () => void
  switchPreset: (name: string) => void
  createPreset: (name: string) => void
  clonePreset: (name: string) => void
  deletePreset: (name: string) => void
  renamePreset: (oldName: string, newName: string) => void

  // Logs
  logs: string[]
  addLog: (log: string) => void
  showTerminal: boolean
  setShowTerminal: (show: boolean) => void

  // Derived
  getKeepSegments: () => Segment[]
}

export const useStore = create<AppState>((set, get) => ({
  filePath: null,
  fileName: null,
  videoDuration: 0,

  setFile: (filePath, fileName) =>
    set({ filePath, fileName, videoDuration: 0, cutRegions: [], status: 'idle', statusMessage: '', logs: [] }),

  setDuration: (videoDuration) => set({ videoDuration }),

  clearFile: () =>
    set({ filePath: null, fileName: null, videoDuration: 0, cutRegions: [], status: 'idle', statusMessage: '' }),

  status: 'idle',
  statusMessage: '',
  setStatus: (status, message = '') => set({ status, statusMessage: message }),

  cutRegions: [],
  setCutRegions: (cutRegions) => set({ cutRegions }),

  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) => {
    set((s) => {
      const settings = { ...s.settings, ...partial }
      return { settings, presets: syncPreset(s.presets, s.activePreset, settings) }
    })
  },

  presets: { [DEFAULT_PRESET_NAME]: { settings: DEFAULT_SETTINGS } },
  activePreset: DEFAULT_PRESET_NAME,

  loadPresetsFromDisk: ({ active, presets }) => {
    if (!presets || !Object.keys(presets).length) return
    const activeName = presets[active] ? active : Object.keys(presets)[0]
    const preset = presets[activeName]
    set({ presets, activePreset: activeName, settings: { ...DEFAULT_SETTINGS, ...preset.settings } })
  },

  initDefaultPreset: () =>
    set((s) => ({
      presets: { [DEFAULT_PRESET_NAME]: { settings: s.settings } },
      activePreset: DEFAULT_PRESET_NAME,
    })),

  switchPreset: (name) =>
    set((s) => {
      const preset = s.presets[name]
      if (!preset) return {}
      return { activePreset: name, settings: { ...DEFAULT_SETTINGS, ...preset.settings } }
    }),

  createPreset: (name) =>
    set((s) => {
      const trimmed = name.trim()
      if (!trimmed) return {}
      return {
        presets: { ...s.presets, [trimmed]: { settings: { ...s.settings } } },
        activePreset: trimmed,
      }
    }),

  clonePreset: (sourceName) =>
    set((s) => {
      const source = s.presets[sourceName] ?? { settings: s.settings }
      let newName = `${sourceName} (Copy)`
      let i = 2
      while (s.presets[newName]) newName = `${sourceName} (Copy ${i++})`
      return {
        presets: { ...s.presets, [newName]: { settings: { ...source.settings } } },
        activePreset: newName,
        settings: { ...source.settings },
      }
    }),

  deletePreset: (name) =>
    set((s) => {
      const keys = Object.keys(s.presets)
      if (keys.length <= 1) return {}
      const newPresets = { ...s.presets }
      delete newPresets[name]
      const newActive = s.activePreset === name ? Object.keys(newPresets)[0] : s.activePreset
      const preset = newPresets[newActive]
      return {
        presets: newPresets,
        activePreset: newActive,
        ...(s.activePreset === name ? { settings: preset.settings } : {}),
      }
    }),

  renamePreset: (oldName, newName) =>
    set((s) => {
      const trimmed = newName.trim()
      if (!trimmed || s.presets[trimmed] || !s.presets[oldName]) return {}
      const newPresets = { ...s.presets }
      newPresets[trimmed] = newPresets[oldName]
      delete newPresets[oldName]
      return { presets: newPresets, activePreset: s.activePreset === oldName ? trimmed : s.activePreset }
    }),

  logs: [],
  addLog: (log) => set((s) => ({ logs: [...s.logs.slice(-200), log] })),
  showTerminal: false,
  setShowTerminal: (showTerminal) => set({ showTerminal }),

  getKeepSegments: () => {
    const { cutRegions, videoDuration, settings } = get()
    if (!videoDuration) return []

    const pre = settings.preCutPaddingMs / 1000
    const post = settings.postCutPaddingMs / 1000

    const paddedCuts = cutRegions
      .map((r) => {
        const start = r.start === 0 ? 0 : r.start + pre
        const end = r.end >= videoDuration ? videoDuration : r.end - post
        if (start >= end) return null
        return { ...r, start, end }
      })
      .filter((r): r is CutRegion => r !== null)

    const merged = mergeRegions(paddedCuts)

    const MIN_KEEP = 0.05
    const segments: Segment[] = []
    let pos = 0
    for (const cut of merged) {
      if (cut.start > pos + MIN_KEEP) segments.push({ start: pos, end: cut.start })
      pos = cut.end
    }
    if (videoDuration - pos > MIN_KEEP) segments.push({ start: pos, end: videoDuration })

    return segments
  },
}))
