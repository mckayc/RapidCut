import os
import tempfile
import wave

_VAD_MODEL = None


def _get_model():
    global _VAD_MODEL
    if _VAD_MODEL is None:
        from silero_vad import load_silero_vad
        _VAD_MODEL = load_silero_vad()
    return _VAD_MODEL


def get_speech_segments(
    audio_path: str,
    min_silence_duration_ms: int = 300,
    min_speech_duration_ms: int = 100,
) -> list:
    """Run Silero VAD on a 16kHz mono WAV. Returns [{"start": float, "end": float}] in seconds."""
    from silero_vad import read_audio, get_speech_timestamps
    model = _get_model()
    wav = read_audio(audio_path, sampling_rate=16000)
    raw = get_speech_timestamps(
        wav, model,
        sampling_rate=16000,
        min_silence_duration_ms=min_silence_duration_ms,
        min_speech_duration_ms=min_speech_duration_ms,
        return_seconds=True,
    )
    return [{"start": round(t["start"], 3), "end": round(t["end"], 3)} for t in raw]


def speech_segments_to_cut_regions(
    speech_segments: list,
    audio_duration: float,
    min_silence_duration_ms: int = 300,
) -> list:
    """Invert speech segments into no_speech cut regions.

    Returns raw timestamps with no padding applied — frontend applies padding dynamically,
    matching the contract of _add_no_speech_cuts() in analyze.py.
    """
    min_s = min_silence_duration_ms / 1000
    cuts = []

    if not speech_segments:
        if audio_duration > 0:
            cuts.append({"start": 0.0, "end": round(audio_duration, 3), "reason": "no_speech"})
        return cuts

    if speech_segments[0]["start"] >= min_s:
        cuts.append({"start": 0.0, "end": speech_segments[0]["start"], "reason": "no_speech"})

    for i in range(len(speech_segments) - 1):
        gap_s = speech_segments[i]["end"]
        gap_e = speech_segments[i + 1]["start"]
        if (gap_e - gap_s) >= min_s:
            cuts.append({"start": round(gap_s, 3), "end": round(gap_e, 3), "reason": "no_speech"})

    return cuts


def get_audio_duration_from_wav(audio_path: str) -> float:
    with wave.open(audio_path, "rb") as wf:
        return wf.getnframes() / wf.getframerate()


def extract_segment_to_wav(audio_path: str, start_s: float, end_s: float) -> str:
    """Extract a time slice from a WAV to a new temp WAV. Caller must unlink the returned path."""
    with wave.open(audio_path, "rb") as wf:
        sr = wf.getframerate()
        n_ch = wf.getnchannels()
        sw = wf.getsampwidth()
        wf.setpos(int(start_s * sr))
        n_frames = int((end_s - start_s) * sr)
        chunk = wf.readframes(max(n_frames, 0))

    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(tmp, "wb") as out:
        out.setnchannels(n_ch)
        out.setsampwidth(sw)
        out.setframerate(sr)
        out.writeframes(chunk)
    return tmp
