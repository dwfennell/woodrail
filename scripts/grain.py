# The HUD's wood grain (style.css --grain): one tileable tile, brown with alpha (transparent = no grain), laid over a
# board's own colour, so the same ~2 kB tile darkens beech, maple or stained oak alike, with no blend mode.
# Long grain as on a sawn board: fine, nearly straight lines that drift a little, fade in and out along their length,
# and a few short dark pores. 256x256, seamless both ways. Run: python3 scripts/grain.py (writes src/assets/grain.webp).
import numpy as np
from PIL import Image

W = H = 256
rng = np.random.default_rng(11)
y = np.arange(H)[:, None].astype(float)
x = np.arange(W)[None, :].astype(float)
dark = np.zeros((H, W))

def drift(amp):
    # a gentle wander of the line across the tile, in whole waves so it tiles
    return sum(rng.uniform(-amp, amp) * np.sin(2 * np.pi * k * x / W + rng.uniform(0, 6.3)) for k in (1, 2))

for _ in range(46):
    y0 = rng.uniform(0, H)
    width = rng.uniform(0.5, 1.6)
    strength = rng.uniform(0.02, 0.09)
    yy = y0 + drift(1.8)
    d = np.abs(((y - yy) + H / 2) % H - H / 2)  # distance, wrapped top to bottom
    fade = 0.55 + 0.45 * np.sin(2 * np.pi * rng.integers(1, 3) * x / W + rng.uniform(0, 6.3))
    dark += strength * fade * np.exp(-(d / width) ** 2)

# a broad soft band or two: the latewood
for _ in range(3):
    y0 = rng.uniform(0, H)
    d = np.abs(((y - (y0 + drift(3))) + H / 2) % H - H / 2)
    dark += 0.035 * np.exp(-(d / 9) ** 2)

# pores: short dark dashes along the grain
for _ in range(140):
    px, py = rng.uniform(0, W), rng.integers(0, H)
    length = rng.uniform(3, 9)
    dx = np.abs(((x - px) + W / 2) % W - W / 2)
    dark[py] += 0.06 * np.exp(-(dx / length) ** 2)[0]

# A dark brown, as opaque as the grain is dark there (multiply by beech gave the same look).
alpha = np.clip(dark * 1.35, 0, 1)
rgba = np.zeros((H, W, 4), np.uint8)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = 92, 52, 16
rgba[..., 3] = (alpha * 255).astype(np.uint8)
out = __import__("pathlib").Path(__file__).resolve().parent.parent / "src/assets/grain.webp"
Image.fromarray(rgba, "RGBA").save(out, quality=80, alpha_quality=80, method=6)
