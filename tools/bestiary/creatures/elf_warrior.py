"""Elfo guerreiro: esguio, armadura leve em folhas, elmo de crista, lâmina-folha e escudo-folha."""
from lowpoly.mesh import Model, tube, box, spike, gem, plate, C, shade, keys
from lowpoly.humanoid import humanoid, head, humanoid_anims, cape
from lowpoly import gear

INFO = dict(
    id='elf_warrior', name='Elfo Guerreiro', tribe='Elves', tribe_dir='Elves', size_category='humanoide',
    description='Sentinela de uma floresta amaldiçoada: armadura de escamas-folha verde-musgo com bronze envelhecido, '
                'elmo de crista, meia-capa, lâmina em folha e escudo em folha. Olhos verdes espectrais.',
    variants=['elf_archer (arco + aljava, sem escudo)', 'elf_mage (cajado, capuz no lugar do elmo)',
              'elf_forest (paleta marrom/verde clara, sem ombreiras)', 'elf_dark (paleta roxo sombrio/preto, olhos vermelhos)'],
    sockets=['weapon.R', 'weapon.L'],
    notes='Animações sem root motion.')

SKIN, MOSS, DEEP, BRONZE, HAIR = C('#b7b09c'), C('#3d4b27'), C('#18261c'), C('#8f6f30'), C('#cfc7ab')
LEATHER = C('#3a281c')


def leaf(base, tip, half, out, color, bone, mat='metal_dark'):
    """Placa em folha (losango) com leve quina central para pegar luz."""
    bx, by, bz = base
    tx, ty, tz = tip
    mx, my, mz = (bx + tx) / 2 + out[0], (by + ty) / 2 * 1.0 + out[1], (bz + tz) / 2 + out[2]
    # eixo lateral perpendicular (aproximado no plano horizontal)
    import numpy as np
    d = np.array(tip, float) - np.array(base, float)
    side = np.cross(d, np.array(out, float) if any(out) else (0, 0, 1.0))
    side = side / max(np.linalg.norm(side), 1e-9) * half
    c = np.array((mx, my, mz))
    a = np.array(base, float) * 0.45 + np.array(tip, float) * 0.55
    l, r = a + side, a - side
    return plate([base, l, c, r, tip], tris=[(0, 1, 2), (0, 2, 3), (1, 4, 2), (2, 4, 3)], color=color, mat='cloth' if mat == 'cloth' else 'membrane', bones=bone)


