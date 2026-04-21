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
            actual_model = model_name.replace("whisperx-", "")
            _MODEL_CACHE[model_name] = {
                "model": WhisperModel(
                    actual_model,
                    device=DEVICE,
                    compute_type="float16" if DEVICE == "cuda" else "int8",
                ),
                "type": "whisperx" if model_name.startswith("whisperx-") else "standard"
            }
        
        cache_entry = _MODEL_CACHE[model_name]
        model = cache_entry["model"]

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
        if cache_entry["type"] == "whisperx":
            if not WHISPERX_AVAILABLE:
                raise RuntimeError("whisperx is not installed. Please reinstall Python dependencies.")
            language = info.language or "en"
            seg_list = [{"text": s.text, "start": s.start, "end": s.end} for s in segments]
            model_a, metadata = _whisperx.load_align_model(language_code=language, device=DEVICE)
            result = _whisperx.align(seg_list, model_a, metadata, audio_path, DEVICE, return_char_alignments=False)
            
            for w in result["word_segments"]:
                # Only include words that were successfully aligned
                if "start" in w and "end" in w:
                    words.append({
                        "word": w["word"].strip(),
                        "start": round(w["start"], 3),
                        "end": round(w["end"], 3)
                    })
        else:
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
