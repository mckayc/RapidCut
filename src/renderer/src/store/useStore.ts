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
  titleResolution: '1080p',
  defaultTitleDuration: 3.0,
  detectRepeatedPhrases: false,
  minRepeatPhraseLength: 3,
}

const DEFAULT_PRESET_NAME = 'Default'

export type ResolutionKey = '1080p' | '4k' | '720p' | 'vertical'

export interface TitleTemplate {
  id: string
  name: string
  fontPath: string
  fontSize: number
  color: string
  alignment: 'left' | 'center' | 'right'
  box: {
    x: number
    y: number
    width: number
    height: number
  }
  aiPrompt: string
  isDynamic: boolean
  shadowEnabled: boolean
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

export interface TitleInstance {
  id: string
  text: string
  startTime: number
  duration: number
  templateId: string
  // Store word index to help keep the title "attached" to transcript flow
  wordIndex: number
}

interface TimeRangeCut {
  start: number
  end: number
}

interface HistoryEntry {
  manualToggles: Record<number, ManualToggle>
  manualTimeCuts: TimeRangeCut[]
}

interface AppState {
  // Mode
  mode: AppMode
  setMode: (mode: AppMode) => void
  view: 'edit' | 'script' | 'titles'
  setView: (view: 'edit' | 'script' | 'titles') => void

  // File
  filePath: string | null
  fileName: string | null
  audioPath: string | null
  videoDuration: number
  currentTime: number
  playbackSpeed: number
  setCurrentTime: (time: number) => void
  setPlaybackSpeed: (speed: number) => void
  setFile: (filePath: string, fileName: string) => void
  clearFile: () => void

  // Status
  status: AppStatus
  statusMessage: string
  setStatus: (status: AppStatus, message?: string) => void

  // Transcript
  words: Word[]
  setWords: (words: Word[], duration: number, audioPath?: string) => void

  // Frontend-computed cut regions (filler words + repeated phrases — no Python needed)
  frontendCutRegions: CutRegion[]
  recomputeFrontendCuts: () => void

  // Transcription timing
  lastTranscribeDuration: number | null
  setTranscribeDuration: (seconds: number) => void

  // Cut regions from server
  cutRegions: CutRegion[]
  setCutRegions: (regions: CutRegion[]) => void

  // Per-word manual overrides
  manualToggles: Record<number, ManualToggle>
  toggleWord: (index: number) => void
  setWordOverride: (index: number, override: ManualToggle | undefined) => void
  pushHistory: () => void
  clearToggles: () => void

  // Time-range manual cuts (for sentence-level bulk operations)
  manualTimeCuts: TimeRangeCut[]
  addTimeCut: (start: number, end: number) => void
  removeTimeCutsOverlapping: (start: number, end: number) => void

  // Settings
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void

  // Filler words
  fillerWords: string[]
  setFillerWords: (words: string[]) => void
  addFillerWord: (word: string) => void
  removeFillerWord: (word: string) => void

  // Global Title Settings
  setTitleResolution: (res: ResolutionKey) => void

  // System Fonts
  availableFonts: Array<{ name: string; path: string }>
  setAvailableFonts: (fonts: Array<{ name: string; path: string }>) => void

