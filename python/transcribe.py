import whisper
import subprocess
import tempfile
import os

# Use the explicit path supplied by the Electron host; fall back to PATH lookup.
FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"

_MODEL_CACHE = {}


def extract_audio(video_path: str) -> str:
    """Extract audio track from video to a temporary 16kHz mono WAV."""
    tmp = tempfile.mktemp(suffix=".wav")
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
        if model_name not in _MODEL_CACHE:
            _MODEL_CACHE[model_name] = whisper.load_model(model_name)
        model = _MODEL_CACHE[model_name]
        
        result = model.transcribe(audio_path, word_timestamps=True)

        words = []
        for segment in result.get("segments", []):
            for word in segment.get("words", []):
                text = word["word"].strip()
                if text:
                    words.append({
                        "word": text,
                        "start": round(word["start"], 3),
                        "end": round(word["end"], 3),
                    })

        # Whisper doesn't always return duration; fall back to last word end
        duration = result.get("duration") or (words[-1]["end"] if words else 0)

        return {
            "words": words,
            "duration": round(duration, 3),
            "text": result.get("text", "").strip(),
            "audio_path": audio_path,
        }
    except Exception as e:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
        raise e
