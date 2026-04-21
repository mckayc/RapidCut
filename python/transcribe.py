import subprocess
import tempfile
import os

FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"

try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
except ImportError:
    DEVICE = "cpu"

try:
    import whisperx as _whisperx
    WHISPERX_AVAILABLE = True
except ImportError:
    _whisperx = None  # type: ignore
    WHISPERX_AVAILABLE = False

_MODEL_CACHE: dict = {}
_ALIGN_MODEL_CACHE: dict = {}  # keyed by f"{language}_{device}"


def extract_audio(video_path: str) -> str:
    """Extract audio track from video to a temporary 16kHz mono WAV."""
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(
            [
                FFMPEG, "-i", video_path,
                "-vn", "-acodec", "pcm_s16le",
                "-ar", "16000", "-ac", "1",
                tmp, "-y"
            ],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError:
        raise RuntimeError(
            f"ffmpeg not found at '{FFMPEG}'. "
            "Install ffmpeg or restart the app after installation."
        )
    return tmp


def transcribe_file(
    file_path: str,
    model_name: str = "base.en",
    min_silence_duration_ms: int = 300,
    min_speech_duration_ms: int = 100,
) -> dict:
    # Backwards compat: presets saved with the old "words-" prefix still work.
    if model_name.startswith("words-"):
        model_name = model_name.replace("words-", "")

    is_whisperx = model_name.startswith("whisperx-")

    audio_path = extract_audio(file_path)
    try:
        from vad import get_speech_segments, get_audio_duration_from_wav, extract_segment_to_wav

        speech_segments = get_speech_segments(
            audio_path,
            min_silence_duration_ms=min_silence_duration_ms,
            min_speech_duration_ms=min_speech_duration_ms,
        )
        duration = get_audio_duration_from_wav(audio_path)

        if not speech_segments:
            os.unlink(audio_path)
            return {"words": [], "duration": round(duration, 3), "text": "", "audio_path": None}

        if model_name not in _MODEL_CACHE:
            from faster_whisper import WhisperModel
            actual_model = model_name.replace("whisperx-", "")
            _MODEL_CACHE[model_name] = {
                "model": WhisperModel(
                    actual_model,
                    device=DEVICE,
                    compute_type="float16" if DEVICE == "cuda" else "int8",
                ),
                "type": "whisperx" if is_whisperx else "standard",
            }

        cache_entry = _MODEL_CACHE[model_name]
        model = cache_entry["model"]

        # Transcribe each VAD speech segment independently.
        # Giving Whisper a small isolated segment (instead of the full file) prevents
        # it from skipping short disfluencies like isolated "and... and..." false starts.
        seg_list = []  # for whisperx alignment: [{text, start, end}]
        words: list = []

        for seg in speech_segments:
            seg_path = extract_segment_to_wav(audio_path, seg["start"], seg["end"])
            try:
                seg_out, _ = model.transcribe(
                    seg_path,
                    word_timestamps=True,
                    compression_ratio_threshold=2.4,
                    log_prob_threshold=-1.0,
                    no_speech_threshold=0.3,
                    temperature=[0, 0.2, 0.4, 0.6, 0.8, 1.0],
                    condition_on_previous_text=False,
                    initial_prompt="Um, uh, you know, so, basically, literally, actually, right, okay, hmm, ah.",
                    vad_filter=False,
                    beam_size=5,
                )

                if is_whisperx:
                    for s in seg_out:
                        seg_list.append({
                            "text": s.text,
                            "start": round(s.start + seg["start"], 3),
                            "end": round(s.end + seg["start"], 3),
                        })
                else:
                    for segment in seg_out:
                        for word in segment.words or []:
                            text = word.word.strip()
                            if text:
                                words.append({
                                    "word": text,
                                    "start": round(word.start + seg["start"], 3),
                                    "end": round(word.end + seg["start"], 3),
                                })
            finally:
                if os.path.exists(seg_path):
                    os.unlink(seg_path)

        if is_whisperx:
            if not WHISPERX_AVAILABLE:
                raise RuntimeError("whisperx is not installed. Please reinstall Python dependencies.")
            if not seg_list:
                return {"words": [], "duration": round(duration, 3), "text": "", "audio_path": audio_path}

            # Detect language from the first segment text (faster-whisper info not available per-seg here)
            # Fall back to "en" — acceptable since whisperx alignment is language-guided anyway.
            language = "en"
            align_key = f"{language}_{DEVICE}"
            if align_key not in _ALIGN_MODEL_CACHE:
                _ALIGN_MODEL_CACHE[align_key] = _whisperx.load_align_model(
                    language_code=language, device=DEVICE
                )
            model_a, metadata = _ALIGN_MODEL_CACHE[align_key]
            result = _whisperx.align(
                seg_list, model_a, metadata, audio_path, DEVICE, return_char_alignments=False
            )
            for w in result["word_segments"]:
                if "start" in w and "end" in w:
                    words.append({
                        "word": w["word"].strip(),
                        "start": round(w["start"], 3),
                        "end": round(w["end"], 3),
                    })

        return {
            "words": words,
            "duration": round(duration, 3),
            "text": " ".join(w["word"] for w in words),
            "audio_path": audio_path,
        }
    except Exception as e:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
        raise e
