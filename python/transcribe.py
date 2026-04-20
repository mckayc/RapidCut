import subprocess
import tempfile
import os

FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"

_MODEL_CACHE: dict = {}

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
        if model_name not in _MODEL_CACHE:
            from faster_whisper import WhisperModel
            _MODEL_CACHE[model_name] = WhisperModel(
                model_name,
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
            # Disable heuristic filters that cause Whisper to skip "repetitive" or "low quality" segments.
            compression_ratio_threshold=None,
            log_prob_threshold=None,
            no_speech_threshold=0.1,
            # Prime the decoder with a "disfluent" example. This trick forces the model to 
            # expect and output stutters and repetitions rather than cleaning them up.
            initial_prompt="Um, uh, I... I just, I just wanted to say. You know, so in order, in order to... transcribe everything exactly verbatim, including every stutter and repetition.",
            # Disable VAD filter to ensure short disfluent fragments aren't skipped.
            vad_filter=False,
            # Higher beam size allows the model to consider more candidates, preventing it 
            # from "settling" on a cleaned-up version of a sentence.
            beam_size=10,
            temperature=0,
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
