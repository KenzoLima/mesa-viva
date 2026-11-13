"""Lorde vampiro: alto, magro, gola alta, capa até o chão com barra de asa de morcego, rapieira."""
import math
from lowpoly.mesh import Model, tube, box, spike, gem, plate, C, shade, keys, Anim
from lowpoly.humanoid import humanoid, head, humanoid_anims, cape
from lowpoly import gear

INFO = dict(
    id='vampire_lord', name='Lorde Vampiro', tribe='Vampires', tribe_dir='Vampires', size_category='humanoide',
    description='Senhor de um castelo em ruínas: pele pálida, olhos vermelhos acesos, gibão negro com jabô cor de sangue, '
                'gola alta, capa longa forrada de carmesim com barra recortada, garras e uma rapieira ornamentada.',
    variants=['vampire_noble (sem ombreiras, sem arma)', 'vampire_warrior (espada reta + peitoral)',
              'vampire_hunter (capa curta, besta)', 'vampire_aristocrat (silhueta feminina, vestido no lugar das abas)'],
    sockets=['weapon.R', 'weapon.L'],
    notes='Animações sem root motion. Extra: Glide (deslocamento elegante, flutuando). '
          'Transformação (morcego/névoa) exige malha alternativa e ficou fora do protótipo.')

SKIN, BLACK, COAT, BLOOD, GOLD, IVORY = C('#b9b5bb'), C('#121014'), C('#1c161d'), C('#74101a'), C('#8d6c2e'), C('#d8d0bb')
IRON = C('#3b3a42')
RINGS = [(0.00, 0.22, 0.24, 0.48), (0.20, 0.60, 0.72, 0.20), (0.45, 0.92, 1.00, 0.02),
         (0.72, 1.00, 1.08, -0.03), (0.93, 0.74, 0.86, -0.08), (1.00, 0.28, 0.34, -0.10)]


