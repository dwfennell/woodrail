# Contact sheets for tools/shots/dof.mjs: one per view, the four levels side by side, desktop on top and phone below,
# each labelled. Usage: python3 tools/shots/dof-sheet.py <shots dir> <out dir>
import sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
LEVELS = [("today", "Today"), ("half", "Half strength"), ("tilt", "Tilt-shift hint (far only)"), ("off", "Off")]
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
except OSError:
    font = ImageFont.load_default()
for view in ["close", "mid", "far"]:
    DW, DH = 960, 600  # desktop 1440×900 at 2/3
    PW, PH = 390, 844  # phone 780×1688 at 1/2
    LABEL = 40
    W = 4 * DW + 5 * 10
    H = LABEL + DH + 10 + PH + 10
    sheet = Image.new("RGB", (W, H), (245, 240, 230))
    d = ImageDraw.Draw(sheet)
    for i, (lv, name) in enumerate(LEVELS):
        x = 10 + i * (DW + 10)
        d.text((x, 6), name, fill=(40, 30, 20), font=font)
        sheet.paste(Image.open(f"{src}/dof-desktop-{view}-{lv}.png").convert("RGB").resize((DW, DH), Image.LANCZOS), (x, LABEL))
        sheet.paste(Image.open(f"{src}/dof-phone-{view}-{lv}.png").convert("RGB").resize((PW, PH), Image.LANCZOS), (x + (DW - PW) // 2, LABEL + DH + 10))
    sheet.save(f"{out}/dof-sheet-{view}.jpg", quality=82)
    # The levels at full size, desktop only, for a close look (the phone's are on the sheet).
    for lv, _ in LEVELS:
        Image.open(f"{src}/dof-desktop-{view}-{lv}.png").convert("RGB").save(f"{out}/dof-desktop-{view}-{lv}.jpg", quality=80)
