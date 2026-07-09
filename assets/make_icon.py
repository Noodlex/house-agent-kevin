"""Generate House Agent Kevin brand icons (original artwork, no HA branding)."""

from PIL import Image, ImageDraw

S = 1024  # supersampled canvas
TEAL = (20, 184, 166, 255)      # #14b8a6 — house
DARK = (15, 118, 110, 255)      # #0f766e — door / chimney
AMBER = (245, 158, 11, 255)     # #f59e0b — lit windows

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Chimney (behind roof)
d.rounded_rectangle([740, 150, 840, 400], radius=16, fill=DARK)

# Roof: a chunky triangle with slight overhang
d.polygon([(512, 90), (990, 470), (34, 470)], fill=TEAL)

# Body
d.rounded_rectangle([120, 450, 904, 950], radius=28, fill=TEAL)

# Two lit windows
d.rounded_rectangle([230, 560, 450, 760], radius=18, fill=AMBER)
d.rounded_rectangle([574, 560, 794, 760], radius=18, fill=AMBER)

# Window cross bars (cut back to teal so panes read at small sizes)
for x0, x1 in ((230, 450), (574, 794)):
    cx = (x0 + x1) // 2
    d.rectangle([cx - 9, 560, cx + 9, 760], fill=TEAL)
    d.rectangle([x0, 651, x1, 669], fill=TEAL)

# Door, lit sliver at the bottom
d.rounded_rectangle([440, 800, 584, 950], radius=14, fill=DARK)
d.rectangle([440, 930, 584, 950], fill=AMBER)

# Trim to content, then pad back to a square
bbox = img.getbbox()
img = img.crop(bbox)
w, h = img.size
side = max(w, h)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(img, ((side - w) // 2, (side - h) // 2))

out = r"C:/Users/chris/AppData/Local/Temp/claude/C--Users-chris-Projets-Zigbee2Mqtt-Proxy/83d92ca1-e1a3-49f1-920b-53c50109a9de/scratchpad"
square.resize((512, 512), Image.LANCZOS).save(f"{out}/icon@2x.png", "PNG", optimize=True)
square.resize((256, 256), Image.LANCZOS).save(f"{out}/icon.png", "PNG", optimize=True)
print("trimmed:", (w, h), "-> square", side)
print("wrote icon.png (256) and icon@2x.png (512)")
