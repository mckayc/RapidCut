import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RESOLUTIONS = {
    "1080p": (1920, 1080),
    "4k": (3840, 2160),
    "720p": (1280, 720),
    "vertical": (1080, 1920)
}


def _wrap_text(draw, text, font, max_width):
    """Word-wrap text to fit within max_width pixels. Returns a newline-joined string."""
    words = text.split()
    if not words:
        return text
    lines = []
    current = []
    for word in words:
        candidate = ' '.join(current + [word])
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if current and (bbox[2] - bbox[0]) > max_width:
            lines.append(' '.join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(' '.join(current))
    return '\n'.join(lines)


def render_title(text, template, output_path, resolution_key="1080p"):
    width, height = RESOLUTIONS.get(resolution_key, (1920, 1080))
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    box = template["box"]
    target_x = (box["x"] / 100) * width
    target_y = (box["y"] / 100) * height
    target_w = (box["width"] / 100) * width
    target_h = (box["height"] / 100) * height

    font_path = template.get("fontPath")
    align = template.get("alignment", "left")

    if not font_path or not os.path.exists(font_path):
        # PIL default font is tiny; render at a fixed large size using a system fallback
        font_size = int(target_h * 0.6)
        try:
            # Try common system fonts as a better fallback
            for fallback in ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
                try:
                    font = ImageFont.truetype(fallback, max(1, font_size))
                    break
                except (IOError, OSError):
                    continue
            else:
                font = ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
        wrapped = _wrap_text(draw, text, font, target_w)
    else:
        font_size = template.get("fontSize", 60)
        if template.get("isDynamic"):
            # Binary search for the largest font size whose wrapped text fits the box
            lo, hi = 1, 500
            best = lo
            while lo <= hi:
                mid = (lo + hi) // 2
                test_font = ImageFont.truetype(font_path, mid)
                wrapped = _wrap_text(draw, text, test_font, target_w)
                bbox = draw.multiline_textbbox((0, 0), wrapped, font=test_font)
                fits = (bbox[2] - bbox[0]) <= target_w and (bbox[3] - bbox[1]) <= target_h
                if fits:
                    best = mid
                    lo = mid + 1
                else:
                    hi = mid - 1
            font_size = max(1, best)
        font = ImageFont.truetype(font_path, font_size)
        wrapped = _wrap_text(draw, text, font, target_w)

    color = template.get("color", "#ffffff").lstrip('#')
    rgb = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))

    # Drop shadow — rendered on a separate layer so blur doesn't bleed onto text
    if template.get("shadowEnabled"):
        shadow_hex = template.get("shadowColor", "#000000").lstrip('#')
        shadow_rgb = tuple(int(shadow_hex[i:i+2], 16) for i in (0, 2, 4))
        sx = int(template.get("shadowOffsetX", 3))
        sy = int(template.get("shadowOffsetY", 3))
        blur = max(0, int(template.get("shadowBlur", 4)))
        shadow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shadow_draw.multiline_text(
            (target_x + sx, target_y + sy),
            wrapped,
            font=font,
            fill=shadow_rgb + (200,),
            align=align,
        )
        if blur > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))
        img = Image.alpha_composite(img, shadow_layer)
        draw = ImageDraw.Draw(img)

    draw.multiline_text(
        (target_x, target_y),
        wrapped,
        font=font,
        fill=rgb + (255,),
        align=align,
    )

    img.save(output_path, "PNG")
    return output_path
