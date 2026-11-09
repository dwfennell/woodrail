# A contact sheet of one direction's four screens (for looking, and the write-up's overview), at 390 wide each.
import sys
from PIL import Image
out, names = sys.argv[1], sys.argv[2:]
ims = [Image.open(n).resize((390, 844), Image.LANCZOS) for n in names]
W = Image.new("RGB", (400 * len(ims) - 10, 844), "white")
for i, im in enumerate(ims): W.paste(im, (i * 400, 0))
W.save(out, quality=86)
