"""Dragão vermelho: quadrúpede alado, ~8 m do focinho à cauda, ~10 m de envergadura."""
import math
import numpy as np
from lowpoly.mesh import Model, Part, tube, box, spike, gem, plate, C, shade, keys, const, Anim

INFO = dict(
    id='dragon_red', name='Dragão Vermelho', tribe='Dragons', tribe_dir='Dragons', size_category='grande',
    description='Predador antigo das montanhas queimadas: escamas cor de sangue com dorso carbonizado, ventre em placas '
                'cor de osso, chifres varridos para trás, crista de espinhos do crânio à cauda e asas de membrana escura.',
    variants=['dragon_black (PAL negro/roxo, olhos verdes)', 'dragon_skeletal (PAL osso, sem membrana)',
              'dragon_ancient (escala 1.5, chifres e espinhos maiores)', 'dragon_lesser (escala 0.45, sem chifres de bochecha)'],
    sockets=[], panel=(760, 500), anim_panel=(420, 300),
    notes='Animações sem root motion; Fly/Land animam a altura pelo osso hips. O fogo de Attack_Fire é VFX da engine: '
          'emitir a partir do osso jaw.')

PAL = dict(scale=C('#8a1d17'), back=C('#4a1513'), belly=C('#a58a5c'), horn=C('#2a2422'), spine=C('#2c1c1b'),
           membrane=C('#4a1218'), claw=C('#1d1a1a'), tooth=C('#d6ccb0'), eye='glow_amber')

# (z, y, rx, ry, osso) da ponta da cauda até a base do crânio
SPINE = [(-5.6, 1.05, .06, .06, 'tail_05'), (-4.9, 0.95, .11, .11, 'tail_05'), (-4.1, 1.00, .18, .18, 'tail_04'),
         (-3.2, 1.20, .27, .28, 'tail_03'), (-2.3, 1.50, .37, .39, 'tail_02'), (-1.5, 1.75, .52, .56, 'tail_01'),
         (-1.0, 1.85, .78, .80, 'hips'), (-0.2, 1.90, .90, .92, 'spine'), (0.6, 2.00, .95, 1.0, 'chest'),
         (1.15, 2.15, .70, .76, 'chest'), (1.5, 2.35, .48, .54, 'neck_01'), (1.95, 2.85, .38, .43, 'neck_02'),
         (2.25, 3.30, .31, .35, 'neck_03'), (2.55, 3.52, .26, .28, 'head')]


def dense(rows):
    """Insere um anel intermediário (pesos 50/50) entre cada par: curva mais suave e dobra melhor."""
    out = []
    for a, b in zip(rows, rows[1:]):
        out.append(a)
        mid = tuple((x + y) / 2 for x, y in zip(a[:4], b[:4]))
        out.append((mid[0], mid[1], mid[2] * 1.04, mid[3] * 1.04, (a[4], b[4], 0.5)))
    return out + [rows[-1]]


HEAD = np.array((0, 3.55, 2.6))
HEAD_PITCH = 22
HEAD_SCALE = 1.3


