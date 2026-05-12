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
