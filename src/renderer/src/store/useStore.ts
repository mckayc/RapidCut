import { create } from 'zustand'
import type {
  Word,
  CutRegion,
  Segment,
  Settings,
  AppStatus,
  AppMode,
  ManualToggle,
} from '../types'

const DEFAULT_FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'so', 'basically',
  'literally', 'actually', 'right', 'okay', 'hmm', 'ah',
]

const DEFAULT_SETTINGS: Settings = {
  removeFillerWords: true,
  removeSilence: true,
  silenceMode: 'no_speech',
  silenceThresholdDb: -40,
  preCutPaddingMs: 50,
  postCutPaddingMs: 50,
  minSilenceDurationMs: 300,
  whisperModel: 'base.en',
  fps: 24,
}

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

  // Per-word manual overrides (index → 'keep' | 'cut')
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
      // auto → forced opposite of auto decision
      next = { ...manualToggles, [index]: isWordCut(index) ? 'keep' : 'cut' }
    } else if (current === 'keep') {
      next = { ...manualToggles, [index]: 'cut' }
    } else {
      // 'cut' → back to auto (remove override)
      next = { ...manualToggles }
      delete next[index]
    }

    // push history
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
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  fillerWords: [...DEFAULT_FILLER_WORDS],
  setFillerWords: (words) => set({ fillerWords: words }),
  addFillerWord: (word) => {
    const w = word.toLowerCase().trim()
    if (!w) return
    set((s) => ({ fillerWords: s.fillerWords.includes(w) ? s.fillerWords : [...s.fillerWords, w] }))
  },
  removeFillerWord: (word) =>
    set((s) => ({ fillerWords: s.fillerWords.filter((fw) => fw !== word) })),

  history: [],
  historyIndex: -1,
  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex < 0) return
    const entry = history[historyIndex]
    set({ manualToggles: entry.manualToggles, historyIndex: historyIndex - 1 })
  },
  redo: () => {
    const { history, historyIndex, manualToggles } = get()
    if (historyIndex >= history.length - 1) return
    const next = history[historyIndex + 1]
    // swap current into that slot for undo
    history[historyIndex + 1] = { manualToggles: { ...manualToggles } }
    set({ manualToggles: next.manualToggles, historyIndex: historyIndex + 1 })
  },
  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

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

    // Combine server cuts with manual overrides
    let effectiveCuts: CutRegion[] = [...cutRegions]

    // Remove cuts that overlap with force-kept words
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
