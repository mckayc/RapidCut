import re
from typing import List, Dict, Any

from pydub import AudioSegment
from pydub.silence import detect_silence

DEFAULT_FILLER_WORDS = [
    "um", "uh", "like", "you know", "so", "basically",
    "literally", "actually", "right", "okay", "hmm", "ah",
]


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower().strip())


def analyze(words: List[Dict], file_path: str, settings: Dict[str, Any]) -> Dict:
    remove_filler = settings.get("removeFillerWords", True)
    remove_silence = settings.get("removeSilence", True)
    silence_mode = settings.get("silenceMode", "no_speech")
    silence_thresh_db = int(settings.get("silenceThresholdDb", -40))
    pre_padding_s = settings.get("preCutPaddingMs", 50) / 1000
    post_padding_s = settings.get("postCutPaddingMs", 50) / 1000
    min_silence_ms = int(settings.get("minSilenceDurationMs", 300))
    filler_set = {
        _normalize(w)
        for w in settings.get("fillerWords", DEFAULT_FILLER_WORDS)
    }

    cut_regions: List[Dict] = []

    if remove_filler and words:
        for word in words:
            if _normalize(word["word"]) in filler_set:
                cut_regions.append({
                    "start": word["start"],
                    "end": word["end"],
                    "reason": "filler_word",
                })

    if remove_silence and words:
        if silence_mode == "no_speech":
            _add_no_speech_cuts(words, cut_regions, pre_padding_s, post_padding_s, min_silence_ms)
        else:
            _add_audio_silence_cuts(
                file_path, cut_regions, silence_thresh_db,
                pre_padding_s, post_padding_s, min_silence_ms,
            )

    merged = _merge_regions(cut_regions)
    return {"cut_regions": merged}


def _add_no_speech_cuts(words, cut_regions, pre_s, post_s, min_ms):
    for i in range(len(words) - 1):
        gap_start = words[i]["end"]
        gap_end = words[i + 1]["start"]
        if (gap_end - gap_start) * 1000 >= min_ms:
            start = gap_start + pre_s
            end = gap_end - post_s
            if end > start:
                cut_regions.append({"start": round(start, 3), "end": round(end, 3), "reason": "no_speech"})


def _add_audio_silence_cuts(file_path, cut_regions, thresh_db, pre_s, post_s, min_ms):
    audio = AudioSegment.from_file(file_path)
    silent_ranges = detect_silence(audio, min_silence_len=min_ms, silence_thresh=thresh_db)
    for start_ms, end_ms in silent_ranges:
        start = start_ms / 1000 + pre_s
        end = end_ms / 1000 - post_s
        if end > start:
            cut_regions.append({"start": round(start, 3), "end": round(end, 3), "reason": "silence"})


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
