import { create } from 'zustand'
import type {
  Word,
  CutRegion,
  Segment,
  Settings,
  PresetData,
  AppStatus,
  AppMode,
  ManualToggle,
} from '../types'

export const DEFAULT_FILLER_WORDS = [
  'um', 'uh', 'you know', 'so', 'basically',
  'literally', 'actually', 'right', 'okay', 'hmm', 'ah',
]

export const DEFAULT_SETTINGS: Settings = {
  processingMode: 'audio_level',
  removeNoSpeech: true,
  removeFillerWords: false,
  silenceThresholdDb: -40,
  preCutPaddingMs: 50,
  postCutPaddingMs: 50,
  minSilenceDurationMs: 300,
  whisperModel: 'base.en',
}

const DEFAULT_PRESET_NAME = 'Default'

interface HistoryEntry {
  manualToggles: Record<number, ManualToggle>
}

interface AppState {
  // Mode
  mode: AppMode
  setMode: (mode: AppMode) => void

  // File
  filePath: string | null
  fileName: string | null
  videoDuration: number
  setFile: (filePath: string, fileName: string) => void
  clearFile: () => void

  // Status
  status: AppStatus
  statusMessage: string
  setStatus: (status: AppStatus, message?: string) => void

  // Transcript
  words: Word[]
  setWords: (words: Word[], duration: number) => void

  // Cut regions from server
  cutRegions: CutRegion[]
  setCutRegions: (regions: CutRegion[]) => void

  // Per-word manual overrides
  manualToggles: Record<number, ManualToggle>
  toggleWord: (index: number) => void
  clearToggles: () => void

  // Settings
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void

  // Filler words
  fillerWords: string[]
  setFillerWords: (words: string[]) => void
  addFillerWord: (word: string) => void
  removeFillerWord: (word: string) => void

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

  // Undo/redo
  history: HistoryEntry[]
  historyIndex: number
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // Derived
  getKeepSegments: () => Segment[]
  isWordCut: (index: number) => boolean
}

