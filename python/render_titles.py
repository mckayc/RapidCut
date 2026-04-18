import os
from PIL import Image, ImageDraw, ImageFont

RESOLUTIONS = {
    "1080p": (1920, 1080),
    "4k": (3840, 2160),
    "720p": (1280, 720),
    "vertical": (1080, 1920)
}

def render_title(text, template, output_path, resolution_key="1080p"):
    width, height = RESOLUTIONS.get(resolution_key, (1920, 1080))
    # Create transparent canvas
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Resolve Bounding Box from percentages to pixels
    box = template["box"]
    target_x = (box["x"] / 100) * width
    target_y = (box["y"] / 100) * height
    target_w = (box["width"] / 100) * width
    target_h = (box["height"] / 100) * height

    font_path = template.get("fontPath")
    if not font_path or not os.path.exists(font_path):
        # Fallback to a basic font if system font path is invalid
        font_size = template.get("fontSize", 60)
        font = ImageFont.load_default()
    else:
        font_size = template.get("fontSize", 60)
        if template.get("isDynamic"):
            # Iterative fit logic
            font_size = 10
            while font_size < 500: # Safety cap
                test_font = ImageFont.truetype(font_path, font_size)
                bbox = draw.multiline_textbbox((0, 0), text, font=test_font)
                if (bbox[2] - bbox[0]) > target_w or (bbox[3] - bbox[1]) > target_h:
                    font_size -= 1
                    break
                font_size += 1
        font = ImageFont.truetype(font_path, font_size)

    if font_size < 1:
        font_size = 1 # Prevent invalid font size errors

    # Text color hex to RGB
    color = template.get("color", "#ffffff").lstrip('#')
    rgb = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))

    # Alignment logic
    align = template.get("alignment", "left")
    
    draw.multiline_text(
        (target_x, target_y),
        text,
        font=font,
        fill=rgb + (255,), # Add full alpha
        align=align
    )

    img.save(output_path, "PNG")
    return output_path