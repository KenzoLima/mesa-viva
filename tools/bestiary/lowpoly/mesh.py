"""Primitivas low-poly, esqueleto e animação do gerador do Bestiário.

Convenções: metros, Y para cima, a criatura olha para +Z, o lado esquerdo dela é +X.
Todos os ossos têm rotação de repouso identidade (só translação), então as rotações
das animações são dadas nos eixos do mundo: euler(rx, ry, rz) em graus.
"""
import math
import numpy as np

LOD = 0          # 0 completo, 1 simplificado, 2 bem otimizado
_gid = [0]       # contador de "grupos de face" (um quad = um grupo = um tom)


def set_lod(n):
    global LOD
    LOD = n
    _gid[0] = 0


def C(hexstr):
    h = hexstr.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def shade(c, k):
    return tuple(max(0.0, min(1.0, x * k)) for x in c)


def _unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def rotm(axis, deg):
    if isinstance(axis, str):
        axis = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    x, y, z = _unit(axis)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.array([
        [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
        [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
        [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def euler(rx, ry, rz):
    """Aplica Z, depois X, depois Y (ordem YXZ)."""
    return rotm('y', ry) @ rotm('x', rx) @ rotm('z', rz)


def _swap_lr(name):
    if name.endswith('.L'):
        return name[:-2] + '.R'
    if name.endswith('.R'):
        return name[:-2] + '.L'
    return name


def _wspec(w):
    """Normaliza: 'osso' | (a, b, t) | {osso: peso}."""
    if w is None:
        return None
    if isinstance(w, str):
        return {w: 1.0}
    if isinstance(w, tuple):
        a, b, t = w
        return {a: 1.0 - t, b: t} if a != b else {a: 1.0}
    return dict(w)


class Part:
    def __init__(self, v, f, g, color, mat='matte', w=None, detail=0):
        self.v = np.array(v, float).reshape(-1, 3)
        self.f = np.array(f, int).reshape(-1, 3)
        self.g = np.array(g, int).reshape(-1)
        self.fc = np.tile(np.array(color, float), (len(self.f), 1))
        self.mat = mat
        self.w = list(w) if w is not None else [None] * len(self.v)
        self.detail = detail

    def copy(self):
        p = Part(self.v.copy(), self.f.copy(), self.g.copy(), (0, 0, 0), self.mat,
                 [dict(x) if x else None for x in self.w], self.detail)
        p.fc = self.fc.copy()
        return p

    def move(self, x=0.0, y=0.0, z=0.0):
        self.v += (x, y, z)
        return self

    def rot(self, axis, deg, pivot=(0, 0, 0)):
        p = np.array(pivot, float)
        self.v = (self.v - p) @ rotm(axis, deg).T + p
        return self

    def scale(self, sx, sy=None, sz=None, pivot=(0, 0, 0)):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        p = np.array(pivot, float)
        self.v = (self.v - p) * (sx, sy, sz) + p
        if sx * sy * sz < 0:
            self.f = self.f[:, ::-1]
        return self

    def mirror(self):
        c = self.copy()
        c.v[:, 0] *= -1
        c.f = c.f[:, ::-1]
        c.w = [{_swap_lr(k): val for k, val in x.items()} if x else None for x in c.w]
        base = _gid[0]
        _gid[0] += int(c.g.max() - c.g.min()) + 1 if len(c.g) else 0
        c.g = c.g - (c.g.min() if len(c.g) else 0) + base
        return c

    def bind(self, bone):
        self.w = [_wspec(bone)] * len(self.v)
        return self

    def bind_axis(self, axis, a, b, bone_a, bone_b):
        """Mistura linear de pesos entre dois ossos ao longo de um eixo (0=x,1=y,2=z)."""
        t = np.clip((self.v[:, axis] - a) / (b - a), 0, 1)
        self.w = [_wspec((bone_a, bone_b, float(x))) for x in t]
        return self

    def bind_chain(self, axis, stops):
        """stops = [(coord, osso), ...] em ordem; interpola entre vizinhos."""
        out = []
        for p in self.v[:, axis]:
            if (stops[0][0] <= stops[-1][0] and p <= stops[0][0]) or (stops[0][0] > stops[-1][0] and p >= stops[0][0]):
                out.append({stops[0][1]: 1.0})
                continue
            done = False
            for (c0, b0), (c1, b1) in zip(stops, stops[1:]):
                lo, hi = min(c0, c1), max(c0, c1)
                if lo <= p <= hi:
                    t = (p - c0) / (c1 - c0) if c1 != c0 else 0
                    out.append(_wspec((b0, b1, float(t))))
                    done = True
                    break
            if not done:
                out.append({stops[-1][1]: 1.0})
        self.w = out
        return self

    def paint(self, color, where=None):
        """Pinta tudo, ou só as faces cujo centro satisfaz where(centros (F,3)) -> máscara."""
        if where is None:
            self.fc[:] = color
        else:
            self.fc[where(self.v[self.f].mean(1))] = color
        return self


def tube(path, radii, sides=6, color=(0.5, 0.5, 0.5), mat='matte', bones=None, phase=0.0,
         caps=(True, True), hint=(1, 0, 0), axis=None, alt=None, detail=0):
    """Loft ao longo de um caminho. radii: r ou (rx, ry) por anel; 0 vira ponta.

    rx segue o `hint` (por padrão X), ry o eixo perpendicular. `axis` fixa o plano
    dos anéis (cabeças, troncos). alt=(cor, grau_min, grau_max) pinta uma faixa angular.
    """
    path = [np.array(p, float) for p in path]
    radii = [(r, r) if np.isscalar(r) else tuple(r) for r in radii]
    n = len(path)
    if bones is None or isinstance(bones, (str, tuple, dict)):
        bones = [bones] * n
    bones = list(bones)
    if LOD > 0 and sides > 4:
        sides = max(4, int(round(sides * (0.75 if LOD == 1 else 0.5))))
    if LOD == 2 and n > 4:
        keep = [0] + list(range(1, n - 1, 2)) + [n - 1]
        path = [path[i] for i in keep]
        radii = [radii[i] for i in keep]
        bones = [bones[i] for i in keep]
        n = len(path)

    verts, wts, rings = [], [], []
    nprev = None
    for i in range(n):
        if axis is not None:
            t = _unit(axis)
        else:
            a = path[max(i - 1, 0)]
            b = path[min(i + 1, n - 1)]
            t = _unit(b - a)
        ref = np.array(hint, float) if nprev is None else nprev
        nv = ref - np.dot(ref, t) * t
        if np.linalg.norm(nv) < 1e-6:
            ref = np.array((0, 0, 1.0))
            nv = ref - np.dot(ref, t) * t
        nv = _unit(nv)
        nprev = nv
        bv = np.cross(t, nv)
        rx, ry = radii[i]
        w = _wspec(bones[i])
        if rx < 1e-6 and ry < 1e-6:
            rings.append([len(verts)])
            verts.append(path[i])
            wts.append(w)
        else:
            idx = []
            for k in range(sides):
                ang = math.radians(phase + 360.0 * k / sides)
                idx.append(len(verts))
                verts.append(path[i] + rx * math.cos(ang) * nv + ry * math.sin(ang) * bv)
                wts.append(w)
            rings.append(idx)

    faces, groups, altmask = [], [], []
    g0 = _gid[0]

    alts = [] if alt is None else (alt if isinstance(alt, list) else [alt])

    def in_alt(k):
        mid = (phase + 360.0 * (k + 0.5) / sides) % 360
        for ai, (_, lo, hi) in enumerate(alts):
            lo, hi = lo % 360, hi % 360
            if (lo <= mid <= hi) if lo <= hi else (mid >= lo or mid <= hi):
                return ai
        return -1

    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(sides):
            k2 = (k + 1) % sides
            gi = g0 + i * sides + k
            if len(A) > 1 and len(B) > 1:
                faces += [(A[k], A[k2], B[k2]), (A[k], B[k2], B[k])]
                groups += [gi, gi]
                altmask += [in_alt(k)] * 2
            elif len(A) > 1:
                faces.append((A[k], A[k2], B[0]))
                groups.append(gi)
                altmask.append(in_alt(k))
            elif len(B) > 1:
                faces.append((A[0], B[k2], B[k]))
                groups.append(gi)
                altmask.append(in_alt(k))
    gcap = g0 + n * sides
    if caps[0] and len(rings[0]) > 1:
        c = len(verts)
        verts.append(path[0])
        wts.append(_wspec(bones[0]))
        for k in range(sides):
            faces.append((c, rings[0][(k + 1) % sides], rings[0][k]))
            groups.append(gcap)
            altmask.append(False)
    if caps[1] and len(rings[-1]) > 1:
        c = len(verts)
        verts.append(path[-1])
        wts.append(_wspec(bones[-1]))
        for k in range(sides):
            faces.append((c, rings[-1][k], rings[-1][(k + 1) % sides]))
            groups.append(gcap + 1)
            altmask.append(False)
    _gid[0] = gcap + 2
    p = Part(verts, faces, groups, color, mat, wts, detail)
    am = np.array([-1 if x is False else int(x) for x in altmask])
    for ai, (acol, _, _) in enumerate(alts):
        p.fc[am == ai] = acol
    return p


def box(center, size, taper=(1.0, 1.0), **kw):
    """Caixa (w, h, d) com afunilamento opcional no topo."""
    cx, cy, cz = center
    w, h, d = size
    k = math.sqrt(2) / 2
    return tube([(cx, cy - h / 2, cz), (cx, cy + h / 2, cz)],
                [(w * k, d * k), (w * k * taper[0], d * k * taper[1])],
                sides=4, phase=45, axis=(0, 1, 0), **kw)


def spike(base, tip, r, sides=4, cap=True, **kw):
    r = (r, r) if np.isscalar(r) else r
    return tube([base, tip], [r, 0], sides=sides, caps=(cap, False), **kw)


def gem(center, r, h=None, sides=4, **kw):
    h = r if h is None else h
    c = np.array(center, float)
    return tube([c - (0, h, 0), c, c + (0, h, 0)], [0, r, 0], sides=sides, phase=45, **kw)


def plate(points, tris=None, color=(0.5, 0.5, 0.5), mat='cloth', bones=None, detail=0):
    """Superfície fina (material de dupla face). tris padrão: leque a partir do ponto 0."""
    pts = np.array(points, float)
    if tris is None:
        tris = [(0, i, i + 1) for i in range(1, len(pts) - 1)]
    g0 = _gid[0]
    _gid[0] += len(tris)
    if bones is None or isinstance(bones, (str, tuple, dict)):
        bones = [bones] * len(pts)
    return Part(pts, tris, list(range(g0, g0 + len(tris))), color, mat, [_wspec(b) for b in bones], detail)


def strip(left, right, color=(0.5, 0.5, 0.5), mat='cloth', bones=None, detail=0):
    """Faixa de quads entre duas polilinhas (capas, tabardos). bones: um por linha."""
    n = len(left)
    pts = [p for pair in zip(left, right) for p in pair]
    tris, grp = [], []
    g0 = _gid[0]
    for i in range(n - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        tris += [(a, b, c), (a, c, d)]
        grp += [g0 + i, g0 + i]
    _gid[0] += n
    if bones is None or isinstance(bones, (str, tuple, dict)):
        bones = [bones] * n
    w = [_wspec(b) for b in bones for _ in (0, 1)]
    return Part(pts, tris, grp, color, mat, w, detail)


# ---------------------------------------------------------------- materiais

MATERIALS = {
    # nome: (metallic, roughness, emissive, doubleSided)
    'matte':      (0.0, 0.90, None, False),
    'skin':       (0.0, 0.75, None, False),
    'scales':     (0.0, 0.60, None, False),
    'bone':       (0.0, 0.55, None, False),
    'leather':    (0.0, 0.80, None, False),
    'cloth':      (0.0, 1.00, None, True),
    'membrane':   (0.0, 0.70, None, True),
    'metal':      (0.85, 0.42, None, False),
    'metal_dark': (0.80, 0.60, None, False),
    'gold':       (0.90, 0.38, None, False),
    'glow_red':    (0.0, 1.0, (1.00, 0.10, 0.06), True),
    'glow_amber':  (0.0, 1.0, (1.00, 0.55, 0.08), True),
    'glow_yellow': (0.0, 1.0, (0.95, 0.85, 0.20), True),
    'glow_green':  (0.0, 1.0, (0.45, 0.95, 0.35), True),
    'glow_blue':   (0.0, 1.0, (0.35, 0.75, 1.00), True),
}


# ---------------------------------------------------------------- animação

def keys(*kf):
    """Função de u∈[0,1] interpolando (smoothstep) entre [(u, valor), ...]."""
    us = [k[0] for k in kf]
    vs = [np.array(k[1], float) for k in kf]

    def fn(u):
        if u <= us[0]:
            return vs[0]
        for i in range(len(us) - 1):
            if u <= us[i + 1]:
                t = (u - us[i]) / (us[i + 1] - us[i])
                t = t * t * (3 - 2 * t)
                return vs[i] * (1 - t) + vs[i + 1] * t
        return vs[-1]
    return fn


def const(*v):
    a = np.array(v, float)
    return lambda u: a


class Anim:
    def __init__(self, name, duration, loop=True):
        self.name, self.duration, self.loop = name, duration, loop
        self.rot, self.pos = {}, {}

    def r(self, bone, fn):
        self.rot.setdefault(bone, []).append(fn)
        return self

    def p(self, bone, fn):
        self.pos.setdefault(bone, []).append(fn)
        return self

    def sample(self, u):
        rot = {b: sum(np.asarray(f(u), float) for f in fs) for b, fs in self.rot.items()}
        pos = {b: sum(np.asarray(f(u), float) for f in fs) for b, fs in self.pos.items()}
        return rot, pos


# ---------------------------------------------------------------- modelo

class Model:
    def __init__(self, name):
        self.name = name
        self.parts = []
        self.bones = {}      # nome -> (pai, posição da cabeça do osso no repouso)
        self.anims = []
        self.present = None  # (anim, u) usado nas pranchas

    def bone(self, name, parent, head):
        assert parent is None or parent in self.bones, f'pai desconhecido: {parent}'
        self.bones[name] = (parent, np.array(head, float))
        return self.bones[name][1]

    def add(self, *parts):
        for p in parts:
            if p is None:
                continue
            if isinstance(p, (list, tuple)):
                self.add(*p)
            elif not (LOD == 2 and p.detail >= 1):
                self.parts.append(p)

    def anim(self, a):
        self.anims.append(a)
        return a

    def arrays(self):
        """Triângulos soltos (flat shading): P (T,3,3), cor (T,3,3) sRGB, material, juntas e pesos."""
        names = list(self.bones)
        index = {b: i for i, b in enumerate(names)}
        P, Cc, M, J, W = [], [], [], [], []
        allv = np.concatenate([p.v for p in self.parts])
        ymin, ymax = allv[:, 1].min(), allv[:, 1].max()
        for p in self.parts:
            tri = p.v[p.f]                                   # (F,3,3)
            jit = 1.0 + 0.09 * (((p.g * 2654435761) % 1000) / 1000.0 * 2 - 1)
            grad = 0.80 + 0.20 * np.clip((tri[:, :, 1] - ymin) / max(ymax - ymin, 1e-6), 0, 1)
            col = p.fc[:, None, :] * np.ones((1, 3, 1))
            if not p.mat.startswith('glow'):
                col = col * jit[:, None, None] * grad[:, :, None]
            j = np.zeros((len(p.v), 4), int)
            w = np.zeros((len(p.v), 4))
            for vi, spec in enumerate(p.w):
                assert spec, f'{self.name}: vértice sem osso (material {p.mat})'
                items = sorted(spec.items(), key=lambda kv: -kv[1])[:4]
                tot = sum(x for _, x in items)
                for s, (b, x) in enumerate(items):
                    assert b in index, f'{self.name}: osso inexistente {b}'
                    j[vi, s] = index[b]
                    w[vi, s] = x / tot
            P.append(tri)
            Cc.append(np.clip(col, 0, 1))
            M += [p.mat] * len(p.f)
            J.append(j[p.f])
            W.append(w[p.f])
        return dict(P=np.concatenate(P), C=np.concatenate(Cc), M=np.array(M),
                    J=np.concatenate(J), W=np.concatenate(W), bones=names)

    def skin(self, rot=None, pos=None):
        """Matrizes de skin (R, t) por osso para uma pose: p' = R @ p + t."""
        rot, pos = rot or {}, pos or {}
        world, out = {}, []
        for name, (par, head) in self.bones.items():
            R = euler(*rot.get(name, (0, 0, 0)))
            off = np.asarray(pos.get(name, (0, 0, 0)), float)
            if par is None:
                wr, wt = R, head + off
            else:
                pr, pt = world[par]
                wr, wt = pr @ R, pt + pr @ (head - self.bones[par][1] + off)
            world[name] = (wr, wt)
            out.append((wr, wt - wr @ head))
        return out

    def posed(self, A, rot=None, pos=None):
        mats = self.skin(rot, pos)
        Rs = np.array([m[0] for m in mats])
        Ts = np.array([m[1] for m in mats])
        P, J, W = A['P'], A['J'], A['W']
        out = np.zeros_like(P)
        for s in range(4):
            R = Rs[J[:, :, s]]
            T = Ts[J[:, :, s]]
            out += W[:, :, s, None] * (np.einsum('tcij,tcj->tci', R, P) + T)
        return out
