"""Rasterizador simples (numpy + Pillow) para as pranchas de apresentação.

Não é o render final do jogo: serve para conferir silhueta, facetas, wireframe,
materiais e escala a partir da MESMA geometria que vai para o GLB.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from .mesh import rotm, MATERIALS

SS = 2
MAT_COLORS = {
    'matte': (0.45, 0.45, 0.50), 'skin': (0.85, 0.62, 0.50), 'scales': (0.75, 0.25, 0.20),
    'bone': (0.90, 0.86, 0.70), 'leather': (0.55, 0.36, 0.20), 'cloth': (0.45, 0.25, 0.60),
    'membrane': (0.80, 0.30, 0.55), 'metal': (0.60, 0.72, 0.85), 'metal_dark': (0.30, 0.38, 0.50),
    'gold': (0.95, 0.78, 0.25),
}


def font(size):
    for name in ('segoeuib.ttf', 'arialbd.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def background(w, h):
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(-1, 1, w)[None, :]
    top, bot = np.array((0.105, 0.11, 0.135)), np.array((0.04, 0.04, 0.05))
    img = top * (1 - y[..., None]) + bot * y[..., None]
    img = img * (1.0 - 0.35 * (x[..., None] ** 2)) + 0.03 * np.exp(-((y[..., None] - 0.45) ** 2 + x[..., None] ** 2) * 3)
    return np.broadcast_to(img, (h, w, 3)).copy()


def view_matrix(yaw, pitch):
    return rotm('x', pitch) @ rotm('y', -yaw)


def fit(P, yaw, pitch, size, margin=0.10):
    cam = P.reshape(-1, 3) @ view_matrix(yaw, pitch).T
    lo, hi = cam.min(0), cam.max(0)
    ext = np.maximum(hi[:2] - lo[:2], 1e-6)
    scale = min(size[0] * (1 - 2 * margin) / ext[0], size[1] * (1 - 2 * margin) / ext[1])
    return scale, ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)


def raster(P, C, M, yaw=0, pitch=0, size=(640, 720), mode='lit', scale=None, center=None, shadow=True):
    """P (T,3,3) mundo, C (T,3,3) sRGB, M (T,) materiais. Devolve PIL.Image."""
    W, H = size[0] * SS, size[1] * SS
    if scale is None:
        scale, center = fit(P, yaw, pitch, size)
    scale *= SS
    V = view_matrix(yaw, pitch)
    cam = P @ V.T
    sx = (cam[:, :, 0] - center[0]) * scale + W / 2
    sy = H / 2 - (cam[:, :, 1] - center[1]) * scale
    sz = cam[:, :, 2]
    n = np.cross(cam[:, 1] - cam[:, 0], cam[:, 2] - cam[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.where(ln < 1e-12, 1, ln)
    double = np.array([MATERIALS[m][3] for m in M])
    glow = np.array([m.startswith('glow') for m in M])
    metal = np.array([MATERIALS[m][0] > 0.5 for m in M])
    back = n[:, 2] <= 0
    n[back & double] *= -1
    vis = ~back | double

    key = np.array((-0.45, 0.70, 0.55)); key /= np.linalg.norm(key)
    fill = np.array((0.75, 0.05, 0.45)); fill /= np.linalg.norm(fill)
    kd = np.clip(n @ key, 0, 1)[:, None]
    fd = np.clip(n @ fill, 0, 1)[:, None]
    rim = ((1 - np.clip(n[:, 2], 0, 1)) ** 3 * np.clip(n[:, 1] * 0.5 + 0.6, 0, 1))[:, None]
    half = key + (0, 0, 1); half /= np.linalg.norm(half)
    spec = (np.clip(n @ half, 0, 1) ** 14)[:, None] * metal[:, None]
    light = (np.array((0.17, 0.18, 0.22)) + kd * np.array((1.05, 0.96, 0.84)) + fd * np.array((0.20, 0.27, 0.38)))
    extra = rim * np.array((0.16, 0.24, 0.36)) + spec * 0.28

    img = background(W, H)
    if shadow:
        g = cam.reshape(-1, 3)
        gx0, gx1 = g[:, 0].min(), g[:, 0].max()
        cx = float(((gx0 + gx1) / 2 - center[0]) * scale + W / 2)
        gy = (V @ np.array((0, 0, 0.0)))[1]
        cy = float(H / 2 - (gy - center[1]) * scale)
        rx = float((gx1 - gx0) * scale * 0.55)
        ry = max(rx * 0.10, rx * 0.5 * abs(math.sin(math.radians(pitch))))
        sh = Image.new('L', (W, H), 0)
        ImageDraw.Draw(sh).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=150)
        sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(float(rx) * 0.12 + 2)), float) / 255
        img *= (1 - 0.75 * sh[..., None])
    zbuf = np.full((H, W), -np.inf)
    glowbuf = np.zeros((H, W, 3))
    mat_ids = {m: i for i, m in enumerate(sorted(set(M)))}

    for t in np.where(vis)[0]:
        x, y, z = sx[t], sy[t], sz[t]
        x0, x1 = max(int(math.floor(x.min())), 0), min(int(math.ceil(x.max())) + 1, W)
        y0, y1 = max(int(math.floor(y.min())), 0), min(int(math.ceil(y.max())) + 1, H)
        if x0 >= x1 or y0 >= y1:
            continue
        area = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])
        if abs(area) < 1e-9:
            continue
        px = np.arange(x0, x1) + 0.5
        py = (np.arange(y0, y1) + 0.5)[:, None]
        w0 = ((x[1] - px) * (y[2] - py) - (x[2] - px) * (y[1] - py)) / area
        w1 = ((x[2] - px) * (y[0] - py) - (x[0] - px) * (y[2] - py)) / area
        w2 = 1 - w0 - w1
        zz = w0 * z[0] + w1 * z[1] + w2 * z[2]
        zb = zbuf[y0:y1, x0:x1]
        mask = (w0 >= 0) & (w1 >= 0) & (w2 >= 0) & (zz > zb)
        if not mask.any():
            continue
        base = w0[..., None] * C[t, 0] + w1[..., None] * C[t, 1] + w2[..., None] * C[t, 2]
        if mode == 'lit':
            col = base if glow[t] else base * light[t] + extra[t]
        elif mode == 'mat':
            mc = MAT_COLORS.get(M[t], MATERIALS[M[t]][2] or (1, 0, 1))
            col = np.ones_like(base) * (np.array(mc) if glow[t] else np.array(mc) * (0.35 + 0.75 * kd[t] + 0.2 * fd[t]))
        else:  # wire
            a2 = abs(area)
            d0 = w0 * a2 / math.hypot(x[2] - x[1], y[2] - y[1])
            d1 = w1 * a2 / math.hypot(x[0] - x[2], y[0] - y[2])
            d2 = w2 * a2 / math.hypot(x[1] - x[0], y[1] - y[0])
            edge = (np.minimum(np.minimum(d0, d1), d2) < 0.75 * SS)[..., None]
            fillc = np.array((0.16, 0.18, 0.22)) * (0.5 + 0.9 * kd[t] + 0.3 * fd[t])
            col = np.where(edge, np.array((0.92, 0.80, 0.52)), fillc)
        img[y0:y1, x0:x1][mask] = col[mask]
        zb[mask] = zz[mask]
        if mode == 'lit':
            gb = glowbuf[y0:y1, x0:x1]
            gb[mask] = base[mask] if glow[t] else 0
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if mode == 'lit' and glowbuf.any():
        gl = Image.fromarray((np.clip(glowbuf, 0, 1) * 255).astype(np.uint8))
        bloom = np.asarray(gl.filter(ImageFilter.GaussianBlur(7 * SS)), float) * 1.6
        out = Image.fromarray(np.clip(np.asarray(out, float) + bloom, 0, 255).astype(np.uint8))
    return out.resize(size, Image.LANCZOS)


def label(img, text, sub=None):
    d = ImageDraw.Draw(img)
    d.text((14, 10), text, font=font(18), fill=(226, 205, 150))
    if sub:
        d.text((14, 34), sub, font=font(13), fill=(150, 150, 160))
    return img


def scale_panel(P, C, M, hP, hC, hM, size, height):
    """Criatura ao lado do humano padrão (1,80 m), mesma escala, com régua em metros."""
    gap = 0.5
    w_c = P[:, :, 0].max() - P[:, :, 0].min()
    w_h = hP[:, :, 0].max() - hP[:, :, 0].min()
    hP2 = hP + (P[:, :, 0].max() + gap + w_h / 2 - 0, 0, 0)
    allP = np.concatenate([P, hP2])
    top = max(allP[:, :, 1].max(), 2.0)
    scale = min(size[0] * 0.80 / (w_c + gap + w_h), size[1] * 0.78 / top)
    center = ((allP[:, :, 0].min() + allP[:, :, 0].max()) / 2, top / 2 - 0.02 * top)
    img = raster(allP, np.concatenate([C, hC]), np.concatenate([M, hM]), 0, 0, size, 'lit', scale, center)
    d = ImageDraw.Draw(img, 'RGBA')
    step = 1 if top < 6 else 2
    for m in range(0, int(top) + 2, step):
        y = size[1] / 2 - (m - center[1]) * scale
        if 0 < y < size[1]:
            d.line((40, y, size[0] - 10, y), fill=(226, 205, 150, 70 if m else 160), width=1)
            d.text((8, y - 8), f'{m} m', font=font(12), fill=(226, 205, 150, 220))
    yh = size[1] / 2 - (height - center[1]) * scale
    d.line((40, yh, size[0] * 0.6, yh), fill=(120, 200, 255, 200), width=1)
    d.text((size[0] * 0.6 - 52, yh - 16), f'{height:.2f} m', font=font(12), fill=(120, 200, 255, 255))
    return img


def sheet(title, subtitle, panels, cols=4, pad=6):
    pw, ph = panels[0].size
    rows = math.ceil(len(panels) / cols)
    head = 64
    out = Image.new('RGB', (cols * pw + (cols + 1) * pad, head + rows * ph + (rows + 1) * pad), (12, 12, 15))
    d = ImageDraw.Draw(out)
    d.text((pad + 8, 10), title, font=font(26), fill=(226, 205, 150))
    d.text((pad + 8, 42), subtitle, font=font(14), fill=(160, 160, 170))
    for i, p in enumerate(panels):
        out.paste(p, (pad + (i % cols) * (pw + pad), head + pad + (i // cols) * (ph + pad)))
    return out
