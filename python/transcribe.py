import whisper
import subprocess
import tempfile
import os


def extract_audio(video_path: str) -> str:
    """Extract audio track from video to a temporary 16kHz mono WAV."""
    tmp = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        [
            "ffmpeg", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le",
            "-ar", "16000", "-ac", "1",
            tmp, "-y"
        ],
        check=True,
        capture_output=True,
    )
    return tmp


def transcribe_file(file_path: str, model_name: str = "base.en") -> dict:
    audio_path = extract_audio(file_path)
    try:
        model = whisper.load_model(model_name)
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
        }
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
