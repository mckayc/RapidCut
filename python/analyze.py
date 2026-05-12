import os
from typing import List, Dict, Any

from pydub import AudioSegment
from pydub.silence import detect_silence

_ffmpeg = os.environ.get("FFMPEG_PATH")
if _ffmpeg:
    AudioSegment.converter = _ffmpeg
    AudioSegment.ffmpeg = _ffmpeg


def analyze(words: List[Dict], file_path: str, settings: Dict[str, Any]) -> Dict:
    use_speech = settings.get("useSpeechDetection", True)
    use_audio = settings.get("useAudioDetection", False)
    silence_thresh_db = int(settings.get("silenceThresholdDb", -40))
    min_silence_ms = int(settings.get("minSilenceDurationMs", 300))
    vad_threshold = float(settings.get("vadSensitivity", 0.5))

    cut_regions: List[Dict] = []

    if use_speech:
        from vad import extract_audio, get_speech_segments, speech_segments_to_cut_regions, get_audio_duration_from_wav
        audio_path = extract_audio(file_path)
        try:
            segs = get_speech_segments(audio_path, min_silence_duration_ms=min_silence_ms, threshold=vad_threshold)
            dur = get_audio_duration_from_wav(audio_path)
            cut_regions.extend(speech_segments_to_cut_regions(segs, dur, min_silence_ms))
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    if use_audio:
        _add_audio_silence_cuts(file_path, cut_regions, silence_thresh_db, min_silence_ms)

    return {"cut_regions": cut_regions}


def _add_audio_silence_cuts(file_path, cut_regions, thresh_db, min_ms):
    audio = AudioSegment.from_file(file_path)
    silent_ranges = detect_silence(audio, min_silence_len=min_ms, silence_thresh=thresh_db)
    for start_ms, end_ms in silent_ranges:
        cut_regions.append({
            "start": round(start_ms / 1000, 3),
            "end": round(end_ms / 1000, 3),
            "reason": "silence"
        })


def _merge_regions(regions: List[Dict]) -> List[Dict]:
    if not regions:
        return []
    sorted_r = sorted(regions, key=lambda r: r["start"])
    merged = [dict(sorted_r[0])]
    for r in sorted_r[1:]:
        if r["start"] <= merged[-1]["end"] + 0.01:
            merged[-1]["end"] = max(merged[-1]["end"], r["end"])
        else:
            merged.append(dict(r))
    return merged
