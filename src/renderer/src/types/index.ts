export interface Word {
  word: string
  start: number
  end: number
}

export interface CutRegion {
  start: number
  end: number
  reason: 'filler_word' | 'silence' | 'no_speech' | 'manual'
}

export interface Segment {
  start: number
  end: number
}

export type ProcessingMode = 'audio_level' | 'speech'

export type WhisperModel = 'tiny' | 'base' | 'base.en' | 'small' | 'medium'

export interface Settings {
  processingMode: ProcessingMode
  removeNoSpeech: boolean
  removeFillerWords: boolean
  silenceThresholdDb: number
  preCutPaddingMs: number
  postCutPaddingMs: number
  minSilenceDurationMs: number
  whisperModel: WhisperModel
  titleResolution: string
  defaultTitleDuration: number
}

export interface PresetData {
  settings: Settings
  fillerWords: string[]
}

export type AppStatus =
  | 'idle'
  | 'transcribing'
  | 'analyzing'
  | 'ready'
  | 'exporting'
  | 'error'

export type AppMode = 'auto' | 'edit'

export type ManualToggle = 'keep' | 'cut'

export interface DepInfo {
  available: boolean
  version?: string
  error?: string
}

export interface DepsStatus {
  python: DepInfo
  ffmpeg: DepInfo
}

declare global {
  interface Window {
    electronAPI: {
      getFilePath: (file: File) => string
      showSaveDialog: (defaultName: string) => Promise<string | null>
      writeFile: (filePath: string, content: string) => Promise<void>
      readFile: (filePath: string) => Promise<string | null>
      getUserDataPath: () => Promise<string>
      checkDeps: () => Promise<DepsStatus>
      installPipDeps: () => Promise<{ success: boolean; output: string }>
      installFfmpeg: () => Promise<{ success: boolean; output: string; manual?: string }>
      startServer: () => Promise<{ success: boolean; error?: string }>
      openExternal: (url: string) => Promise<void>
      getSystemFonts: () => Promise<Array<{ name: string; path: string }>>
    }
  }
}
