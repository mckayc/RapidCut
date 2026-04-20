import subprocess
import tempfile
import os

FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"

_MODEL_CACHE: dict = {}

# Distil-Whisper models are CTranslate2-converted and hosted by Systran on HuggingFace.
# faster-whisper can load them directly by repo ID.
_DISTIL_MODEL_MAP = {
    "distil-small.en":  "Systran/faster-distil-whisper-small.en",
    "distil-medium.en": "Systran/faster-distil-whisper-medium.en",
    "distil-large-v3":  "Systran/faster-distil-whisper-large-v3",
}


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


def transcribe_file(file_path: str, model_name: str = "base.en") -> dict:
    audio_path = extract_audio(file_path)
    try:
        repo_id = _DISTIL_MODEL_MAP.get(model_name, model_name)
        if model_name not in _MODEL_CACHE:
            from faster_whisper import WhisperModel
            _MODEL_CACHE[model_name] = WhisperModel(
                repo_id,
                device="cpu",
                compute_type="int8",
            )
        model = _MODEL_CACHE[model_name]

        segments, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            # Don't feed previous output back as a prompt — stops the LM from
            # collapsing repeated words and false starts across segment boundaries.
            condition_on_previous_text=False,
            # Raise the ceiling so segments with genuine repetition aren't discarded.
            compression_ratio_threshold=3.0,
            # Prime the decoder toward verbatim output.
            initial_prompt="Transcribe exactly as spoken, including all repeated words, false starts, and filler words.",
            # Skip silent regions before decoding — free speed boost.
            vad_filter=True,
            # Lower the no-speech threshold so short disfluent fragments (false starts,
            # incomplete phrases before a retry) are kept rather than silently dropped.
            # Default is 0.6, which is too aggressive for preserving first attempts.
            no_speech_threshold=0.3,
            # Slight temperature nudges the decoder away from its most "cleaned-up"
            # prediction, making it more likely to transcribe what was actually said.
            temperature=0.2,
        )

        words = []
        for segment in segments:
            for word in segment.words or []:
                text = word.word.strip()
                if text:
                    words.append({
                        "word": text,
                        "start": round(word.start, 3),
                        "end": round(word.end, 3),
                    })

        duration = info.duration or (words[-1]["end"] if words else 0)

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
