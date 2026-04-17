import type { Word, CutRegion, Settings, Segment } from '../types'

const BASE = 'http://127.0.0.1:8765'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface TranscribeResult {
  words: Word[]
  duration: number
  text: string
}

export function transcribeFile(filePath: string, model: string): Promise<TranscribeResult> {
  return post('/transcribe', { file_path: filePath, model })
}

export interface AnalyzeResult {
  cut_regions: CutRegion[]
}

export function analyzeFile(
  words: Word[],
  filePath: string,
  settings: Settings,
  fillerWords: string[],
): Promise<AnalyzeResult> {
  return post('/analyze', {
    words,
    file_path: filePath,
    settings: {
      removeFillerWords: settings.removeFillerWords,
      removeSilence: settings.removeSilence,
      silenceMode: settings.silenceMode,
      silenceThresholdDb: settings.silenceThresholdDb,
      preCutPaddingMs: settings.preCutPaddingMs,
      postCutPaddingMs: settings.postCutPaddingMs,
      minSilenceDurationMs: settings.minSilenceDurationMs,
      fillerWords,
    },
  })
}

export interface ExportResult {
  xml: string
}

export function exportXml(
  filePath: string,
  keepSegments: Segment[],
  fps: number,
  sequenceName: string,
): Promise<ExportResult> {
  return post('/export', {
    file_path: filePath,
    keep_segments: keepSegments,
    fps,
    sequence_name: sequenceName,
  })
}
