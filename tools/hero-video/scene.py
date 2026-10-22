"""Original hero loop for Chicken Amine: crispy fried chicken in warm backlight, steam, drifting specks.
Everything is generated here (no footage). Writes raw RGB frames to stdout for ffmpeg, or one still with --still T."""
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd
from piece import piece, noise

OUT_W, OUT_H = 1280, 720
CW, CH = 1600, 900            # working canvas (margin for the camera drift)
FPS, T = 30, 12.0             # 12 s loop
rng = np.random.default_rng(2026)

# --- warm backlit background (bright amber top-left, deep orange-brown elsewhere)
yy, xx = np.mgrid[0:CH, 0:CW]
d = np.sqrt(((xx - CW * 0.18) / CW) ** 2 + ((yy - CH * 0.02) / CH * 1.35) ** 2)
t = np.clip(d / 0.95, 0, 1)
c0, c1, c2, c3 = np.array([255, 214, 92]), np.array([246, 150, 34]), np.array([196, 84, 14]), np.array([92, 30, 6])
bg = np.where(t[..., None] < 0.25, c0 + (c1 - c0) * (t[..., None] / 0.25),
     np.where(t[..., None] < 0.6, c1 + (c2 - c1) * ((t[..., None] - 0.25) / 0.35), c2 + (c3 - c2) * ((t[..., None] - 0.6) / 0.4)))
BG = Image.fromarray(bg.astype(np.uint8)).convert("RGBA")

