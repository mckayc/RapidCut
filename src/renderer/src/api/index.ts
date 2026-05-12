import type { CutRegion, Settings, Segment } from '../types'

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

export interface AnalyzeResult {
  cut_regions: CutRegion[]
}

export function analyzeFile(filePath: string, settings: Settings): Promise<AnalyzeResult> {
  return post('/analyze', {
    words: [],
    file_path: filePath,
    settings: {
      useAudioDetection: settings.useAudioDetection,
      useSpeechDetection: settings.useSpeechDetection,
      silenceThresholdDb: settings.silenceThresholdDb,
      preCutPaddingMs: settings.preCutPaddingMs,
      postCutPaddingMs: settings.postCutPaddingMs,
      minSilenceDurationMs: settings.minSilenceDurationMs,
      vadSensitivity: settings.vadSensitivity ?? 0.5,
    },
  })
}

export interface ExportResult {
  xml: string
}

export function exportXml(
  filePath: string,
  keepSegments: Segment[],
  sequenceName: string,
): Promise<ExportResult> {
  return post('/export', {
    file_path: filePath,
    keep_segments: keepSegments,
    sequence_name: sequenceName,
  })
}
