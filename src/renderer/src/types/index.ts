export interface CutRegion {
  start: number
  end: number
  reason: 'silence' | 'no_speech'
}

export interface Segment {
  start: number
  end: number
}

export interface Settings {
  useAudioDetection: boolean
  useSpeechDetection: boolean
  silenceThresholdDb: number
  preCutPaddingMs: number
  postCutPaddingMs: number
  minSilenceDurationMs: number
  vadSensitivity: number
}

export interface PresetData {
  settings: Settings
}

export type AppStatus =
  | 'idle'
  | 'analyzing'
  | 'exporting'
  | 'error'

export interface DepInfo {
  available: boolean
  version?: string
  error?: string
}

export interface DepsStatus {
  python: DepInfo
  ffmpeg: DepInfo
  silero_vad: DepInfo
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
      getDepsVerified: () => Promise<boolean>
      setDepsVerified: () => Promise<void>
      clearDepsVerified: () => Promise<void>
      on: (channel: string, callback: (...args: any[]) => void) => () => void
    }
  }
}
