from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json
import os
import subprocess
import tempfile
import sys
import uvicorn

from transcribe import transcribe_file
from analyze import analyze
from export import build_xml
from render_titles import render_title

_FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"


def _ts_filename(start_time: float) -> str:
    """Convert seconds to a HH_MM_SS_cc.png filename (cc = centiseconds)."""
    total_s = int(start_time)
    cc = round((start_time % 1) * 100)
    h = total_s // 3600
    m = (total_s % 3600) // 60
    s = total_s % 60
    return f"{h:02d}_{m:02d}_{s:02d}_{cc:02d}.png"


def _ffprobe_path() -> str:
    if _FFMPEG and _FFMPEG != "ffmpeg":
        ext = os.path.splitext(_FFMPEG)[1]
        probe = os.path.join(os.path.dirname(_FFMPEG), "ffprobe" + ext)
        if os.path.exists(probe):
            return probe
    return "ffprobe"

app = FastAPI(title="RapidCut API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/setup/check")
def check_deps():
    """Return availability of runtime dependencies."""
    results: dict = {}

    # ffmpeg
    try:
        out = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, check=True, text=True
        )
        version_line = out.stdout.splitlines()[0] if out.stdout else "unknown"
        results["ffmpeg"] = {"available": True, "version": version_line}
    except (subprocess.CalledProcessError, FileNotFoundError):
        results["ffmpeg"] = {"available": False}

    # whisper
    try:
        import whisper  # noqa: F401
        results["whisper"] = {"available": True}
    except ImportError as e:
        results["whisper"] = {"available": False, "error": str(e)}

    # pydub
    try:
        from pydub import AudioSegment  # noqa: F401
        results["pydub"] = {"available": True}
    except ImportError as e:
        results["pydub"] = {"available": False, "error": str(e)}

    # pillow (PIL) - Required for Title Rendering
    try:
        from PIL import Image  # noqa: F401
        results["pillow"] = {"available": True}
    except ImportError as e:
        results["pillow"] = {"available": False, "error": str(e)}

    return results


@app.post("/setup/install-pip")
def install_pip_deps():
    """Re-install Python dependencies from requirements.txt."""
    import os
    req_path = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")
    req_path = os.path.normpath(req_path)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req_path],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return {
            "success": result.returncode == 0,
            "output": result.stdout + result.stderr,
        }
    except Exception as e:
        return {"success": False, "output": str(e)}


class ProbeRequest(BaseModel):
    file_path: str


@app.post("/probe")
def probe_endpoint(req: ProbeRequest):
    """Return basic metadata (duration) for a media file via ffprobe."""
    try:
        result = subprocess.run(
            [
                _ffprobe_path(), "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                req.file_path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])
        return {"duration": duration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TranscribeRequest(BaseModel):
    file_path: str
    model: str = "base.en"


@app.post("/transcribe")
def transcribe_endpoint(req: TranscribeRequest):
    try:
        return transcribe_file(req.file_path, req.model)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AnalyzeRequest(BaseModel):
    words: list
    file_path: str
    settings: dict


@app.post("/analyze")
def analyze_endpoint(req: AnalyzeRequest):
    try:
        return analyze(req.words, req.file_path, req.settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class Segment(BaseModel):
    start: float
    end: float


class TitleItem(BaseModel):
    text: str
    startTime: float
    duration: float = 3.0
    templateId: Optional[str] = None


class ExportRequest(BaseModel):
    file_path: str
    keep_segments: List[Segment]
    fps: float = 24.0
    sequence_name: str = "RapidCut Export"
    titles: Optional[List[TitleItem]] = None
    templates: Optional[List[dict]] = None
    resolution: Optional[str] = "1080p"
    save_path: Optional[str] = None


@app.post("/export")
def export_endpoint(req: ExportRequest):
    try:
        segments = [{"start": s.start, "end": s.end} for s in req.keep_segments]

        rendered_titles = None
        if req.titles and req.templates and len(req.templates) > 0:
            templates_by_id = {t["id"]: t for t in req.templates if "id" in t}
            fallback_template = req.templates[0]

            TITLES_FOLDER = "Title PNGs"
            if req.save_path:
                save_dir = os.path.dirname(os.path.abspath(req.save_path))
                titles_dir = os.path.join(save_dir, TITLES_FOLDER)
            else:
                titles_dir = tempfile.mkdtemp(prefix="rapidcut_titles_")
                TITLES_FOLDER = None  # no relative path available without a save location

            os.makedirs(titles_dir, exist_ok=True)
            rendered_titles = []
            for t in req.titles:
                template = templates_by_id.get(t.templateId, fallback_template) if t.templateId else fallback_template
                filename = _ts_filename(t.startTime)
                out_path = os.path.join(titles_dir, filename)
                render_title(t.text, template, out_path, req.resolution or "1080p")
                rendered_titles.append({
                    "path": out_path,
                    "rel_path": f"{TITLES_FOLDER}/{filename}" if TITLES_FOLDER else None,
                    "startTime": t.startTime,
                    "duration": t.duration,
                    "text": t.text,
                })

        xml = build_xml(
            req.file_path,
            segments,
            rendered_titles=rendered_titles,
            fps=req.fps,
            sequence_name=req.sequence_name,
        )
        return {"xml": xml}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import os
    print(f"[RapidCut] FFMPEG_PATH={os.environ.get('FFMPEG_PATH', '(not set)')}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
