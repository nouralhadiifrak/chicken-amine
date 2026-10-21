"""
Cuts the logo into the four layers the intro animates: rooster (with the C), "hicken", "AMINE"
and the sprig. Stacked, the layers rebuild the logo exactly.
    pip install pillow numpy scipy
    python3 tools/intro-layers.py      # assets/logo-1200.png -> assets/intro/*.png
Each solid shape of the logo is grouped by colour and position (component bounding boxes below);
soft edge and glow pixels go to the nearest shape. Check the result if the logo changes.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.join(os.path.dirname(__file__), "..")
src = Image.open(os.path.join(ROOT, "assets/logo-1200.png")).convert("RGBA")
px = np.array(src).astype(int)
r, g, b, a = (px[:, :, i] for i in range(4))
solid = a > 160
colour = {
    "red": (r > 150) & (g < 90) & (b < 90),
    "yellow": (r > 200) & (g > 140) & (b < 90),
    "green": (g > 120) & (r < 170) & (b < 90) & (g > r),
    "white": (r > 200) & (g > 200) & (b > 200),
    "black": (r < 70) & (g < 70) & (b < 70),
}

def layer_of(box):
    """Which layer a solid shape belongs to, from its bounding box (x0, x1, y0, y1) in the 1200 px logo."""
    x0, x1, y0, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if cy > 370 and x1 > 250:
        return "amine"
    if cx > 880 and cy < 270:
        return "sprig"
    if x1 <= 410 or cx < 250:
        return "rooster"
    return "hicken"

names = ["rooster", "hicken", "amine", "sprig"]
seed = np.zeros(a.shape, int)
for mask in colour.values():
    lab, n = nd.label(mask & solid)
    for i, sl in enumerate(nd.find_objects(lab), 1):
        if (lab[sl] == i).sum() < 300:
            continue
        seed[lab == i] = names.index(layer_of((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop))) + 1
_, (iy, ix) = nd.distance_transform_edt(seed == 0, return_indices=True)
owner = seed[iy, ix]

out_dir = os.path.join(ROOT, "assets/intro")
os.makedirs(out_dir, exist_ok=True)
W = 900
H = round(src.height * W / src.width)
img = np.array(src)
for k, name in enumerate(names, 1):
    part = img.copy()
    part[:, :, 3] = np.where(owner == k, img[:, :, 3], 0)
    small = Image.fromarray(part).resize((W, H), Image.LANCZOS)
    small.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(out_dir, name + ".png"), optimize=True)
    print("assets/intro/" + name + ".png")
