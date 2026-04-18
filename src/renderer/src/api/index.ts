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

export interface ProbeResult {
  duration: number
}

export function probeFile(filePath: string): Promise<ProbeResult> {
  return post('/probe', { file_path: filePath })
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
      processingMode: settings.processingMode,
      removeNoSpeech: settings.removeNoSpeech,
      removeFillerWords: settings.removeFillerWords,
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

export interface ExportOptions {
  titles?: Array<{ text: string; startTime: number; duration: number; templateId?: string }>
  templates?: object[]
  resolution?: string
  savePath?: string
}

export function exportXml(
  filePath: string,
  keepSegments: Segment[],
  sequenceName: string,
  options?: ExportOptions,
): Promise<ExportResult> {
  return post('/export', {
    file_path: filePath,
    keep_segments: keepSegments,
    sequence_name: sequenceName,
    titles: options?.titles,
    templates: options?.templates,
    resolution: options?.resolution,
    save_path: options?.savePath,
  })
}
