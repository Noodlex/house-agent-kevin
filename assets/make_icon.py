"""Generate House Agent Kevin brand icons.

Original artwork (no Home Assistant branding, as required for custom integrations):
a teal house with lit amber windows, each showing a silhouette — a nod to Home
Alone, where Kevin parades cardboard cutouts past the windows to fake a party.

Run from this directory: `python make_icon.py`
"""

from PIL import Image, ImageDraw

S = 1024  # supersampled canvas, downscaled at the end
TEAL = (20, 184, 166, 255)   # #14b8a6 — house
DARK = (15, 118, 110, 255)   # #0f766e — door, chimney
AMBER = (245, 158, 11, 255)  # #f59e0b — lit windows
SIL = (11, 74, 70, 255)      # silhouettes behind the curtains

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def standing(ox: int, oy: int) -> None:
    """A figure standing still."""
    d.ellipse([ox + 88, oy + 38, ox + 152, oy + 102], fill=SIL)
    d.polygon([(ox + 85, oy + 112), (ox + 155, oy + 112), (ox + 172, oy + 225), (ox + 68, oy + 225)], fill=SIL)


def cheering(ox: int, oy: int) -> None:
    """A figure with both arms up — the party cutout."""
    d.ellipse([ox + 92, oy + 44, ox + 148, oy + 100], fill=SIL)
    d.polygon([(ox + 90, oy + 110), (ox + 150, oy + 110), (ox + 166, oy + 225), (ox + 74, oy + 225)], fill=SIL)
    for x2 in (ox + 34, ox + 206):
        d.line([(ox + 120, oy + 128), (x2, oy + 52)], fill=SIL, width=26)
        d.ellipse([x2 - 15, oy + 37, x2 + 15, oy + 67], fill=SIL)


# Chimney (drawn first so the roof overlaps it)
d.rounded_rectangle([742, 150, 842, 400], radius=16, fill=DARK)

# Roof
d.polygon([(512, 90), (990, 470), (34, 470)], fill=TEAL)

# Body
d.rounded_rectangle([120, 450, 904, 950], radius=28, fill=TEAL)

# Lit windows + silhouettes
for x0 in (215, 569):
    d.rounded_rectangle([x0, 555, x0 + 240, 795], radius=18, fill=AMBER)

standing(215, 555)
cheering(569, 555)

# Door with a sliver of light underneath
d.rounded_rectangle([440, 822, 584, 950], radius=14, fill=DARK)
d.rectangle([440, 932, 584, 950], fill=AMBER)

# Trim to content, then pad back to a 1:1 square (brands requires square)
bbox = img.getbbox()
img = img.crop(bbox)
w, h = img.size
side = max(w, h)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(img, ((side - w) // 2, (side - h) // 2))

square.resize((512, 512), Image.LANCZOS).save("icon@2x.png", "PNG", optimize=True)
square.resize((256, 256), Image.LANCZOS).save("icon.png", "PNG", optimize=True)
print(f"trimmed {w}x{h} -> square {side}; wrote icon.png (256) and icon@2x.png (512)")
