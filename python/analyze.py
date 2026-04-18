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
    pre_padding_s = settings.get("preCutPaddingMs", 50) / 1000
    post_padding_s = settings.get("postCutPaddingMs", 50) / 1000
    min_silence_ms = int(settings.get("minSilenceDurationMs", 300))
    filler_set = {
        _normalize(w)
        for w in settings.get("fillerWords", DEFAULT_FILLER_WORDS)
    }

    cut_regions: List[Dict] = []

    if processing_mode == "speech":
        if remove_filler and words:
            # Extend each filler cut back to the previous word's end so the
            # inter-word gap before the filler is included in the cut.  This
            # prevents a phantom clip between the preceding speech and the filler.
            for i, word in enumerate(words):
                if _normalize(word["word"]) in filler_set:
                    cut_start = words[i - 1]["end"] if i > 0 else 0.0
                    cut_regions.append({
                        "start": round(cut_start, 3),
                        "end": round(word["end"] + 0.05, 3),
                        "reason": "filler_word",
                    })

        if remove_no_speech:
            # Whisper timestamps compress silence, making gap-based detection
            # unreliable — use audio level detection for accurate silence removal.
            total_ms = _add_audio_silence_cuts(
                file_path, cut_regions, silence_thresh_db,
                pre_padding_s, post_padding_s, min_silence_ms,
            )

            # Use Whisper word boundaries to definitively cut leading and trailing
            # content — pydub often misses the last few hundred ms of room noise.
            if words:
                duration = total_ms / 1000.0
                first_start = words[0]["start"]
                last_end = words[-1]["end"]
                if first_start > post_padding_s:
                    cut_regions.append({
                        "start": 0.0,
                        "end": round(first_start - post_padding_s, 3),
                        "reason": "no_speech",
                    })
                if duration - last_end > pre_padding_s:
                    cut_regions.append({
                        "start": round(last_end + pre_padding_s, 3),
                        "end": round(duration, 3),
                        "reason": "no_speech",
                    })
    else:
        _add_audio_silence_cuts(
            file_path, cut_regions, silence_thresh_db,
            pre_padding_s, post_padding_s, min_silence_ms,
        )

    merged = _merge_regions(cut_regions)
    merged = _close_small_gaps(merged, gap_ms=200)
    return {"cut_regions": merged}


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


def _add_no_speech_cuts(words, cut_regions, pre_s, post_s, min_ms):
    # Use the same threshold for grouping words into segments as for cutting gaps.
    # This means the Minimum Gap Duration slider controls both between-sentence
    # silences AND slow/deliberate pauses within a sentence.
    segs = _group_speech_segments(words, merge_gap_s=min_ms / 1000)
    if not segs:
        return

    # Leading silence before first speech segment
    if segs[0]["start"] * 1000 >= min_ms:
        end = segs[0]["start"] - post_s
        if end > 0:
            cut_regions.append({"start": 0.0, "end": round(end, 3), "reason": "no_speech"})

    # Gaps between speech segments
    for i in range(len(segs) - 1):
        gap_start = segs[i]["end"]
        gap_end = segs[i + 1]["start"]
        if (gap_end - gap_start) * 1000 >= min_ms:
            start = gap_start + pre_s
            end = gap_end - post_s
            if end > start:
                cut_regions.append({"start": round(start, 3), "end": round(end, 3), "reason": "no_speech"})


def _add_audio_silence_cuts(file_path, cut_regions, thresh_db, pre_s, post_s, min_ms):
    audio = AudioSegment.from_file(file_path)
    total_ms = len(audio)
    silent_ranges = detect_silence(audio, min_silence_len=min_ms, silence_thresh=thresh_db)
    for start_ms, end_ms in silent_ranges:
        # Don't add pre-padding for silence that starts at the very beginning of the file,
        # and don't subtract post-padding for silence that ends at the very end — both
        # cases would leave a tiny phantom kept segment with no speech to protect.
        actual_pre = 0.0 if start_ms == 0 else pre_s
        actual_post = 0.0 if end_ms >= total_ms else post_s
        start = start_ms / 1000 + actual_pre
        end = end_ms / 1000 - actual_post
        if end > start:
            cut_regions.append({"start": round(start, 3), "end": round(end, 3), "reason": "silence"})
    return total_ms


def _merge_regions(regions: List[Dict]) -> List[Dict]:
    if not regions:
        return []
    sorted_r = sorted(regions, key=lambda r: r["start"])
    merged = [dict(sorted_r[0])]
    for r in sorted_r[1:]:
        if r["start"] <= merged[-1]["end"]:
            merged[-1]["end"] = max(merged[-1]["end"], r["end"])
        else:
            merged.append(dict(r))
    return merged


def _close_small_gaps(regions: List[Dict], gap_ms: int = 100) -> List[Dict]:
    """Merge adjacent cut regions separated by less than gap_ms.
    Prevents tiny kept clips between consecutive filler word cuts or close no-speech cuts."""
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