def build():
    m = Model('vampire_lord')
    L = humanoid(m, H=1.95, head_h=0.24, head_w=0.086, neck=0.075, leg=0.53, shoulder=0.205, hip=0.088,
                 chest=(0.175, 0.115), waist=(0.120, 0.088), pelvis=(0.146, 0.10), arm_r=0.044, leg_r=0.072,
                 arm_len=0.66, hand=1.2, cape_bones=3, limb_sides=8,
                 col=dict(skin=SKIN, torso=COAT, pants=BLACK, boots=C('#0c0b0d'), sleeve=C('#231a22'),
                          bracer=shade(BLOOD, 0.75), hand=shade(SKIN, 0.92)))
    F = head(m, L, rings=RINGS, eye='glow_red', eye_size=0.9, eye_slant=1.0, nose=0.9, brow=shade(SKIN, 0.55))
    b, h, w = F.b, F.h, F.w
    # cabelo negro penteado para trás, com bico de viúva
    m.add(tube([b + (0, 0.74 * h, -0.10 * w), b + (0, 0.90 * h, -0.14 * w), b + (0, 1.04 * h, -0.30 * w), b + (0, 0.98 * h, -1.0 * w)],
               [(w * 1.06, w * 1.12), (w * 0.92, w * 1.02), (w * 0.55, w * 0.7), 0], sides=8, phase=22.5, axis=(0, 1, 0),
               color=BLACK, bones='head', caps=(False, False)))
    m.add(plate([b + (0, 0.66 * h, F.zf(0.68) + 0.008), b + (0.05, 0.80 * h, F.zf(0.8) + 0.004), b + (0, 0.92 * h, F.zf(0.9)),
                 b + (-0.05, 0.80 * h, F.zf(0.8) + 0.004)], color=BLACK, bones='head'))
    for x, ln in ((0, 0.20), (0.05, 0.16), (-0.05, 0.16)):
        m.add(spike(b + (x, 0.72 * h, -w * 0.95), b + (x * 1.3, 0.72 * h - ln, -w * 1.25), (0.036, 0.03), sides=4,
                    color=BLACK, bones='head', cap=False))
    for sx in (1, -1):   # orelhas pontudas curtas e presas
        m.add(spike(b + (sx * w * 0.95, 0.52 * h, -0.005), b + (sx * (w + 0.03), 0.78 * h, -0.06), (0.026, 0.012), sides=4,
                    color=shade(SKIN, 0.9), mat='skin', bones='head', hint=(0, 1, 0), cap=False))
        m.add(spike(b + (sx * 0.016, 0.215 * h, F.zf(0.21) - 0.004), b + (sx * 0.016, 0.215 * h - 0.03, F.zf(0.21) + 0.004), 0.006,
                    sides=3, color=IVORY, mat='bone', bones='head', cap=False))
    # gola alta recortada (fora negra, dentro carmesim)
    ny = L.neckY - 0.03
    for layer, (col, dr) in enumerate(((BLACK, 0.0), (BLOOD, -0.012))):
        pts, n = [], 9
        for i in range(n):
            a = math.radians(-125 + 250 * i / (n - 1))
            tall = 0.30 if i % 2 == 0 else 0.22
            tall *= 0.62 + 0.38 * math.cos(a * 0.5) ** 2
            pts.append(((0.10 + dr) * math.sin(a), ny, -(0.10 + dr) * math.cos(a) + 0.01))
            pts.append(((0.19 + dr) * math.sin(a), ny + tall, -(0.20 + dr) * math.cos(a) - 0.01))
        tris = [t for i in range(n - 1) for t in ((2 * i, 2 * i + 1, 2 * i + 3), (2 * i, 2 * i + 3, 2 * i + 2))]
        m.add(plate(pts, tris, color=col, bones='chest'))
        m.parts[-1].g = m.parts[-1].g // 2 * 2
    # jabô de sangue com broche, botões e cinto
    cz = 0.118
    m.add(plate([(0, L.neckY + 0.0, 0.075), (0.075, L.shY - 0.03, cz - 0.012), (0.04, L.chestY - 0.02, cz + 0.008), (0, L.chestY - 0.12, cz + 0.002),
                 (-0.04, L.chestY - 0.02, cz + 0.008), (-0.075, L.shY - 0.03, cz - 0.012)], color=BLOOD, bones='chest'),
          gem((0, L.shY - 0.035, cz + 0.004), 0.022, 0.028, color=(1, 1, 1), mat='glow_red', bones='chest'),
          tube([(0, L.shY - 0.035, cz - 0.004), (0, L.shY - 0.035, cz + 0.008)], [0.036, 0.03], sides=6, axis=(0, 0, 1), color=GOLD,
               mat='gold', bones='chest'))
    wy = L.waistY - 0.035
    m.add(tube([(0, wy - 0.03, 0), (0, wy + 0.03, 0)], [(0.134, 0.098), (0.128, 0.094)], sides=8, phase=22.5, axis=(0, 1, 0),
               color=BLOOD, mat='cloth', bones='spine', caps=(False, False)),
          box((0, wy, 0.097), (0.06, 0.07, 0.016), color=GOLD, mat='gold', bones='spine'))
    # abas longas do casaco (abertas na frente)
    for sx, sd in ((1, 'L'), (-1, 'R')):
        m.add(plate([(sx * 0.035, wy, 0.10), (sx * 0.150, wy, 0.02), (sx * 0.150, wy, -0.085), (sx * 0.20, L.kneeY + 0.02, -0.13),
                     (sx * 0.215, L.kneeY - 0.10, 0.0), (sx * 0.10, L.kneeY + 0.10, 0.125)],
                    tris=[(0, 1, 5), (1, 4, 5), (1, 2, 4), (2, 3, 4)], color=COAT,
                    bones=['hips', 'hips', 'hips', ('hips', f'thigh.{sd}', .7), ('hips', f'thigh.{sd}', .7), ('hips', f'thigh.{sd}', .7)]))
        m.add(plate([(sx * 0.035, wy, 0.101), (sx * 0.10, L.kneeY + 0.10, 0.126), (sx * 0.075, L.kneeY + 0.16, 0.122), (sx * 0.02, wy - 0.04, 0.104)],
                    color=BLOOD, bones=['hips', ('hips', f'thigh.{sd}', .7), ('hips', f'thigh.{sd}', .7), 'hips'], detail=1))
    # ombreiras góticas com espinhos
    sh = L.sh
    pa = tube([sh + (-0.05, 0.0, 0), sh + (0.02, 0.05, 0), sh + (0.085, 0.045, 0)], [(0.075, 0.085), (0.07, 0.08), (0.03, 0.045)],
              sides=6, color=IRON, mat='metal_dark', bones=('chest', 'upper_arm.L', 0.5))
    s1 = spike(sh + (0.03, 0.06, 0.0), sh + (0.10, 0.20, -0.02), 0.022, color=IRON, mat='metal_dark', bones=('chest', 'upper_arm.L', 0.5))
    s2 = spike(sh + (0.07, 0.04, 0.0), sh + (0.17, 0.11, -0.02), 0.018, color=GOLD, mat='gold', bones=('chest', 'upper_arm.L', 0.5), detail=1)
    m.add(pa, pa.mirror(), s1, s1.mirror(), s2, s2.mirror())
    # punhos largos, canos de bota e garras
    d = L.arm_dir
    cuff = tube([L.wrist - d * 0.11, L.wrist - d * 0.01], [0.046, 0.064], sides=6, phase=30, color=shade(BLOOD, 0.8), mat='cloth',
                bones='forearm.L', caps=(False, False))
    boot = tube([L.knee + (0, -0.13, -0.01), L.knee + (0, -0.02, 0.0), L.knee + (0, 0.05, 0.02)], [0.066, 0.078, (0.05, 0.03)],
                sides=6, phase=30, color=C('#0c0b0d'), mat='leather', bones='shin.L', caps=(False, True))
    m.add(cuff, cuff.mirror(), boot, boot.mirror())
    hl = 0.105 * 1.2 * 1.95 / 1.8
    for k, dz in enumerate((-0.03, 0.0, 0.03)):
        cl = spike(L.wrist + d * hl * 0.9 + (0, 0, dz), L.wrist + d * (hl + 0.075) + (0.012, 0, dz * 1.5), 0.0105, sides=3,
                   color=IVORY, mat='bone', bones='hand.L', detail=0 if k == 1 else 1, cap=False)
        m.add(cl, cl.mirror())
    # capa longa forrada, barra de asa de morcego
    zb = -0.125
    cape(m, [(L.shY + 0.025, 0.215, zb + 0.03, 'chest'), (L.chestY - 0.04, 0.29, zb - 0.03, 'cape_01'),
             (L.hipY + 0.05, 0.37, zb - 0.09, 'cape_02'), (L.kneeY + 0.02, 0.45, zb - 0.16, 'cape_03'),
             (0.07, 0.52, zb - 0.22, 'cape_03')], C('#2b2032'), lining=BLOOD, cols=9, curve=0.42, jag=0.20)
    m.add(gear.hold(gear.sword(1.05, 0.03, 'rapier', blade=C('#9a9ca6'), guard=IRON, grip=BLACK, accent=GOLD), L, 'R', tilt=70))

    new = humanoid_anims(m, stride=22, arm=9, walk_dur=1.25, run_dur=0.62, cape=3, sway=0.6, attack_dur=0.8,
                         stance={'upper_arm.R': (-4, 0, -8), 'forearm.R': (-18, 0, 0), 'upper_arm.L': (-14, 0, 12),
                                 'forearm.L': (-58, 0, 0), 'hand.L': (-20, 0, 0), 'head': (4, 0, 0)})
    s, tau = math.sin, 2 * math.pi
    a = new('Glide', 2.0)
    a.p('hips', lambda u: (0, 0.14 + 0.03 * s(tau * u), 0))
    a.r('spine', lambda u: (8 + 1.5 * s(tau * u), 0, 0))
    a.r('head', lambda u: (-8, 0, 0))
    for sd, k in (('L', 1), ('R', -1)):
        a.r(f'thigh.{sd}', lambda u, k=k: (10 + 4 * k + 2 * s(tau * u + k), 0, 0))
        a.r(f'shin.{sd}', lambda u, k=k: (16 - 6 * k, 0, 0))
        a.r(f'foot.{sd}', lambda u: (38, 0, 0))
        a.r(f'upper_arm.{sd}', lambda u, k=k: (8, 0, k * (22 + 3 * s(tau * u))))
    for i in range(3):
        a.r(f'cape_{i + 1:02d}', lambda u, i=i: ((26 if i == 0 else 9) + 5 * s(tau * (2 * u - 0.2 * i)), 0, 2 * s(tau * (u - 0.15 * i))))
    return m
