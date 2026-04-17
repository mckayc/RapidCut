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

export type SilenceMode = 'no_speech' | 'audio'

export type WhisperModel = 'tiny' | 'base' | 'base.en' | 'small' | 'medium'

export interface Settings {
  removeFillerWords: boolean
  removeSilence: boolean
  silenceMode: SilenceMode
  silenceThresholdDb: number
  preCutPaddingMs: number
  postCutPaddingMs: number
  minSilenceDurationMs: number
  whisperModel: WhisperModel
  fps: number
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

declare global {
  interface Window {
    electronAPI: {
      getFilePath: (file: File) => string
      showSaveDialog: (defaultName: string) => Promise<string | null>
      writeFile: (filePath: string, content: string) => Promise<void>
      readFile: (filePath: string) => Promise<string | null>
      getUserDataPath: () => Promise<string>
    }
  }
}
