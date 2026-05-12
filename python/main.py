from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json
import os
import subprocess
import sys
import uvicorn
from pydub import AudioSegment

from analyze import analyze
from export import build_xml

_FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"


def _ffprobe_path() -> str:
    if _FFMPEG and _FFMPEG != "ffmpeg":
        ext = os.path.splitext(_FFMPEG)[1]
        probe = os.path.join(os.path.dirname(_FFMPEG), "ffprobe" + ext)
        if os.path.exists(probe):
            return probe
    return "ffprobe"

AudioSegment.converter = _FFMPEG
AudioSegment.ffprobe = _ffprobe_path()

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
    results: dict = {}

    try:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True, text=True)
        results["ffmpeg"] = {"available": True, "version": out.stdout.splitlines()[0]}
    except (subprocess.CalledProcessError, FileNotFoundError):
        results["ffmpeg"] = {"available": False}

    try:
        from pydub import AudioSegment  # noqa: F401
        results["pydub"] = {"available": True}
    except ImportError as e:
        results["pydub"] = {"available": False, "error": str(e)}

    try:
        from silero_vad import load_silero_vad  # noqa: F401
        results["silero_vad"] = {"available": True}
    except ImportError as e:
        results["silero_vad"] = {"available": False, "error": str(e)}

    return results


@app.post("/setup/install-pip")
def install_pip_deps():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    req_path = os.path.join(base_dir, "requirements.txt")
    if not os.path.exists(req_path):
        req_path = os.path.join(base_dir, "..", "requirements.txt")
    req_path = os.path.normpath(req_path)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req_path],
            capture_output=True, text=True, timeout=300,
        )
        return {"success": result.returncode == 0, "output": result.stdout + result.stderr}
    except Exception as e:
        return {"success": False, "output": str(e)}


class ProbeRequest(BaseModel):
    file_path: str


@app.post("/probe")
def probe_endpoint(req: ProbeRequest):
    try:
        result = subprocess.run(
            [_ffprobe_path(), "-v", "error", "-show_entries", "format=duration", "-of", "json", req.file_path],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
        return {"duration": float(data["format"]["duration"])}
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


class ExportRequest(BaseModel):
    file_path: str
    keep_segments: List[Segment]
    fps: float = 24.0
    sequence_name: str = "RapidCut Export"
    save_path: Optional[str] = None


@app.post("/export")
def export_endpoint(req: ExportRequest):
    try:
        segments = [{"start": s.start, "end": s.end} for s in req.keep_segments]
        xml = build_xml(req.file_path, segments, fps=req.fps, sequence_name=req.sequence_name)
        return {"xml": xml}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    print(f"[RapidCut] FFMPEG_PATH={os.environ.get('FFMPEG_PATH', '(not set)')}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
