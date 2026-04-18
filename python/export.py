import hashlib
import json
import os
import subprocess
from fractions import Fraction
from urllib.parse import quote
from typing import List, Dict, Tuple

FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"


def _ffprobe() -> str:
    """Return path to ffprobe sibling of the configured ffmpeg."""
    if FFMPEG and FFMPEG != "ffmpeg":
        probe = os.path.join(os.path.dirname(FFMPEG), "ffprobe" + os.path.splitext(FFMPEG)[1])
        if os.path.exists(probe):
            return probe
    return "ffprobe"


def _probe_video(file_path: str) -> Tuple[int, int, int, int, float]:
    """Return (width, height, fps_num, fps_den, source_duration_seconds) via ffprobe."""
    try:
        result = subprocess.run(
            [
                _ffprobe(), "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,r_frame_rate,duration",
                "-show_entries", "format=duration",
                "-of", "json",
                file_path,
            ],
            capture_output=True, text=True, timeout=10,
        )
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        w, h = int(stream["width"]), int(stream["height"])
        num, den = map(int, stream["r_frame_rate"].split("/"))
        # Prefer stream duration; fall back to container duration
        raw_dur = stream.get("duration") or data.get("format", {}).get("duration")
        src_dur = float(raw_dur) if raw_dur else 0.0
        return w, h, num, den, src_dur
    except Exception:
        return 1920, 1080, 30, 1, 0.0


def _fps_rational(fps_num: int, fps_den: int) -> Tuple[int, int]:
    """
    Reduce the frame-rate fraction and normalise common NTSC rates.
    Returns (timebase_num, timebase_den) where frame_duration = den/num seconds.
    e.g. 30000/1001 → num=30000, den=1001 so frameDuration="1001/30000s"
    """
    f = Fraction(fps_num, fps_den)
    return f.numerator, f.denominator


def _t(seconds: float, fps_num: int, fps_den: int) -> str:
    """
    Convert a time in seconds to an FCPXML rational time string.
    frame_index = round(seconds * fps_num / fps_den)
    time        = frame_index * fps_den / fps_num  seconds
    """
    frame = round(seconds * fps_num / fps_den)
    t_num = frame * fps_den
    t_den = fps_num
    # Reduce the fraction for cleanliness
    f = Fraction(t_num, t_den)
    if f.denominator == 1:
        return f"{f.numerator}s"
    return f"{f.numerator}/{f.denominator}s"


def _frame_duration(fps_num: int, fps_den: int) -> str:
    """frameDuration attribute value: den/num s (e.g. '1001/30000s' for 29.97)."""
    f = Fraction(fps_den, fps_num)
    if f.denominator == 1:
        return f"{f.numerator}s"
    return f"{f.numerator}/{f.denominator}s"


def build_xml(
    file_path: str,
    keep_segments: List[Dict],
    fps: float = 30.0,
    sequence_name: str = "RapidCut Export",
) -> str:
    abs_path = os.path.abspath(file_path).replace("\\", "/")
    file_uri = "file:///" + quote(abs_path.lstrip("/"))
    base_name = os.path.basename(file_path)
    uid = hashlib.md5(abs_path.encode()).hexdigest().upper()

    # Probe actual video properties; fall back to user-supplied fps
    width, height, probe_num, probe_den, src_dur = _probe_video(file_path)
    if probe_num and probe_den:
        fps_num, fps_den = _fps_rational(probe_num, probe_den)
    else:
        fps_num, fps_den = _fps_rational(round(fps * 1000), 1000)

    frame_dur = _frame_duration(fps_num, fps_den)

    # Asset duration must be the full source file length, not just kept segments
    asset_dur = src_dur or max((s["end"] for s in keep_segments), default=0.0)
    asset_time = _t(asset_dur, fps_num, fps_den)

    timeline_seconds = sum(s["end"] - s["start"] for s in keep_segments)
    seq_time = _t(timeline_seconds, fps_num, fps_den)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE fcpxml>',
        '<fcpxml version="1.11">',
        '  <resources>',
        f'    <format id="r1" frameDuration="{frame_dur}" width="{width}" height="{height}" colorSpace="1-1-1 (Rec. 709)"/>',
        f'    <asset id="r2" name="{base_name}" uid="{uid}" src="{file_uri}"',
        f'           format="r1" duration="{asset_time}" hasVideo="1" hasAudio="1">',
        f'      <media-rep kind="original-media" src="{file_uri}"/>',
        '    </asset>',
        '  </resources>',
        '  <library>',
        '    <event name="RapidCut">',
        f'      <project name="{sequence_name}">',
        f'        <sequence format="r1" duration="{seq_time}" tcStart="0s">',
        '          <spine>',
    ]

    def frames(seconds: float) -> int:
        return round(seconds * fps_num / fps_den)

    def ft(frame_count: int) -> str:
        f = Fraction(frame_count * fps_den, fps_num)
        return f"{f.numerator}s" if f.denominator == 1 else f"{f.numerator}/{f.denominator}s"

    timeline_frames = 0
    for seg in keep_segments:
        start_f = frames(seg["start"])
        dur_f = frames(seg["end"]) - start_f
        lines.append(
            f'            <asset-clip ref="r2"'
            f' offset="{ft(timeline_frames)}"'
            f' duration="{ft(dur_f)}"'
            f' start="{ft(start_f)}"/>'
        )
        timeline_frames += dur_f

    lines += [
        '          </spine>',
        '        </sequence>',
        '      </project>',
        '    </event>',
        '  </library>',
        '</fcpxml>',
    ]

    return "\n".join(lines) + "\n"