def build():
    m = Model('elf_warrior')
    L = humanoid(m, H=1.92, head_h=0.235, head_w=0.085, neck=0.07, leg=0.53, shoulder=0.19, hip=0.088,
                 chest=(0.165, 0.110), waist=(0.122, 0.088), pelvis=(0.148, 0.104), arm_r=0.046, leg_r=0.076, limb_sides=8,
                 arm_len=0.63, cape_bones=3,
                 col=dict(skin=SKIN, torso=DEEP, pants=C('#2a322b'), boots=LEATHER, sleeve=C('#243226'),
                          bracer=C('#243226'), hand=C('#2a1e16')))
    F = head(m, L, eye='glow_green', eye_size=0.95, eye_slant=0.9, nose=0.8,
             rings=[(0.00, 0.26, 0.26, 0.42), (0.18, 0.66, 0.74, 0.16), (0.44, 0.96, 1.02, 0.00),
                    (0.72, 1.00, 1.08, -0.03), (0.92, 0.76, 0.86, -0.08), (1.00, 0.30, 0.36, -0.10)])
    b, h, w = F.b, F.h, F.w
    # orelhas longas
    for sx in (1, -1):
        m.add(tube([b + (sx * w * 0.92, 0.50 * h, -0.005), b + (sx * (w + 0.035), 0.62 * h, -0.04), b + (sx * (w + 0.075), 0.90 * h, -0.13)],
                   [(0.03, 0.012), (0.026, 0.01), 0], sides=4, color=shade(SKIN, 0.92), mat='skin', bones='head',
                   hint=(0, 1, 0), caps=(False, False)))
    # elmo aberto com crista varrida para trás e protetores de bochecha
    m.add(tube([b + (0, 0.69 * h, -0.03 * w), b + (0, 0.76 * h, -0.03 * w), b + (0, 0.94 * h, -0.08 * w), b + (0, 1.06 * h, -0.14 * w)],
               [(w * 1.10, w * 1.18), (w * 1.12, w * 1.20), (w * 0.84, w * 0.96), (w * 0.22, w * 0.3)],
               sides=8, phase=22.5, axis=(0, 1, 0), color=MOSS, mat='metal_dark', bones='head'))
    zf = F.zf(0.72)
    m.add(tube([b + (0, 0.47 * h, zf + 0.012), b + (0, 0.74 * h, zf + 0.014)], [(0.008, 0.008), (0.02, 0.012)], sides=4,
               color=BRONZE, mat='gold', bones='head'))                                   # nasal
    m.add(plate([b + (0, 0.80 * h, zf * 0.9), b + (0, 1.20 * h, 0.01), b + (0, 1.34 * h, -0.20), b + (0, 1.02 * h, -0.30),
                 b + (0, 0.86 * h, -0.14)], color=BRONZE, mat='membrane', bones='head'))  # crista
    for sx in (1, -1):
        m.add(plate([b + (sx * w * 1.04, 0.70 * h, 0.05), b + (sx * w * 0.98, 0.70 * h, -0.05), b + (sx * w * 0.80, 0.22 * h, 0.035),
                     b + (sx * w * 0.9, 0.40 * h, 0.075)], color=MOSS, mat='membrane', bones='head'))
    # cabelo longo e claro
    m.add(tube([b + (0, 0.62 * h, -w * 1.0), b + (0, 0.20 * h, -w * 1.25), (0, L.shY - 0.06, -0.165), (0, L.chestY - 0.06, -0.15)],
               [(0.07, 0.03), (0.062, 0.028), (0.045, 0.022), 0], sides=5, color=HAIR, mat='matte',
               bones=['head', 'head', 'chest', 'chest'], caps=(False, False)))
    # couraça com quina central + gola de bronze
    m.add(tube([(0, L.waistY - 0.01, 0), (0, L.waistY + 0.06, 0), (0, L.chestY, 0), (0, L.shY - 0.02, 0), (0, L.neckY + 0.012, 0)],
               [(0.134, 0.10), (0.142, 0.106), (0.183, 0.132), (0.178, 0.112), (0.085, 0.08)],
               sides=8, phase=0, axis=(0, 1, 0), color=MOSS, mat='metal_dark', bones=['spine', 'spine', 'chest', 'chest', 'chest'],
               alt=[(shade(MOSS, 1.25), 240, 300)]))
    m.add(tube([(0, L.neckY - 0.01, 0), (0, L.neckY + 0.035, 0)], [(0.092, 0.086), (0.066, 0.064)], sides=8, phase=0,
               axis=(0, 1, 0), color=BRONZE, mat='gold', bones='chest', caps=(False, False)))
    # duas fileiras de escamas-folha no peito
    for row, (y, n, rz) in enumerate(((L.chestY + 0.05, 3, 0.137), (L.chestY - 0.055, 2, 0.128))):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.085
            m.add(leaf((x, y + 0.05, rz - abs(x) * 0.25), (x, y - 0.075, rz - abs(x) * 0.25 + 0.004), 0.036, (0, 0, 0.018),
                       shade(MOSS, 1.15 if (i + row) % 2 else 0.9), 'chest'), )
            m.parts[-1].detail = 1
    # cinto + fivela + saiote de folhas
    wy = L.waistY - 0.05
    m.add(tube([(0, wy - 0.025, 0), (0, wy + 0.025, 0)], [(0.150, 0.110)] * 2, sides=8, phase=22.5, axis=(0, 1, 0),
               color=LEATHER, mat='leather', bones='hips', caps=(False, False)),
          gem((0, wy, 0.108), 0.028, 0.034, color=BRONZE, mat='gold', bones='hips'))
    import math
    for i, (ang, ln) in enumerate(((0, 0.30), (38, 0.36), (-38, 0.36), (80, 0.34), (-80, 0.34), (130, 0.36), (-130, 0.36), (180, 0.32))):
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        base = (0.150 * sa, wy - 0.01, 0.110 * ca)
        tip = (0.205 * sa, wy - ln, 0.150 * ca)
        bone = 'hips' if abs(ang) in (0, 180) else ('thigh.L' if ang > 0 else 'thigh.R')
        m.add(leaf(base, tip, 0.062, (0.03 * sa, 0, 0.03 * ca), MOSS if i % 2 else shade(MOSS, 0.8), ('hips', bone, 0.5)))
    # ombreiras em folha dupla
    sh = L.sh
    for k, (up, out, r) in enumerate(((0.13, 0.13, 0.082), (0.05, 0.16, 0.07))):
        p = tube([sh + (-0.045, -0.01, 0), sh + (out * 0.5, up * 0.55, 0), sh + (out, up, -0.01)],
                 [(r * 0.8, r * 1.0), (r * 0.72, r * 0.95), 0], sides=5, color=MOSS if k else shade(MOSS, 1.2), mat='metal_dark',
                 bones=('chest', 'upper_arm.L', 0.55), caps=(False, False))
        m.add(p, p.mirror())
    # braçadeiras e joelheiras de bronze
    d = L.arm_dir
    br = tube([L.elbow + d * 0.02, L.elbow + d * 0.16, L.wrist - d * 0.01], [0.056, 0.05, 0.04], sides=6, phase=30,
              color=BRONZE, mat='gold', bones='forearm.L', caps=(False, False))
    fin = spike(L.elbow + (0.02, 0.0, -0.03), L.elbow + (0.05, 0.11, -0.09), (0.02, 0.035), sides=3, color=BRONZE, mat='gold',
                bones='forearm.L', detail=1)
    kn = tube([L.knee + (0, -0.09, 0.05), L.knee + (0, 0.02, 0.066), L.knee + (0, 0.13, 0.05)], [(0.05, 0.02), (0.058, 0.03), 0],
              sides=4, color=BRONZE, mat='gold', bones='shin.L', caps=(True, False))
    cuff = tube([L.knee + (0, -0.10, -0.01), L.knee + (0, -0.04, -0.005)], [0.064, 0.075], sides=6, phase=30, color=shade(LEATHER, 1.2),
                mat='leather', bones='shin.L', caps=(False, False))
    m.add(br, br.mirror(), fin, fin.mirror(), kn, kn.mirror(), cuff, cuff.mirror())
    # meia-capa caída para o lado esquerdo
    zb = -0.135
    c = cape(m, [(L.shY + 0.01, 0.17, zb, 'chest'), (L.chestY - 0.05, 0.22, zb - 0.03, 'cape_01'), (L.hipY + 0.02, 0.26, zb - 0.07, 'cape_02'),
                 (L.kneeY + 0.14, 0.29, zb - 0.10, 'cape_03')], DEEP, cols=7, curve=0.30, jag=0.11)
    c[0].move(0.045, 0, 0)
    # lâmina-folha e escudo-folha
    m.add(gear.hold(gear.sword(0.92, 0.047, 'leaf', blade=C('#8e9a8f'), accent=BRONZE), L, 'R', tilt=62))
    fm = (L.elbow + L.wrist) / 2
    for p in gear.leaf_shield(0.66, 0.21, color=C('#22382a'), rim=BRONZE):
        m.add(p.rot('y', 68).move(fm[0] + 0.055, fm[1] + 0.03, fm[2] + 0.02).bind('forearm.L'))

    humanoid_anims(m, stride=28, arm=20, walk_dur=1.0, run_dur=0.58, cape=3,
                   stance={'upper_arm.R': (-6, 0, -6), 'forearm.R': (-22, 0, 0), 'upper_arm.L': (-10, 0, 8),
                           'forearm.L': (-40, 0, 0), 'thigh.L': (-6, 0, 3), 'thigh.R': (5, 0, -3), 'shin.R': (6, 0, 0)})
    return m
