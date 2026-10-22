"""Procedural crispy fried-chicken pieces: height map -> normals -> warm lighting -> colour ramp."""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

RAMP = np.array([  # crevice -> body -> peak, golden fried-chicken tones
    [0.00, (62, 16, 2)],
    [0.22, (128, 44, 4)],
    [0.45, (190, 88, 12)],
    [0.66, (222, 128, 26)],
    [0.84, (242, 170, 60)],
    [1.00, (255, 214, 128)],
], dtype=object)
stops = np.array([r[0] for r in RAMP], float)
cols = np.array([r[1] for r in RAMP], float)

def ramp(t):
    t = np.clip(t, 0, 1)
    out = np.empty(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, stops, cols[:, c])
    return out

def noise(shape, sigma, rng):
    n = nd.gaussian_filter(rng.standard_normal(shape), sigma)
    return n / (n.std() + 1e-9)

def piece(w, h, rng, lumps=4):
    """One piece, w x h px, RGBA uint8."""
    W, H = int(w * 1.25), int(h * 1.35)
    # lumpy outline
    n = 64
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    r = 1 + 0.08 * np.sin(a * lumps + rng.uniform(0, 6.3)) + 0.07 * np.sin(a * (lumps + 3) + rng.uniform(0, 6.3))
    r += nd.gaussian_filter1d(rng.standard_normal(n) * 0.09, 1.2, mode="wrap")
    pts = [(W / 2 + np.cos(t) * w / 2 * rr, H / 2 + np.sin(t) * h / 2 * rr) for t, rr in zip(a, r)]
    img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(img).polygon(pts, fill=255)
    m = np.asarray(img, float) / 255
    # crumbly edge: threshold a softened mask perturbed by noise
    soft = nd.gaussian_filter(m, 6)
    edge_noise = noise(m.shape, 2.2, rng) * 0.10 + noise(m.shape, 7, rng) * 0.08
    mask = (soft + edge_noise) > 0.5
    mask = nd.binary_opening(mask, iterations=1)
    # height: rounded body + crags + fine crunch
    dist = nd.distance_transform_edt(mask)
    dome = np.sqrt(np.clip(dist / (dist.max() + 1e-9), 0, 1))
    crag = np.clip(1 - np.abs(noise(m.shape, 4.0, rng)) / 2.2, 0, 1) ** 2.4          # small crunchy ridges
    crag2 = np.clip(1 - np.abs(noise(m.shape, 9.0, rng)) / 2.2, 0, 1) ** 2.0         # bigger crags
    lumps_ = np.clip(noise(m.shape, 20, rng), 0, None)                                 # breading flakes
    fine = noise(m.shape, 1.4, rng)
    height = dome * 150 + lumps_ * 22 + crag2 * 12 + crag * 7 + fine * 1.5
    height *= mask
    height = nd.gaussian_filter(height, 0.8)
    # normals
    gy, gx = np.gradient(height)
    nz = np.ones_like(height)
    nrm = np.stack([-gx, -gy, nz * 1.3], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    key = np.array([-0.55, -0.62, 0.56]); key /= np.linalg.norm(key)       # warm key light, back-left
    fill = np.array([0.6, 0.3, 0.75]); fill /= np.linalg.norm(fill)
    diff = np.clip(nrm @ key, 0, 1)
    fil = np.clip(nrm @ fill, 0, 1)
    # cavities (ambient occlusion): below the local average height
    cav = height - nd.gaussian_filter(height, 6)
    ao = np.clip(0.5 + cav / 14, 0, 1)
    # rim light from the glowing backdrop on upward/backward-facing edges
    rim = np.clip(-nrm[..., 1] * 0.9 - nrm[..., 0] * 0.4, 0, 1) ** 2 * (1 - dome) ** 0.4
    t = 0.04 + 0.66 * diff + 0.10 * fil + 0.50 * (ao - 0.5) + 0.45 * rim
    t = 0.5 + (t - 0.5) * 1.15 - 0.07
    rgb = ramp(t)
    # oily specular glints on the peaks
    half = key + np.array([0, 0, 1.0]); half /= np.linalg.norm(half)
    spec = np.clip(nrm @ half, 0, 1) ** 30 * np.clip(cav / 6, 0, 1) * 0.9
    rgb = rgb + spec[..., None] * np.array([255, 236, 190]) * 0.6
    # contact shadow toward the bottom edge
    shade = np.clip(1 - (np.arange(H)[:, None] / H - 0.55) * 0.9, 0.55, 1)
    rgb *= shade[..., None]
    alpha = nd.gaussian_filter(mask.astype(float), 0.7)
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")

if __name__ == "__main__":
    rng = np.random.default_rng(3)
    bg = Image.new("RGBA", (1400, 520), (110, 36, 6, 255))
    x = 20
    for i in range(3):
        p = piece(rng.integers(380, 460), rng.integers(220, 280), rng, lumps=int(rng.integers(3, 7)))
        bg.alpha_composite(p, (x, 40)); x += p.width - 60
    bg.convert("RGB").save("piece-test.jpg", quality=90)
