import re
import os
from typing import List, Dict, Any

from pydub import AudioSegment
from pydub.silence import detect_silence

_ffmpeg = os.environ.get("FFMPEG_PATH")
if _ffmpeg:
    AudioSegment.converter = _ffmpeg
    AudioSegment.ffmpeg = _ffmpeg

DEFAULT_FILLER_WORDS = [
    "um", "uh", "you know", "so", "basically",
    "literally", "actually", "right", "okay", "hmm", "ah",
]


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower().strip())


def analyze(words: List[Dict], file_path: str, settings: Dict[str, Any]) -> Dict:
    processing_mode = settings.get("processingMode", "audio_level")
    remove_filler = settings.get("removeFillerWords", False)
    remove_no_speech = settings.get("removeNoSpeech", True)
    silence_thresh_db = int(settings.get("silenceThresholdDb", -40))
    min_silence_ms = int(settings.get("minSilenceDurationMs", 300))
    filler_set = {
        _normalize(w)
        for w in settings.get("fillerWords", DEFAULT_FILLER_WORDS)
    }

    cut_regions: List[Dict] = []

    if processing_mode == "transcription":
        if remove_filler and words:
            for word in words:
                if _normalize(word["word"]) in filler_set:
                    cut_regions.append({
                        "start": round(word["start"], 3),
                        "end": round(word["end"], 3),
                        "reason": "filler_word",
                    })

        if remove_no_speech and words:
            _add_no_speech_cuts(words, cut_regions, min_silence_ms)

    elif processing_mode == "speech":
        from transcribe import extract_audio
        from vad import get_speech_segments, speech_segments_to_cut_regions, get_audio_duration_from_wav
        audio_path = extract_audio(file_path)
        try:
            segs = get_speech_segments(audio_path, min_silence_duration_ms=min_silence_ms)
            dur = get_audio_duration_from_wav(audio_path)
            cut_regions.extend(speech_segments_to_cut_regions(segs, dur, min_silence_ms))
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    else:  # audio_level
        _add_audio_silence_cuts(file_path, cut_regions, silence_thresh_db, min_silence_ms)

    return {"cut_regions": cut_regions}


def _group_speech_segments(words: List[Dict], merge_gap_s: float = 0.5) -> List[Dict]:
    """Group consecutive words separated by gaps smaller than merge_gap_s into segments."""
    if not words:
        return []
    segs = [{"start": words[0]["start"], "end": words[0]["end"]}]
    for w in words[1:]:
        if w["start"] - segs[-1]["end"] < merge_gap_s:
            segs[-1]["end"] = w["end"]
        else:
            segs.append({"start": w["start"], "end": w["end"]})
    return segs


def _add_no_speech_cuts(words, cut_regions, min_ms):
    """Add raw (unpadded) no-speech regions based on word timestamp gaps.
    Padding is applied by the frontend dynamically."""
    segs = _group_speech_segments(words, merge_gap_s=min_ms / 1000)
    if not segs:
        return

    # Leading silence before first word
    if segs[0]["start"] * 1000 >= min_ms:
        cut_regions.append({"start": 0.0, "end": round(segs[0]["start"], 3), "reason": "no_speech"})

    # Gaps between speech segments
    for i in range(len(segs) - 1):
        gap_start = segs[i]["end"]
        gap_end = segs[i + 1]["start"]
        if (gap_end - gap_start) * 1000 >= min_ms:
            cut_regions.append({"start": round(gap_start, 3), "end": round(gap_end, 3), "reason": "no_speech"})


def _add_audio_silence_cuts(file_path, cut_regions, thresh_db, min_ms):
    audio = AudioSegment.from_file(file_path)
    total_ms = len(audio)
    silent_ranges = detect_silence(audio, min_silence_len=min_ms, silence_thresh=thresh_db)
    for start_ms, end_ms in silent_ranges:
        # Return raw silence without padding; frontend will apply padding dynamically.
        cut_regions.append({
            "start": round(start_ms / 1000, 3),
            "end": round(end_ms / 1000, 3),
            "reason": "silence"
        })
    return total_ms


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


def _close_small_gaps(regions: List[Dict], gap_ms: int = 100) -> List[Dict]:
    """Merge adjacent cut regions separated by less than gap_ms."""
    if not regions:
        return []
    threshold = gap_ms / 1000
    result = [dict(regions[0])]
    for r in regions[1:]:
        if r["start"] - result[-1]["end"] <= threshold:
            result[-1]["end"] = max(result[-1]["end"], r["end"])
        else:
            result.append(dict(r))
    return result