def layer(n, wmin, wmax, ymin, ymax, blur, haze, xspread=1.0):
    im = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    xs = np.linspace(-60, CW - 160, n) + rng.uniform(-50, 50, n)
    items = []
    for x in xs:
        w = int(rng.uniform(wmin, wmax)); h = int(w * rng.uniform(0.56, 0.74))
        # heaped: pieces near the middle sit higher
        mound = 1 - np.exp(-((x + w / 2 - CW * 0.55) / (CW * 0.45)) ** 2)
        y = int((rng.uniform(ymin, ymax) + mound * 0.07) * CH)
        items.append((y, int(x * xspread), piece(w, h, rng, lumps=int(rng.integers(3, 7)))))
    for y, x, p in sorted(items, key=lambda i: i[0]):      # far rows first
        if rng.random() < 0.5: p = p.transpose(Image.FLIP_LEFT_RIGHT)
        p = p.rotate(rng.uniform(-24, 24), resample=Image.BICUBIC, expand=True)
        # soft shadow under each piece so overlapping pieces read separately
        sh = Image.new("RGBA", p.size, (40, 10, 0, 0)); sh.putalpha(p.getchannel("A").point(lambda v: int(v * 0.8)))
        sh = sh.filter(ImageFilter.GaussianBlur(max(6, p.width // 36)))
        im.alpha_composite(sh, (x + p.width // 40, y - p.height // 2 + p.height // 12))
        # backlight: a thin golden rim along the top edge
        A = np.asarray(p.getchannel("A"), float) / 255
        k = max(3, p.height // 60)
        above = np.zeros_like(A); above[k:] = A[:-k]
        rim = np.clip(A - above, 0, 1)
        rim = nd.gaussian_filter(rim, 1.6) * A
        arr = np.asarray(p).astype(float)
        arr[..., :3] += rim[..., None] * np.array([255, 205, 110]) * 0.85
        p = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        im.alpha_composite(p, (x, y - p.height // 2))
    if haze:   # distant pieces take on the glow
        a = np.asarray(im).astype(float)
        a[..., :3] = a[..., :3] * (1 - haze) + bg[..., :3] * haze
        im = Image.fromarray(a.astype(np.uint8), "RGBA")
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
    return im

sys.stderr.write("building pieces...\n")
BACK = layer(10, 260, 340, 0.48, 0.56, 7, 0.30)
MID = layer(6, 400, 500, 0.62, 0.72, 2.2, 0.08)
FRONT = layer(4, 560, 680, 0.82, 0.92, 0, 0)

# --- steam wisps: soft vertical ribbons of noise
def wisp(w, h):
    n = (noise((h, w), 9, rng) * 0.6 + noise((h, w), 22, rng)) * 0.5 + 0.5
    yy, xx = np.mgrid[0:h, 0:w]
    sway = np.sin(yy / h * 6.0 + rng.uniform(0, 6)) * w * 0.12
    col = np.exp(-(((xx - w / 2 - sway) / (w * 0.22)) ** 2))
    fade = np.sin(np.clip(yy / h, 0, 1) * np.pi) ** 1.2
    a = np.clip(n - 0.45, 0, 1) * col * fade
    a = nd.gaussian_filter(a, 6)
    a = a / (a.max() + 1e-9) * 0.55
    rgba = np.dstack([np.full((h, w), 255), np.full((h, w), 246), np.full((h, w), 232), a * 255])
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")
STEAM = [dict(img=wisp(int(rng.uniform(220, 340)), int(rng.uniform(520, 700))), x=rng.uniform(0.1, 0.9) * CW,
              phase=rng.uniform(0, 1), speed=int(rng.integers(1, 3))) for _ in range(7)]

# --- bokeh specks
def disc(r):
    s = int(r * 4); yy, xx = np.mgrid[0:s, 0:s]
    d = np.sqrt((xx - s / 2) ** 2 + (yy - s / 2) ** 2)
    a = np.clip((r - d) / 2.5, 0, 1) * (0.55 + 0.45 * np.clip(d / r, 0, 1))
    a = nd.gaussian_filter(a, r * 0.18)
    return Image.fromarray(np.dstack([np.full((s, s), 255), np.full((s, s), 224), np.full((s, s), 150), a * 120]).astype(np.uint8), "RGBA")
BOKEH = [dict(img=disc(rng.uniform(6, 22)), x=rng.uniform(0, CW), y=rng.uniform(0.0, 0.6) * CH,
              phase=rng.uniform(0, 1), drift=rng.uniform(40, 120)) for _ in range(26)]

# vignette + grain
vy, vx = np.mgrid[0:OUT_H, 0:OUT_W]
VIG = (1 - 0.35 * np.clip(((vx / OUT_W - 0.5) ** 2 + (vy / OUT_H - 0.45) ** 2) * 2.2, 0, 1))[..., None]

def place(canvas, layer_img, s, dx, dy):
    # scale around the canvas centre, then shift
    inv = 1 / s
    cx, cy = CW / 2, CH / 2
    m = (inv, 0, cx - cx * inv - dx * inv, 0, inv, cy - cy * inv - dy * inv)
    canvas.alpha_composite(layer_img.transform((CW, CH), Image.AFFINE, m, resample=Image.BILINEAR))

def frame(tt):
    ph = 2 * np.pi * tt / T
    s = 1.06 + 0.03 * np.sin(ph)
    camx, camy = 26 * np.sin(ph), 12 * np.cos(ph)
    c = BG.copy()
    for b in BOKEH:                                     # specks drift up and sideways, wrap each loop
        p = (b["phase"] + tt / T) % 1
        x = (b["x"] + np.sin(2 * np.pi * p) * b["drift"]) % CW
        y = b["y"] - p * 160 + 80
        a = np.sin(np.pi * p)
        im = b["img"]
        if a < 1: im = im.copy(); im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
        c.alpha_composite(im, (int(x), int(y)))
    place(c, BACK, s, camx * 0.35, camy * 0.35)
    place(c, MID, s, camx * 0.65, camy * 0.65)
    for st in STEAM:                                    # steam rises from the pile and fades
        p = (st["phase"] + tt / T * st["speed"]) % 1
        im = st["img"]
        y = CH * 0.62 - im.height * 0.25 - p * CH * 0.55
        a = np.sin(np.pi * p) ** 1.5
        im2 = im.copy(); im2.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
        c.alpha_composite(im2, (int(st["x"] - im.width / 2 + np.sin(2 * np.pi * p) * 30), int(y)))
    place(c, FRONT, s, camx, camy)
    ox, oy = (CW - OUT_W) // 2, (CH - OUT_H) // 2
    out = np.asarray(c.crop((ox, oy, ox + OUT_W, oy + OUT_H)).convert("RGB")).astype(float)
    out *= VIG
    out += np.random.default_rng(int(tt * FPS)).normal(0, 3.0, out.shape)   # light film grain
    return np.clip(out, 0, 255).astype(np.uint8)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--still":
        Image.fromarray(frame(float(sys.argv[2]))).save(sys.argv[3], quality=92)
    else:
        n = int(FPS * T)
        for i in range(n):
            sys.stdout.buffer.write(frame(i / FPS).tobytes())
            if i % 30 == 0: sys.stderr.write(f"frame {i}/{n}\n")