def build(pal=None):
    P = {**PAL, **(pal or {})}
    m = Model('dragon_red')
    B = m.bone
    B('root', None, (0, 0, 0))
    B('hips', 'root', (0, 1.85, -1.0)); B('spine', 'hips', (0, 1.90, -0.2)); B('chest', 'spine', (0, 2.0, 0.6))
    B('neck_01', 'chest', (0, 2.35, 1.5)); B('neck_02', 'neck_01', (0, 2.85, 1.95)); B('neck_03', 'neck_02', (0, 3.30, 2.25))
    B('head', 'neck_03', HEAD)
    hr = lambda p: HEAD + HEAD_SCALE * np.array(p, float) @ np.array([[1, 0, 0], [0, math.cos(math.radians(HEAD_PITCH)), -math.sin(math.radians(HEAD_PITCH))],
                                                          [0, math.sin(math.radians(HEAD_PITCH)), math.cos(math.radians(HEAD_PITCH))]]).T
    B('jaw', 'head', hr((0, -0.10, 0.12)))
    prev = 'hips'
    for i, z in enumerate((-1.5, -2.3, -3.2, -4.1, -4.9)):
        y = [r[1] for r in SPINE if abs(r[0] - z) < 1e-6][0]
        B(f'tail_{i + 1:02d}', prev, (0, y, z)); prev = f'tail_{i + 1:02d}'
    # asas
    WR, WE, WW = np.array((0.58, 2.70, 0.55)), np.array((1.75, 3.55, 0.15)), np.array((3.05, 4.25, 0.85))
    FING = [np.array(p) for p in ((5.35, 3.95, 0.35), (5.05, 2.85, -0.95), (4.15, 2.05, -1.85), (2.95, 1.70, -2.35))]
    WT = np.array((0.66, 2.15, -1.05))
    for sd, sx in (('L', 1), ('R', -1)):
        f = np.array((sx, 1, 1))
        B(f'wing_upper.{sd}', 'chest', WR * f); B(f'wing_fore.{sd}', f'wing_upper.{sd}', WE * f); B(f'wing_hand.{sd}', f'wing_fore.{sd}', WW * f)
    # pernas
    FS, FE, FW = np.array((0.80, 1.90, 0.95)), np.array((0.96, 1.10, 0.60)), np.array((0.94, 0.38, 0.98))
    HS, HK, HH = np.array((0.72, 1.78, -1.0)), np.array((1.00, 0.98, -0.50)), np.array((0.95, 0.46, -1.20))
    for sd, sx in (('L', 1), ('R', -1)):
        f = np.array((sx, 1, 1))
        B(f'front_thigh.{sd}', 'chest', FS * f); B(f'front_shin.{sd}', f'front_thigh.{sd}', FE * f); B(f'front_foot.{sd}', f'front_shin.{sd}', FW * f)
        B(f'hind_thigh.{sd}', 'hips', HS * f); B(f'hind_shin.{sd}', f'hind_thigh.{sd}', HK * f); B(f'hind_foot.{sd}', f'hind_shin.{sd}', HH * f)

    # corpo, pescoço e cauda num único loft
    D = dense(SPINE)
    m.add(tube([(0, y, z) for z, y, _, _, _ in D], [(rx, ry) for _, _, rx, ry, _ in D], sides=10, phase=18,
               color=P['scale'], mat='scales', bones=[r[4] for r in D], caps=(True, False),
               alt=[(P['back'], 54, 126), (P['belly'], 234, 306)]))
    # fileiras de escamas levantadas no dorso e nos flancos
    for i in range(4, len(D) - 1):
        (z0, y0, rx0, ry0, _), (z1, y1, rx1, ry1, bone) = D[i - 1], D[i]
        for k, ang in enumerate((62, 118, 22, 158)):
            if k >= 2 and not (-1.6 < z1 < 1.3):
                continue
            ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            da = 9 if k < 2 else 7
            b0 = (rx1 * math.cos(math.radians(ang - da)), y1 + ry1 * math.sin(math.radians(ang - da)), z1)
            b1 = (rx1 * math.cos(math.radians(ang + da)), y1 + ry1 * math.sin(math.radians(ang + da)), z1)
            lift = 1.16 if k < 2 else 1.10
            tip = (rx0 * ca * lift, y0 + ry0 * sa * lift, z0 - (z1 - z0) * 0.15)
            m.add(plate([b0, tip, b1] if ca > 0 else [b0, b1, tip], color=P['back'] if k < 2 else shade(P['scale'], 0.72),
                        mat='membrane', bones=bone, detail=1 if (i + k) % 2 else 0))
    # crista de espinhos
    pts = [(np.array((0, y + ry * 0.92, z)), ry, bone) for z, y, _, ry, bone in SPINE[1:]]
    crest = []
    for (p0, r0, b0), (p1, r1, b1) in zip(pts, pts[1:]):
        crest += [(p0, r0, b0), ((p0 + p1) / 2, (r0 + r1) / 2, b0)]
    for i, (p, r, bone) in enumerate(crest):
        hgt = 0.16 + 0.42 * r
        m.add(spike(p - (0, 0.04, 0), p + (0, hgt, -hgt * 0.55), (0.035 + r * 0.05, 0.10 + r * 0.16), sides=3, phase=90,
                    color=P['spine'], mat='bone', bones=bone, detail=i % 2, cap=False))
    # ponta da cauda em lâmina
    m.add(tube([(0, 1.05, -5.5), (0, 1.07, -5.95), (0, 1.10, -6.6)], [(0.05, 0.05), (0.36, 0.035), 0], sides=4,
               color=P['spine'], mat='bone', bones='tail_05', caps=(False, False)))

    # cabeça (construída ao longo de +Z e inclinada)
    def H(part, bone='head'):
        return part.scale(HEAD_SCALE).rot('x', HEAD_PITCH).move(*HEAD).bind(bone)
    m.add(H(tube([(0, 0.0, -0.12), (0, 0.06, 0.26), (0, 0.0, 0.66), (0, -0.03, 1.06), (0, -0.05, 1.24)],
                 [(0.21, 0.21), (0.31, 0.24), (0.21, 0.16), (0.155, 0.115), (0.08, 0.06)], sides=6, phase=30,
                 color=P['scale'], mat='scales', alt=[(P['back'], 60, 120)])))
    m.add(H(tube([(0, -0.15, 0.06), (0, -0.19, 0.36), (0, -0.185, 0.76), (0, -0.165, 1.14)],
                 [(0.19, 0.075), (0.21, 0.07), (0.15, 0.055), (0.06, 0.035)], sides=6, phase=30, color=shade(P['scale'], 0.78),
                 mat='scales', alt=[(P['belly'], 240, 300)]), 'jaw'))
    m.add(H(gem((0, -0.10, 0.30), 0.09, 0.03, color=(1, 1, 1), mat='glow_amber'), 'jaw'))     # brasa na garganta
    for sx in (1, -1):
        m.add(H(tube([(sx * 0.17, 0.17, 0.08), (sx * 0.30, 0.42, -0.36), (sx * 0.27, 0.66, -0.92)], [0.095, 0.068, 0], sides=5,
                     color=P['horn'], mat='bone', caps=(False, False))))                        # chifres grandes
        m.add(H(spike((sx * 0.27, -0.02, 0.16), (sx * 0.56, -0.12, -0.30), 0.065, sides=4, color=P['horn'], mat='bone', cap=False)))
        m.add(H(spike((sx * 0.20, 0.20, 0.34), (sx * 0.30, 0.34, 0.14), (0.05, 0.035), sides=3, color=P['back'], mat='scales', cap=False)))
        m.add(H(gem((sx * 0.262, 0.075, 0.38), 0.05, 0.03, color=(1, 1, 1), mat=P['eye'])))
        m.add(H(plate([(sx * 0.20, 0.16, 0.04), (sx * 0.29, 0.44, -0.40), (sx * 0.50, 0.12, -0.42), (sx * 0.55, -0.11, -0.28), (sx * 0.26, -0.03, 0.10)],
                      color=P['membrane'], mat='membrane')))                                # babado entre os chifres
        for k, (z, ln) in enumerate(((1.12, 0.13), (0.94, 0.09), (0.78, 0.10), (0.62, 0.08), (0.46, 0.08))):
            x = sx * float(np.interp(z, [0.26, 0.66, 1.06, 1.24], [0.27, 0.185, 0.135, 0.06])) * 0.86
            m.add(H(spike((x, -0.06, z), (x, -0.06 - ln, z + 0.01), 0.026, sides=3, color=P['tooth'], mat='bone', detail=0 if k == 0 else 1, cap=False)))
        for k, (z, ln) in enumerate(((1.02, 0.11), (0.86, 0.08), (0.70, 0.08))):
            x = sx * float(np.interp(z, [0.36, 0.76, 1.14], [0.19, 0.135, 0.05])) * 0.86
            m.add(H(spike((x, -0.15, z), (x, -0.15 + ln, z + 0.01), 0.024, sides=3, color=P['tooth'], mat='bone', detail=0 if k == 0 else 1, cap=False), 'jaw'))
    m.add(H(spike((0, 0.02, 1.04), (0, 0.22, 0.98), (0.04, 0.06), sides=3, color=P['horn'], mat='bone', cap=False)))  # chifre do focinho

    # pernas
    def leg(S, E, W, names, r, toe_z):
        a, b, c = names
        mid1, mid2 = (S + E) / 2, (E + W) / 2
        ground = np.array((W[0] + 0.02, 0.16, W[2] + 0.10))
        t = tube([S + (0, 0.18, 0), mid1, E, mid2, W, ground],
                 [(r * 0.85, r * 1.45), (r * 0.9, r * 1.25), (r * 0.62, r * 0.72), (r * 0.52, r * 0.6), (r * 0.36, r * 0.4), (r * 0.42, r * 0.46)],
                 sides=8, phase=22.5, color=P['scale'], mat='scales', bones=[a, a, (a, b, .5), b, (b, c, .5), c], alt=[(P['back'], 150, 210)])
        out = [t]
        out.append(tube([ground + (0, -0.04, -0.20), ground + (0, -0.06, 0.18), ground + (0, -0.09, toe_z)],
                        [(0.27, 0.14), (0.33, 0.13), (0.27, 0.08)], sides=6, phase=0, color=shade(P['scale'], 0.85), mat='scales', bones=c, axis=(0, 0, 1)))
        for dx in (-0.19, 0.0, 0.19):
            base = ground + (dx, -0.08, toe_z - 0.03)
            out.append(spike(base, base + (dx * 0.35, -0.07, 0.30), (0.065, 0.075), sides=3, color=P['claw'], mat='bone', bones=c, cap=False))
        out.append(spike(E + (0, 0.0, -r * 0.5) if toe_z > 0.4 else E + (0, 0, r * 0.5), E + ((0.04, 0.12, -0.34) if toe_z > 0.4 else (0.04, 0.1, 0.3)),
                         0.06, sides=3, color=P['spine'], mat='bone', bones=b, detail=1, cap=False))
        return out
    for p in leg(FS, FE, FW, ('front_thigh.L', 'front_shin.L', 'front_foot.L'), 0.40, 0.50) + \
            leg(HS, HK, HH, ('hind_thigh.L', 'hind_shin.L', 'hind_foot.L'), 0.48, 0.48):
        m.add(p, p.mirror())

    # asas: braço, três dedos e membrana recortada
    up, fo, ha = 'wing_upper.L', 'wing_fore.L', 'wing_hand.L'
    wing = [tube([WR - (0.2, 0.3, 0), WR, (WR + WE) / 2, WE, (WE + WW) / 2, WW], [0.2, 0.2, 0.17, 0.14, 0.12, 0.10], sides=6, color=P['scale'],
                 mat='scales', bones=['chest', up, up, (up, fo, .5), fo, (fo, ha, .5)], caps=(False, True))]
    KN = [(WW + f) / 2 + (0, 0.16, 0) for f in FING]
    for f, k in zip(FING, KN):
        wing.append(tube([WW, k, f], [0.075, 0.055, 0], sides=4, color=P['back'], mat='scales', bones=ha, caps=(False, False)))
    wing.append(spike(WW, WW + (0.05, 0.50, 0.50), 0.07, sides=3, color=P['claw'], mat='bone', bones=ha, cap=False))   # garra do polegar
    wing.append(spike(WE, WE + (-0.25, 0.30, -0.45), 0.07, sides=3, color=P['spine'], mat='bone', bones=fo, cap=False, detail=1))
    pull = lambda a, b, c, k: (a + b) / 2 * (1 - k) + c * k
    pts, w, tris = [WW, WE, WR, WT], [ha, fo, up, 'hips'], []
    for i in range(4):
        pts += [KN[i], FING[i]]
        w += [ha, ha]
    for i in range(3):          # painéis entre os dedos, borda recortada
        ka, fa, kb, fb = 4 + 2 * i, 5 + 2 * i, 6 + 2 * i, 7 + 2 * i
        pts.append(pull(FING[i], FING[i + 1], WW, .24)); w.append(ha)
        mi = len(pts) - 1
        tris += [(0, ka, kb), (ka, fa, mi), (ka, mi, kb), (kb, mi, fb)]
    pts.append(pull(FING[3], WT, WE, .22)); w.append((fo, 'spine', .5))
    mi = len(pts) - 1
    tris += [(0, 10, 1), (10, 11, mi), (10, mi, 1), (1, mi, 3), (1, 3, 2)]
    mem = plate(pts, tris, color=P['membrane'], mat='membrane', bones=w)
    mem.paint(shade(P['membrane'], 1.3), lambda c: c[:, 1] > 3.1)
    wing.append(mem)
    for p in wing:
        m.add(p, p.mirror())

    _anims(m)
    return m