  // Titles & Templates
  titles: TitleInstance[]
  templates: TitleTemplate[]
  addTitle: (wordIndex: number, text: string, templateId: string, duration?: number) => void
  removeTitle: (id: string) => void
  updateTitle: (id: string, partial: Partial<Pick<TitleInstance, 'text' | 'duration' | 'templateId'>>) => void
  createTemplate: (name: string) => void
  updateTemplate: (id: string, partial: Partial<TitleTemplate>) => void
  cloneTemplate: (id: string) => void
  deleteTemplate: (id: string) => void

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
  getCleanTranscript: () => string
}

function computeFrontendCuts(words: Word[], settings: Settings, fillerWords: string[]): CutRegion[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^\w]/g, '')
  const regions: CutRegion[] = []

  if (settings.removeFillerWords && words.length) {
    const fillerSet = new Set(fillerWords.map(norm))
    for (let i = 0; i < words.length; i++) {
      if (fillerSet.has(norm(words[i].word))) {
        const start = i > 0 ? words[i - 1].end : 0
        regions.push({ start, end: words[i].end + 0.05, reason: 'filler_word' })
      }
    }
  }

  if (settings.detectRepeatedPhrases && words.length) {
    const minLen = Math.max(2, settings.minRepeatPhraseLength ?? 3)
    const maxLen = Math.min(minLen + 5, 10)
    const MAX_GAP_S = 10.0
    let i = 0
    while (i < words.length) {
      let found = false
      for (let n = maxLen; n >= minLen; n--) {
        if (i + 2 * n > words.length) continue
        const p1 = words.slice(i, i + n).map(w => norm(w.word))
        const p2 = words.slice(i + n, i + 2 * n).map(w => norm(w.word))
        if (!p1.every(w => w.length > 0)) continue
        if (p1.every((w, j) => w === p2[j])) {
          const gap = words[i + n].start - words[i + n - 1].end
          if (gap <= MAX_GAP_S) {
            regions.push({ start: words[i].start, end: words[i + n - 1].end, reason: 'repeated_phrase' })
            i += n
            found = true
            break
          }
        }
      }
      if (!found) i++
    }
  }

  return regions
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
  view: 'edit',
  setView: (view) => set({ view }),

  filePath: null,
  fileName: null,
  audioPath: null,
  currentTime: 0,
  playbackSpeed: 1,
  videoDuration: 0,
  setFile: (filePath, fileName) => set({ filePath, fileName }),
  clearFile: () =>
    set({
      filePath: null,
      fileName: null,
      audioPath: null,
      videoDuration: 0,
      currentTime: 0,
      words: [],
      cutRegions: [],
      manualToggles: {},
      manualTimeCuts: [],
      history: [],
      historyIndex: -1,
      status: 'idle',
      statusMessage: '',
    }),

  status: 'idle',
  statusMessage: '',
  setStatus: (status, message = '') => set({ status, statusMessage: message }),

  words: [],
  setWords: (words, duration, audioPath) => {
    set({ words, videoDuration: duration, audioPath: audioPath || null })
    get().recomputeFrontendCuts()
  },

  frontendCutRegions: [],
  recomputeFrontendCuts: () => {
    const { words, settings, fillerWords } = get()
    set({ frontendCutRegions: computeFrontendCuts(words, settings, fillerWords) })
  },

  lastTranscribeDuration: null,
  setTranscribeDuration: (seconds) => set({ lastTranscribeDuration: seconds }),

  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),

  cutRegions: [],
  setCutRegions: (cutRegions) => set({ cutRegions }),

  manualToggles: {},
  manualTimeCuts: [],

  toggleWord: (index) => {
    const { words, manualToggles, manualTimeCuts, isWordCut, history, historyIndex } = get()
    if (!words[index]) return

    const prev = { manualToggles: { ...manualToggles }, manualTimeCuts: [...manualTimeCuts] }
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

  setWordOverride: (index, override) => {
    const { words, manualToggles } = get()
    if (!words[index]) return
    if (manualToggles[index] === override) return
    const next = { ...manualToggles }
    if (override === undefined) delete next[index]
    else next[index] = override
    set({ manualToggles: next })
  },

  pushHistory: () => {
    const { manualToggles, manualTimeCuts, history, historyIndex } = get()
    const entry = { manualToggles: { ...manualToggles }, manualTimeCuts: [...manualTimeCuts] }
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(entry)
    set({ history: newHistory, historyIndex: newHistory.length - 1 })
  },

  addTimeCut: (start, end) => {
    const { manualToggles, manualTimeCuts, words, history, historyIndex } = get()
    const prev = { manualToggles: { ...manualToggles }, manualTimeCuts: [...manualTimeCuts] }
    // Remove word-level 'keep' overrides for words inside this range
    const newToggles = { ...manualToggles }
    words.forEach((w, i) => {
      if (w.start >= start && w.end <= end && newToggles[i] === 'keep') delete newToggles[i]
    })
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(prev)
    set({
      manualTimeCuts: [...manualTimeCuts, { start, end }],
      manualToggles: newToggles,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    })
  },

  removeTimeCutsOverlapping: (start, end) => {
    const { manualToggles, manualTimeCuts, words, history, historyIndex } = get()
    const prev = { manualToggles: { ...manualToggles }, manualTimeCuts: [...manualTimeCuts] }
    const newTimeCuts = manualTimeCuts.filter((c) => !(c.start < end && c.end > start))
    // Remove word-level 'cut' overrides for words inside this range
    const newToggles = { ...manualToggles }
    words.forEach((w, i) => {
      if (w.start >= start && w.end <= end && newToggles[i] === 'cut') delete newToggles[i]
    })
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(prev)
    set({
      manualTimeCuts: newTimeCuts,
      manualToggles: newToggles,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    })
  },

  clearToggles: () =>
    set((s) => {
      const prev = { manualToggles: { ...s.manualToggles }, manualTimeCuts: [...s.manualTimeCuts] }
      const newHistory = s.history.slice(0, s.historyIndex + 1)
      newHistory.push(prev)
      return { manualToggles: {}, manualTimeCuts: [], history: newHistory, historyIndex: newHistory.length - 1 }
    }),

  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) => {
    set((s) => {
      const settings = { ...s.settings, ...partial }
      return {
        settings,
        presets: syncPreset(s.presets, s.activePreset, settings, s.fillerWords),
      }
    })
    get().recomputeFrontendCuts()
  },

  fillerWords: [...DEFAULT_FILLER_WORDS],
  setFillerWords: (fillerWords) => {
    set((s) => ({
      fillerWords,
      presets: syncPreset(s.presets, s.activePreset, s.settings, fillerWords),
    }))
    get().recomputeFrontendCuts()
  },
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
    get().recomputeFrontendCuts()
  },
  removeFillerWord: (word) => {
    set((s) => {
      const fillerWords = s.fillerWords.filter((fw) => fw !== word)
      return {
        fillerWords,
        presets: syncPreset(s.presets, s.activePreset, s.settings, fillerWords),
      }
    })
    get().recomputeFrontendCuts()
  },

  setTitleResolution: (titleResolution) => set((s) => ({ 
    settings: { ...s.settings, titleResolution } 
  })),

  availableFonts: [],
  setAvailableFonts: (availableFonts) => set({ availableFonts }),

  // ─── Titles & Templates ──────────────────────────────────────────────────────

  titles: [],
  templates: [
    {
      id: 'default-title',
      name: 'Standard Title',
      fontPath: '',
      fontSize: 60,
      color: '#ffffff',
      alignment: 'left',
      box: { x: 5, y: 5, width: 40, height: 20 },
      isDynamic: true,
      aiPrompt: 'Please summarize and create titles for the following transcript:',
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowBlur: 4,
      shadowOffsetX: 3,
      shadowOffsetY: 3,
    }
  ],

  addTitle: (wordIndex, text, templateId, duration) => set((s) => {
    const word = s.words[wordIndex]
    if (!word) return s
    const newTitle: TitleInstance = {
      id: crypto.randomUUID(),
      text,
      startTime: word.start,
      duration: duration ?? s.settings.defaultTitleDuration ?? 3.0,
      templateId,
      wordIndex
    }
    return { titles: [...s.titles, newTitle] }
  }),

  removeTitle: (id) => set((s) => ({ titles: s.titles.filter(t => t.id !== id) })),

  updateTitle: (id, partial) => set((s) => ({
    titles: s.titles.map(t => t.id === id ? { ...t, ...partial } : t)
  })),

  createTemplate: (name) => set((s) => ({
    templates: [...s.templates, {
      id: crypto.randomUUID(),
      name,
      fontPath: '',
      fontSize: 60,
      color: '#ffffff',
      alignment: 'left',
      box: { x: 10, y: 10, width: 30, height: 15 },
      isDynamic: true,
      aiPrompt: 'Please summarize and create titles for the following transcript:',
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowBlur: 4,
      shadowOffsetX: 3,
      shadowOffsetY: 3,
    }]
  })),

  updateTemplate: (id, partial) => set((s) => ({
    templates: s.templates.map(t => t.id === id ? { ...t, ...partial } : t)
  })),

  cloneTemplate: (id) => set((s) => {
    const source = s.templates.find(t => t.id === id)
    if (!source) return s
    const cloned = { ...source, id: crypto.randomUUID(), name: `${source.name} (Copy)` }
    return { templates: [...s.templates, cloned] }
  }),

  deleteTemplate: (id) => set((s) => ({
    templates: s.templates.filter(t => t.id !== id)
  })),

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
    const entry = history[historyIndex]
    set({ manualToggles: entry.manualToggles, manualTimeCuts: entry.manualTimeCuts, historyIndex: historyIndex - 1 })
  },
  redo: () => {
    const { history, historyIndex } = get()
    if (historyIndex >= history.length - 1) return
    const entry = history[historyIndex + 1]
    set({ manualToggles: { ...entry.manualToggles }, manualTimeCuts: [...entry.manualTimeCuts], historyIndex: historyIndex + 1 })
  },
  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // ─── Derived ─────────────────────────────────────────────────────────────────

  isWordCut: (index) => {
    const { words, cutRegions, frontendCutRegions, manualToggles, manualTimeCuts } = get()
    const word = words[index]
    if (!word) return false
    const override = manualToggles[index]
    if (override === 'keep') return false
    if (override === 'cut') return true
    if (manualTimeCuts.some((tc) => tc.start <= word.start && tc.end >= word.end)) return true
    if (frontendCutRegions.some((r) => r.start <= word.start && r.end >= word.end)) return true
    return cutRegions.some((r) => r.start <= word.start && r.end >= word.end)
  },

  getKeepSegments: () => {
    const { words, cutRegions, frontendCutRegions, manualToggles, manualTimeCuts, videoDuration, isWordCut } = get()
    if (!videoDuration) return []

    let effectiveCuts: CutRegion[] = [...cutRegions, ...frontendCutRegions]

    // Apply time-range cuts (covers full sentence spans including inter-word gaps)
    for (const tc of manualTimeCuts) {
      effectiveCuts.push({ start: tc.start, end: tc.end, reason: 'manual' })
    }

    // Apply word-level overrides
    Object.entries(manualToggles).forEach(([idxStr, toggle]) => {
      const word = words[parseInt(idxStr)]
      if (!word) return
      if (toggle === 'keep') {
        // Punch a hole in any existing cuts to keep this specific word
        const nextCuts: CutRegion[] = []
        for (const r of effectiveCuts) {
          if (r.start < word.end && r.end > word.start) {
            if (r.start < word.start) nextCuts.push({ ...r, end: word.start })
            if (r.end > word.end) nextCuts.push({ ...r, start: word.end })
          } else {
            nextCuts.push(r)
          }
        }
        effectiveCuts = nextCuts
      } else if (toggle === 'cut') {
        effectiveCuts.push({ start: word.start, end: word.end, reason: 'manual' })
      }
    })

    effectiveCuts = mergeRegions(effectiveCuts)

    // Smart Merge: Bridge gaps between cut regions if they contain no speech words that are intended to be kept.
    // This solves the "leftover clips" issue where gaps between manual cuts are kept despite the content being removed.
    if (words.length > 0 && effectiveCuts.length > 0) {
      // Pre-calculate word status for performance to avoid UI lag.
      const isActuallyCut = words.map((_, i) => isWordCut(i))
      const smartMerged: CutRegion[] = []
      
      let current = { ...effectiveCuts[0] }
      
      // If no words are kept before the first cut, start the first cut at the very beginning of the file.
      const hasKeepWordBefore = words.some((w, idx) => w.end <= current.start && !isActuallyCut[idx])
      if (!hasKeepWordBefore) current.start = 0

      for (let i = 1; i < effectiveCuts.length; i++) {
        const next = effectiveCuts[i]
        const gapStart = current.end
        const gapEnd = next.start
        
        // A gap is bridged if it contains no words that the user wants to keep.
        const hasKeepWordInGap = words.some((w, idx) => 
          !isActuallyCut[idx] && w.start < gapEnd && w.end > gapStart
        )
        
        if (!hasKeepWordInGap) {
          current.end = next.end
        } else {
          smartMerged.push(current)
          current = { ...next }
        }
      }
      
      // If no words are kept after the last cut, extend the last cut to the very end of the file.
      const hasKeepWordAfter = words.some((w, idx) => w.start >= current.end && !isActuallyCut[idx])
      if (!hasKeepWordAfter) current.end = videoDuration

      smartMerged.push(current)
      effectiveCuts = smartMerged
    }

    const keepSegments: Segment[] = []
    const MIN_KEEP_DURATION = 0.05 // Ignore kept segments shorter than 50ms (prevents sub-frame artifacts)
    let pos = 0
    for (const cut of effectiveCuts) {
      if (cut.start > pos + MIN_KEEP_DURATION) keepSegments.push({ start: pos, end: cut.start })
      pos = cut.end
    }
    if (videoDuration - pos > MIN_KEEP_DURATION) keepSegments.push({ start: pos, end: videoDuration })

    console.log('[RapidCut] Segments to KEEP:')
    console.table(keepSegments)

    return keepSegments
  },

  getCleanTranscript: () => {
    const { words, isWordCut } = get()
    return words
      .filter((_, i) => !isWordCut(i))
      .map(w => w.word)
      .join(' ')
  }
}))