function mergeRegions(regions: CutRegion[]): CutRegion[] {
  if (!regions.length) return []
  const sorted = [...regions].sort((a, b) => a.start - b.start)
  const merged: CutRegion[] = [{ ...sorted[0] }]
  for (const r of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

function syncPreset(
  presets: Record<string, PresetData>,
  activePreset: string,
  settings: Settings,
  fillerWords: string[],
): Record<string, PresetData> {
  if (!activePreset || !presets[activePreset]) return presets
  return {
    ...presets,
    [activePreset]: { settings, fillerWords },
  }
}

export const useStore = create<AppState>((set, get) => ({
  mode: 'edit',
  setMode: (mode) => set({ mode }),

  filePath: null,
  fileName: null,
  videoDuration: 0,
  setFile: (filePath, fileName) => set({ filePath, fileName }),
  clearFile: () =>
    set({
      filePath: null,
      fileName: null,
      videoDuration: 0,
      words: [],
      cutRegions: [],
      manualToggles: {},
      history: [],
      historyIndex: -1,
      status: 'idle',
      statusMessage: '',
    }),

  status: 'idle',
  statusMessage: '',
  setStatus: (status, message = '') => set({ status, statusMessage: message }),

  words: [],
  setWords: (words, duration) => set({ words, videoDuration: duration }),

  cutRegions: [],
  setCutRegions: (cutRegions) => set({ cutRegions }),

  manualToggles: {},
  toggleWord: (index) => {
    const { words, manualToggles, isWordCut, history, historyIndex } = get()
    if (!words[index]) return

    const prev = { manualToggles: { ...manualToggles } }
    const current = manualToggles[index]

    let next: Record<number, ManualToggle>
    if (current === undefined) {
      next = { ...manualToggles, [index]: isWordCut(index) ? 'keep' : 'cut' }
    } else if (current === 'keep') {
      next = { ...manualToggles, [index]: 'cut' }
    } else {
      next = { ...manualToggles }
      delete next[index]
    }

    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(prev)
    set({ manualToggles: next, history: newHistory, historyIndex: newHistory.length - 1 })
  },
  clearToggles: () =>
    set((s) => {
      const prev = { manualToggles: { ...s.manualToggles } }
      const newHistory = s.history.slice(0, s.historyIndex + 1)
      newHistory.push(prev)
      return { manualToggles: {}, history: newHistory, historyIndex: newHistory.length - 1 }
    }),

  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) =>
    set((s) => {
      const settings = { ...s.settings, ...partial }
      return {
        settings,
        presets: syncPreset(s.presets, s.activePreset, settings, s.fillerWords),
      }
    }),

  fillerWords: [...DEFAULT_FILLER_WORDS],
  setFillerWords: (fillerWords) =>
    set((s) => ({
      fillerWords,
      presets: syncPreset(s.presets, s.activePreset, s.settings, fillerWords),
    })),
  addFillerWord: (word) => {
    const w = word.toLowerCase().trim()
    if (!w) return
    set((s) => {
      const fillerWords = s.fillerWords.includes(w) ? s.fillerWords : [...s.fillerWords, w]
      return {
        fillerWords,
        presets: syncPreset(s.presets, s.activePreset, s.settings, fillerWords),
      }
    })
  },
  removeFillerWord: (word) =>
    set((s) => {
      const fillerWords = s.fillerWords.filter((fw) => fw !== word)
      return {
        fillerWords,
        presets: syncPreset(s.presets, s.activePreset, s.settings, fillerWords),
      }
    }),

  // ─── Presets ────────────────────────────────────────────────────────────────

  presets: {
    [DEFAULT_PRESET_NAME]: {
      settings: DEFAULT_SETTINGS,
      fillerWords: [...DEFAULT_FILLER_WORDS],
    },
  },
  activePreset: DEFAULT_PRESET_NAME,

  loadPresetsFromDisk: (data) => {
    const { active, presets } = data
    if (!presets || !Object.keys(presets).length) return
    const activeName = presets[active] ? active : Object.keys(presets)[0]
    const preset = presets[activeName]
    set({
      presets,
      activePreset: activeName,
      settings: preset.settings,
      fillerWords: preset.fillerWords,
    })
  },

  initDefaultPreset: () =>
    set((s) => ({
      presets: {
        [DEFAULT_PRESET_NAME]: { settings: s.settings, fillerWords: s.fillerWords },
      },
      activePreset: DEFAULT_PRESET_NAME,
    })),

  switchPreset: (name) =>
    set((s) => {
      const preset = s.presets[name]
      if (!preset) return {}
      return {
        activePreset: name,
        settings: preset.settings,
        fillerWords: preset.fillerWords,
      }
    }),

  createPreset: (name) =>
    set((s) => {
      const trimmed = name.trim()
      if (!trimmed) return {}
      return {
        presets: {
          ...s.presets,
          [trimmed]: { settings: { ...s.settings }, fillerWords: [...s.fillerWords] },
        },
        activePreset: trimmed,
      }
    }),

  clonePreset: (sourceName) =>
    set((s) => {
      const source = s.presets[sourceName] ?? { settings: s.settings, fillerWords: s.fillerWords }
      let newName = `${sourceName} (Copy)`
      let i = 2
      while (s.presets[newName]) newName = `${sourceName} (Copy ${i++})`
      return {
        presets: {
          ...s.presets,
          [newName]: { settings: { ...source.settings }, fillerWords: [...source.fillerWords] },
        },
        activePreset: newName,
        settings: { ...source.settings },
        fillerWords: [...source.fillerWords],
      }
    }),

  deletePreset: (name) =>
    set((s) => {
      const keys = Object.keys(s.presets)
      if (keys.length <= 1) return {}
      const newPresets = { ...s.presets }
      delete newPresets[name]
      const newActive =
        s.activePreset === name ? Object.keys(newPresets)[0] : s.activePreset
      const preset = newPresets[newActive]
      return {
        presets: newPresets,
        activePreset: newActive,
        ...(s.activePreset === name
          ? { settings: preset.settings, fillerWords: preset.fillerWords }
          : {}),
      }
    }),

  renamePreset: (oldName, newName) =>
    set((s) => {
      const trimmed = newName.trim()
      if (!trimmed || s.presets[trimmed] || !s.presets[oldName]) return {}
      const newPresets = { ...s.presets }
      newPresets[trimmed] = newPresets[oldName]
      delete newPresets[oldName]
      return {
        presets: newPresets,
        activePreset: s.activePreset === oldName ? trimmed : s.activePreset,
      }
    }),

  // ─── Undo / redo ─────────────────────────────────────────────────────────────

  history: [],
  historyIndex: -1,
  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex < 0) return
    set({ manualToggles: history[historyIndex].manualToggles, historyIndex: historyIndex - 1 })
  },
  redo: () => {
    const { history, historyIndex, manualToggles } = get()
    if (historyIndex >= history.length - 1) return
    history[historyIndex + 1] = { manualToggles: { ...manualToggles } }
    set({ manualToggles: history[historyIndex + 1].manualToggles, historyIndex: historyIndex + 1 })
  },
  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // ─── Derived ─────────────────────────────────────────────────────────────────

  isWordCut: (index) => {
    const { words, cutRegions, manualToggles } = get()
    const word = words[index]
    if (!word) return false
    const override = manualToggles[index]
    if (override === 'keep') return false
    if (override === 'cut') return true
    return cutRegions.some((r) => r.start <= word.start && r.end >= word.end)
  },

  getKeepSegments: () => {
    const { words, cutRegions, manualToggles, videoDuration } = get()
    if (!videoDuration) return []

    let effectiveCuts: CutRegion[] = [...cutRegions]

    Object.entries(manualToggles).forEach(([idxStr, toggle]) => {
      const word = words[parseInt(idxStr)]
      if (!word) return
      if (toggle === 'keep') {
        effectiveCuts = effectiveCuts.filter(
          (r) => !(r.start < word.end && r.end > word.start),
        )
      } else if (toggle === 'cut') {
        effectiveCuts.push({ start: word.start, end: word.end, reason: 'manual' })
      }
    })

    effectiveCuts = mergeRegions(effectiveCuts)

    const keepSegments: Segment[] = []
    let pos = 0
    for (const cut of effectiveCuts) {
      if (cut.start > pos + 0.01) keepSegments.push({ start: pos, end: cut.start })
      pos = cut.end
    }
    if (videoDuration - pos > 0.01) keepSegments.push({ start: pos, end: videoDuration })

    return keepSegments
  },
}))
