import os
from typing import List, Dict
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom


def build_xml(
    file_path: str,
    keep_segments: List[Dict],
    fps: float = 24.0,
    sequence_name: str = "RapidCut Export",
) -> str:
    """Build a Final Cut Pro 7 XML that DaVinci Resolve can import."""

    def to_frames(seconds: float) -> int:
        return round(seconds * fps)

    abs_path = os.path.abspath(file_path)
    file_uri = "file:///" + abs_path.replace("\\", "/").lstrip("/")
    base_name = os.path.basename(file_path)
    total_frames = sum(to_frames(s["end"] - s["start"]) for s in keep_segments)

    xmeml = Element("xmeml", version="5")
    sequence = SubElement(xmeml, "sequence")
    SubElement(sequence, "name").text = sequence_name
    SubElement(sequence, "duration").text = str(total_frames)

    seq_rate = SubElement(sequence, "rate")
    SubElement(seq_rate, "timebase").text = str(int(fps))
    SubElement(seq_rate, "ntsc").text = "FALSE"

    media = SubElement(sequence, "media")

    for track_type in ("video", "audio"):
        container = SubElement(media, track_type)
        track = SubElement(container, "track")

        timeline_pos = 0
        for i, seg in enumerate(keep_segments):
            duration_frames = to_frames(seg["end"] - seg["start"])
            clip = SubElement(track, "clipitem", id=f"{track_type}-clip-{i + 1}")
            SubElement(clip, "name").text = base_name
            SubElement(clip, "enabled").text = "TRUE"
            SubElement(clip, "duration").text = str(duration_frames)

            clip_rate = SubElement(clip, "rate")
            SubElement(clip_rate, "timebase").text = str(int(fps))
            SubElement(clip_rate, "ntsc").text = "FALSE"

            SubElement(clip, "in").text = str(to_frames(seg["start"]))
            SubElement(clip, "out").text = str(to_frames(seg["end"]))
            SubElement(clip, "start").text = str(timeline_pos)
            SubElement(clip, "end").text = str(timeline_pos + duration_frames)

            file_elem = SubElement(clip, "file", id="source-file-1")
            if i == 0:
                SubElement(file_elem, "name").text = base_name
                SubElement(file_elem, "pathurl").text = file_uri
                f_rate = SubElement(file_elem, "rate")
                SubElement(f_rate, "timebase").text = str(int(fps))
                SubElement(f_rate, "ntsc").text = "FALSE"

            timeline_pos += duration_frames

    raw = tostring(xmeml, encoding="unicode", xml_declaration=False)
    dom = minidom.parseString(raw)
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + dom.toprettyxml(
        indent="  ", encoding=None
    ).split("\n", 1)[1]
