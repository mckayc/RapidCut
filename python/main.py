from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

from transcribe import transcribe_file
from analyze import analyze
from export import build_xml

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


class ExportRequest(BaseModel):
    file_path: str
    keep_segments: List[Segment]
    fps: float = 24.0
    sequence_name: str = "RapidCut Export"


@app.post("/export")
def export_endpoint(req: ExportRequest):
    try:
        segments = [{"start": s.start, "end": s.end} for s in req.keep_segments]
        xml = build_xml(req.file_path, segments, req.fps, req.sequence_name)
        return {"xml": xml}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