def _anims(m):
    s, c, tau = math.sin, math.cos, 2 * math.pi
    REST = {'jaw': (4, 0, 0)}

    def new(name, dur, loop=True):
        a = m.anim(Anim(name, dur, loop))
        for b, e in REST.items():
            a.r(b, const(*e))
        return a

    def tail(a, amp, freq=1, lift=0.0):
        for i in range(5):
            a.r(f'tail_{i + 1:02d}', lambda u, i=i: (lift, amp * (0.5 + 0.25 * i) * s(tau * (freq * u - 0.16 * i)), 0))

    def wings(a, fn_up, fn_fore=None, fn_hand=None):
        for sd, k in (('L', 1), ('R', -1)):
            a.r(f'wing_upper.{sd}', lambda u, k=k: np.array(fn_up(u)) * (1, k, k))
            if fn_fore:
                a.r(f'wing_fore.{sd}', lambda u, k=k: np.array(fn_fore(u)) * (1, k, k))
            if fn_hand:
                a.r(f'wing_hand.{sd}', lambda u, k=k: np.array(fn_hand(u)) * (1, k, k))

    def K(*kf):
        return keys(*kf)

    a = new('Idle', 4.0)
    a.p('chest', lambda u: (0, 0.035 * s(tau * u), 0))
    a.r('neck_01', lambda u: (2 * s(tau * u), 5 * s(tau * u + 1), 0))
    a.r('neck_02', lambda u: (2 * s(tau * u + 0.5), 5 * s(tau * u + 1.4), 0))
    a.r('head', lambda u: (-3 * s(tau * u + 0.5), 6 * s(tau * u + 2), 0))
    a.r('jaw', lambda u: (3 + 3 * s(tau * u), 0, 0))
    tail(a, 9)
    wings(a, lambda u: (0, 0, 4 * s(tau * u)), lambda u: (0, 0, 3 * s(tau * u - 0.8)))
    m.present = (a, 0.1)

    def gait(name, dur, A, bob, lean):
        a = new(name, dur)
        for leg, ph in (('front', 0.0), ('hind', 0.5)):
            for sd, off in (('L', 0.0), ('R', 0.5)):
                p = ph + off
                a.r(f'{leg}_thigh.{sd}', lambda u, p=p: (-A * s(tau * (u + p)), 0, 0))
                a.r(f'{leg}_shin.{sd}', lambda u, p=p: (A * 0.9 * max(0.0, c(tau * (u + p))) * (-1 if leg == 'hind' else 1), 0, 0))
                a.r(f'{leg}_foot.{sd}', lambda u, p=p: (-A * 0.5 * s(tau * (u + p)) + (A * 0.8 * max(0.0, c(tau * (u + p))) if leg == 'hind' else 0), 0, 0))
        a.p('hips', lambda u: (0, bob * c(2 * tau * u) - bob, 0))
        a.r('spine', lambda u: (lean, 4 * s(tau * u), 0))
        a.r('chest', lambda u: (0, 4 * s(tau * u), 0))
        a.r('neck_01', lambda u: (lean * 1.5 - 2 * s(2 * tau * u), -4 * s(tau * u), 0))
        a.r('head', lambda u: (-lean * 2.4 + 2 * s(2 * tau * u), -4 * s(tau * u), 0))
        tail(a, 12 + lean, 1)
        wings(a, lambda u: (0, 0, -10 + 3 * s(2 * tau * u)), lambda u: (0, 0, -8))
        return a
    gait('Walk', 1.8, 20, 0.05, 0)
    gait('Run', 0.9, 34, 0.12, 6)

    a = new('Attack_Bite', 1.1, False)
    a.r('neck_01', K((0, (0, 0, 0)), (.30, (-22, 0, 0)), (.50, (38, 0, 0)), (.65, (30, 0, 0)), (1, (0, 0, 0))))
    a.r('neck_02', K((0, (0, 0, 0)), (.30, (-16, 0, 0)), (.50, (26, 0, 0)), (1, (0, 0, 0))))
    a.r('neck_03', K((0, (0, 0, 0)), (.30, (10, 0, 0)), (.50, (8, 0, 0)), (1, (0, 0, 0))))
    a.r('head', K((0, (0, 0, 0)), (.30, (24, 0, 0)), (.50, (-48, 0, 0)), (.65, (-34, 0, 0)), (1, (0, 0, 0))))
    a.r('jaw', K((0, (0, 0, 0)), (.30, (18, 0, 0)), (.46, (40, 0, 0)), (.54, (-3, 0, 0)), (1, (0, 0, 0))))
    a.p('chest', K((0, (0, 0, 0)), (.30, (0, 0.05, -0.2)), (.50, (0, -0.12, 0.35)), (1, (0, 0, 0))))
    a.r('front_thigh.L', K((0, (0, 0, 0)), (.50, (-14, 0, 0)), (1, (0, 0, 0))))
    wings(a, K((0, (0, 0, 0)), (.30, (0, 0, 14)), (.50, (0, 0, -12)), (1, (0, 0, 0))))
    tail(a, 6, 1, 0)

    a = new('Attack_Fire', 2.4, False)
    a.r('spine', K((0, (0, 0, 0)), (.22, (-7, 0, 0)), (.38, (4, 0, 0)), (.85, (4, 0, 0)), (1, (0, 0, 0))))
    a.r('neck_01', K((0, (0, 0, 0)), (.22, (-20, 0, 0)), (.38, (24, -12, 0)), (.60, (24, 0, 0)), (.85, (24, 12, 0)), (1, (0, 0, 0))))
    a.r('neck_02', K((0, (0, 0, 0)), (.22, (-14, 0, 0)), (.38, (18, -8, 0)), (.85, (18, 8, 0)), (1, (0, 0, 0))))
    a.r('head', K((0, (0, 0, 0)), (.22, (20, 0, 0)), (.38, (-30, -8, 0)), (.85, (-30, 8, 0)), (1, (0, 0, 0))))
    a.r('jaw', K((0, (0, 0, 0)), (.22, (0, 0, 0)), (.36, (42, 0, 0)), (.86, (42, 0, 0)), (.95, (0, 0, 0)), (1, (0, 0, 0))))
    wings(a, K((0, (0, 0, 0)), (.22, (0, 0, 22)), (.85, (0, 0, 16)), (1, (0, 0, 0))), K((0, (0, 0, 0)), (.22, (0, 0, 12)), (1, (0, 0, 0))))
    tail(a, 5, 2, 0)

    a = new('Hit', 0.6, False)
    a.r('neck_01', K((0, (0, 0, 0)), (.25, (-16, 14, 0)), (1, (0, 0, 0))))
    a.r('head', K((0, (0, 0, 0)), (.25, (-12, 18, 10)), (1, (0, 0, 0))))
    a.r('jaw', K((0, (0, 0, 0)), (.25, (25, 0, 0)), (1, (0, 0, 0))))
    a.r('chest', K((0, (0, 0, 0)), (.25, (-5, 0, 4)), (1, (0, 0, 0))))
    a.p('hips', K((0, (0, 0, 0)), (.25, (0, -0.08, -0.25)), (1, (0, 0, 0))))
    wings(a, K((0, (0, 0, 0)), (.25, (0, 0, 16)), (1, (0, 0, 0))))

    a = new('Death', 2.6, False)
    a.p('hips', K((0, (0, 0, 0)), (.20, (0, 0.12, -0.1)), (.55, (0, -0.95, 0)), (.75, (0, -1.08, 0)), (1, (0, -1.08, 0))))
    a.r('hips', K((0, (0, 0, 0)), (.55, (0, 0, 7)), (1, (0, 0, 9))))
    for sd, k in (('L', 1), ('R', -1)):
        a.r(f'front_thigh.{sd}', K((0, (0, 0, 0)), (.55, (-55, 0, 16 * k)), (1, (-62, 0, 20 * k))))
        a.r(f'front_shin.{sd}', K((0, (0, 0, 0)), (.55, (78, 0, 0)), (1, (84, 0, 0))))
        a.r(f'hind_thigh.{sd}', K((0, (0, 0, 0)), (.55, (-40, 0, 18 * k)), (1, (-46, 0, 22 * k))))
        a.r(f'hind_shin.{sd}', K((0, (0, 0, 0)), (.55, (-48, 0, 0)), (1, (-52, 0, 0))))
        a.r(f'hind_foot.{sd}', K((0, (0, 0, 0)), (.55, (70, 0, 0)), (1, (76, 0, 0))))
    a.r('neck_01', K((0, (0, 0, 0)), (.20, (-25, 0, 0)), (.60, (40, 10, 0)), (.80, (58, 14, 0)), (1, (58, 14, 0))))
    a.r('neck_02', K((0, (0, 0, 0)), (.20, (-15, 0, 0)), (.60, (20, 8, 0)), (.80, (26, 10, 0)), (1, (26, 10, 0))))
    a.r('head', K((0, (0, 0, 0)), (.20, (-20, 0, 0)), (.60, (-30, 0, 20)), (.82, (-58, 0, 40)), (1, (-58, 0, 40))))
    a.r('jaw', K((0, (0, 0, 0)), (.20, (40, 0, 0)), (.80, (14, 0, 0)), (1, (14, 0, 0))))
    wings(a, K((0, (0, 0, 0)), (.20, (0, 0, 20)), (.70, (0, -10, -34)), (1, (0, -10, -36))),
          K((0, (0, 0, 0)), (.70, (0, 0, -20)), (1, (0, 0, -22))))
    for i in range(5):
        a.r(f'tail_{i + 1:02d}', K((0, (0, 0, 0)), (.3, (-6, 6, 0)), (.75, (-3 + 5 * (i == 0), 4 * i, 0)), (1, (-3 + 5 * (i == 0), 4 * i, 0))))

    def fly_pose(a, w=1.0):
        for sd in 'LR':
            a.r(f'front_thigh.{sd}', const(38 * w, 0, 0)); a.r(f'front_shin.{sd}', const(-70 * w, 0, 0)); a.r(f'front_foot.{sd}', const(40 * w, 0, 0))
            a.r(f'hind_thigh.{sd}', const(30 * w, 0, 0)); a.r(f'hind_shin.{sd}', const(-25 * w, 0, 0)); a.r(f'hind_foot.{sd}', const(45 * w, 0, 0))
    a = new('Fly', 1.3)
    fly_pose(a)
    a.p('hips', lambda u: (0, 0.22 * s(tau * (u - 0.2)), 0))
    a.r('spine', lambda u: (2 * s(tau * u), 0, 0))
    a.r('neck_01', lambda u: (22 + 3 * s(tau * u), 0, 0)); a.r('neck_02', const(14, 0, 0)); a.r('head', lambda u: (-30 - 3 * s(tau * u), 0, 0))
    wings(a, lambda u: (0, 0, 6 + 38 * s(tau * u)), lambda u: (0, 0, 24 * s(tau * (u - 0.14))), lambda u: (0, 0, 22 * s(tau * (u - 0.26))))
    for i in range(5):
        a.r(f'tail_{i + 1:02d}', lambda u, i=i: (-4 + 5 * s(tau * (u - 0.15 * i)), 0, 0))

    a = new('Land', 2.0, False)
    for sd in 'LR':
        a.r(f'front_thigh.{sd}', K((0, (38, 0, 0)), (.45, (-10, 0, 0)), (.7, (-18, 0, 0)), (1, (0, 0, 0))))
        a.r(f'front_shin.{sd}', K((0, (-70, 0, 0)), (.45, (0, 0, 0)), (.7, (26, 0, 0)), (1, (0, 0, 0))))
        a.r(f'front_foot.{sd}', K((0, (40, 0, 0)), (.5, (0, 0, 0)), (1, (0, 0, 0))))
        a.r(f'hind_thigh.{sd}', K((0, (30, 0, 0)), (.45, (-12, 0, 0)), (.7, (-20, 0, 0)), (1, (0, 0, 0))))
        a.r(f'hind_shin.{sd}', K((0, (-25, 0, 0)), (.45, (0, 0, 0)), (.7, (-24, 0, 0)), (1, (0, 0, 0))))
        a.r(f'hind_foot.{sd}', K((0, (45, 0, 0)), (.5, (0, 0, 0)), (.7, (40, 0, 0)), (1, (0, 0, 0))))
    a.p('hips', K((0, (0, 2.2, 0)), (.55, (0, 0.05, 0)), (.7, (0, -0.32, 0)), (1, (0, 0, 0))))
    a.r('hips', K((0, (-14, 0, 0)), (.55, (-10, 0, 0)), (.75, (2, 0, 0)), (1, (0, 0, 0))))
    a.r('neck_01', K((0, (22, 0, 0)), (.55, (10, 0, 0)), (.72, (16, 0, 0)), (1, (0, 0, 0))))
    a.r('head', K((0, (-20, 0, 0)), (.72, (-12, 0, 0)), (1, (0, 0, 0))))
    wings(a, K((0, (0, 0, 30)), (.15, (0, 0, -20)), (.30, (0, 0, 34)), (.45, (0, 0, -14)), (.6, (0, 0, 30)), (1, (0, 0, 0))),
          K((0, (0, 0, 14)), (.15, (0, 0, -16)), (.30, (0, 0, 18)), (.45, (0, 0, -10)), (.6, (0, 0, 14)), (1, (0, 0, 0))))
    for i in range(5):
        a.r(f'tail_{i + 1:02d}', K((0, (-6, 0, 0)), (.6, (6, 0, 0)), (1, (0, 0, 0))))
