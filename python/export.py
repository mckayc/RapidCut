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


def get_timecode_string(seconds: float, fps_num: int, fps_den: int) -> str:
    """Converts seconds to HH_MM_SS_FF string."""
    total_frames = round(seconds * fps_num / fps_den)
    fps = fps_num / fps_den
    
    frames = total_frames % round(fps)
    total_seconds = int(seconds)
    ss = total_seconds % 60
    mm = (total_seconds // 60) % 60
    hh = total_seconds // 3600
    
    return f"{hh:02d}_{mm:02d}_{ss:02d}_{frames:02d}"


def build_xml(
    file_path: str,
    keep_segments: List[Dict],
    rendered_titles: List[Dict] = None,  # List of { path, startTime, duration, text }
    fps: float = 30.0,
    sequence_name: str = "RapidCut Export",
) -> str:
    abs_path = os.path.abspath(file_path).replace("\\", "/")
    file_uri = "file:///" + quote(abs_path, safe="/")
    base_name = os.path.basename(file_path)
    uid = hashlib.md5(abs_path.encode()).hexdigest().upper()

    # Probe actual video properties; fall back to user-supplied fps
    width, height, probe_num, probe_den, src_dur = _probe_video(file_path)
    if probe_num and probe_den:
        fps_num, fps_den = _fps_rational(probe_num, probe_den)
    else:
        fps_num, fps_den = _fps_rational(round(fps * 1000), 1000)

    def to_frames(seconds: float) -> int:
        """Convert seconds to an absolute integer frame count."""
        return round(seconds * fps_num / fps_den)

    def to_fcpxml_time(frame_count: int) -> str:
        """Convert an integer frame count to a rational string (e.g., '1001/30000s')."""
        f = Fraction(frame_count * fps_den, fps_num)
        return f"{f.numerator}s" if f.denominator == 1 else f"{f.numerator}/{f.denominator}s"

    frame_dur = _frame_duration(fps_num, fps_den)

    # Asset duration must be the full source file length, not just kept segments
    asset_dur = src_dur or max((s["end"] for s in keep_segments), default=0.0)
    asset_time = to_fcpxml_time(to_frames(asset_dur))

    # Calculate total sequence duration in frames to avoid floating point drift
    total_seq_frames = sum(to_frames(s["end"]) - to_frames(s["start"]) for s in keep_segments)
    seq_time = to_fcpxml_time(total_seq_frames)

    # Create a diagnostic log to embed in the XML for troubleshooting
    diagnostic_lines = [
        "  <!-- RAPIDCUT DIAGNOSTIC LOG",
        f"       Source File: {file_path}",
        f"       Calculated FPS: {fps_num}/{fps_den} ({float(fps_num/fps_den):.3f})",
        f"       Total Keep Segments: {len(keep_segments)}",
    ]
    for i, s in enumerate(keep_segments):
        diagnostic_lines.append(f"       Segment {i:03d}: {s['start']:.3f}s to {s['end']:.3f}s (Frames: {to_frames(s['start'])} to {to_frames(s['end'])})")
    diagnostic_lines.append("  -->")

    # Prepare Title Resources
    title_resources = []
    if rendered_titles:
        for i, t in enumerate(rendered_titles):
            t_abs = os.path.abspath(t['path']).replace("\\", "/")
            # Using absolute file URIs ensures DaVinci Resolve finds the PNGs immediately on the same machine
            # safe="/" ensures : is encoded as %3A, and spaces are naturally encoded as %20 by quote()
            t_uri = "file:///" + quote(t_abs, safe="/")
            title_resources.append(
                f'    <asset id="title_{i}" name="{os.path.basename(t_abs)}" src="{t_uri}"'
                f' format="r1" hasVideo="1" hasAudio="0"/>'
            )

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE fcpxml>',
        '<fcpxml version="1.11">',
        "\n".join(diagnostic_lines),
        '  <resources>',
        f'    <format id="r1" frameDuration="{frame_dur}" width="{width}" height="{height}" colorSpace="1-1-1 (Rec. 709)"/>',
        f'    <asset id="r2" name="{base_name}" uid="{uid}" src="{file_uri}"',
        f'           format="r1" duration="{asset_time}" hasVideo="1" hasAudio="1">',
        f'      <media-rep kind="original-media" src="{file_uri}"/>',
        '    </asset>',
        "\n".join(title_resources),
        '  </resources>',
        '  <library>',
        '    <event name="RapidCut">',
        f'      <project name="{sequence_name}">',
        f'        <sequence format="r1" duration="{seq_time}" tcStart="0s">',
        '          <spine>',
    ]

    timeline_frames = 0
    for seg in keep_segments:
        start_f = to_frames(seg["start"])
        dur_f = to_frames(seg["end"]) - start_f
        if dur_f <= 0:
            continue
        lines.append(
            f'            <asset-clip ref="r2"'
            f' offset="{to_fcpxml_time(timeline_frames)}"'
            f' duration="{to_fcpxml_time(dur_f)}"'
            f' start="{to_fcpxml_time(start_f)}"/>'
        )
        timeline_frames += dur_f

    # Add Titles as connected clips on Lane 1
    # We need to calculate where the title falls relative to the NEW timeline
    if rendered_titles:
        for i, t in enumerate(rendered_titles):
            # Find the offset in the final timeline
            # (This is simplified; a robust version checks if the startTime is within a kept segment)
            # For now, we calculate offset by summing durations of preceding segments
            title_offset_f = 0
            found = False
            for seg in keep_segments:
                if t['startTime'] >= seg['start'] and t['startTime'] < seg['end']:
                    title_offset_f += to_frames(t['startTime'] - seg['start'])
                    found = True
                    break
                title_offset_f += to_frames(seg['end']) - to_frames(seg['start'])
            
            if found:
                fade_duration = to_fcpxml_time(to_frames(0.5)) # 0.5 second fade
                lines.append(
                    f'            <asset-clip ref="title_{i}" lane="1"'
                    f' offset="{to_fcpxml_time(title_offset_f)}"'
                    f' duration="{to_fcpxml_time(to_frames(t.get("duration", 3.0)))}"'
                    f' start="0s" format="r1">'
                )
                if t.get("fadeInOut"):
                    lines.append(f'              <transition name="Cross Dissolve" offset="0s" duration="{fade_duration}" />')
                    # Offset for out-fade is duration minus transition length
                    out_offset = to_fcpxml_time(to_frames(t.get("duration", 3.0)) - to_frames(0.5))
                    lines.append(f'              <transition name="Cross Dissolve" offset="{out_offset}" duration="{fade_duration}" />')
                lines.append('            </asset-clip>')

    lines += [
        '          </spine>',
        '        </sequence>',
        '      </project>',
        '    </event>',
        '  </library>',
        '</fcpxml>',
    ]

    return "\n".join(lines) + "\n"
