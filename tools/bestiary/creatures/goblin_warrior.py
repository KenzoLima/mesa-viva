"""Goblin guerreiro: pequeno, curvado, cabeçudo, com sucata no lugar de armadura."""
import math
from lowpoly.mesh import Model, tube, box, spike, gem, plate, C, shade, keys
from lowpoly.humanoid import humanoid, head, humanoid_anims
from lowpoly import gear

INFO = dict(
    id='goblin_warrior', name='Goblin Guerreiro', tribe='Goblins', tribe_dir='Goblins', size_category='pequena',
    description='Saqueador das ruínas: pele cor de musgo, olhos amarelos acesos, elmo de panela enferrujada, '
                'facão lascado e um escudo de tábuas. Pequeno, curvado e rápido.',
    variants=['goblin_archer (trocar facão/escudo por arco)', 'goblin_shaman (cajado, sem elmo)',
              'goblin_scrap_armor (placas extras)', 'goblin_chief (escala 1.25, elmo com chifres)'],
    sockets=['weapon.R', 'weapon.L'],
    notes='Animações sem root motion. Extras: Dodge.')

SKIN = C('#56692f')
RUSTM, IRON, RAG, HIDE, BONE = C('#6e4426'), C('#45464b'), C('#5c1c17'), C('#3a2a1c'), C('#cdbf97')
RINGS = [(0.00, 0.50, 0.42, 0.62), (0.20, 0.98, 0.86, 0.26), (0.46, 1.10, 1.00, 0.00),
         (0.72, 1.00, 1.00, -0.05), (0.91, 0.70, 0.80, -0.10), (1.00, 0.26, 0.30, -0.12)]


def build():
    m = Model('goblin_warrior')
    L = humanoid(m, H=1.05, head_h=0.30, head_w=0.135, neck=0.02, leg=0.36, shoulder=0.165, hip=0.085,
                 chest=(0.15, 0.12), waist=(0.13, 0.105), pelvis=(0.135, 0.11), arm_r=0.040, leg_r=0.056,
                 arm_len=0.50, hand=1.9, foot=1.7, lean=0.07, neck_r=0.045, arm_out=0.22,
                 col=dict(skin=SKIN, torso=HIDE, pants=shade(HIDE, 0.8), boots=shade(SKIN, 0.85), sleeve=SKIN,
                          bracer=C('#2e2019'), hand=shade(SKIN, 0.9)))
    F = head(m, L, rings=RINGS, eye='glow_yellow', eye_size=1.55, eye_slant=0.7, nose=0, eye_y=0.60, eye_x=0.50,
             brow=shade(SKIN, 0.6))
    b, h, w = F.b, F.h, F.w
    # nariz adunco
    m.add(tube([b + (0, 0.60 * h, F.zf(0.6) - 0.01), b + (0, 0.50 * h, F.zf(0.5) + 0.075), b + (0, 0.36 * h, F.zf(0.4) + 0.085)],
               [(0.022, 0.02), (0.036, 0.03), 0], sides=4, color=shade(SKIN, 0.86), mat='skin', bones='head', caps=(False, False)))
    # orelhas enormes, uma rasgada
    for sx in (1, -1):
        tip = b + (sx * (w + 0.20), 0.80 * h, -0.07)
        m.add(tube([b + (sx * w * 0.9, 0.56 * h, -0.01), b + (sx * (w + 0.09), 0.62 * h, -0.035), tip],
                   [(0.075, 0.02), (0.06 if sx > 0 else 0.04, 0.014), 0], sides=4, color=shade(SKIN, 0.92), mat='skin',
                   bones='head', hint=(0, 1, 0), caps=(False, False)))
    # mandíbula projetada com presas tortas
    zj = F.zf(0.12)
    for x, hh, dt in ((0.045, 0.062, 0), (-0.05, 0.05, 0), (0.014, 0.03, 1), (-0.02, 0.034, 1), (0.075, 0.03, 1)):
        m.add(spike(b + (x, 0.17 * h, zj - 0.008), b + (x * 1.05, 0.17 * h + hh, zj + 0.012), 0.013, sides=3,
                    color=BONE, mat='bone', bones='head', detail=dt, cap=False))
    # elmo: panela enferrujada com aba e uma ponta de osso
    top = b + (0, h, -0.10 * w)
    m.add(tube([b + (0, 0.74 * h, -0.03 * w), b + (0, 0.78 * h, -0.03 * w), b + (0, 0.80 * h, -0.04 * w), b + (0, 0.97 * h, -0.08 * w), top + (0, 0.035, 0)],
               [(w * 1.28, w * 1.30), (w * 1.30, w * 1.32), (w * 1.07, w * 1.10), (w * 0.86, w * 0.92), (w * 0.40, w * 0.44)],
               sides=8, phase=22.5, axis=(0, 1, 0), color=RUSTM, mat='metal_dark', bones='head'))
    m.add(spike(top + (0.01, 0.02, 0), top + (0.03, 0.12, -0.03), 0.028, color=BONE, mat='bone', bones='head'))
    # ombreira única: tampa de caldeirão com cravo
    sh = L.sh
    m.add(tube([sh + (-0.02, 0.0, 0), sh + (0.03, 0.055, 0), sh + (0.07, 0.075, 0)], [(0.085, 0.09), (0.07, 0.075), (0.02, 0.02)],
               sides=6, color=IRON, mat='metal_dark', bones=('chest', 'upper_arm.L', 0.6)),
          spike(sh + (0.06, 0.07, 0), sh + (0.14, 0.15, 0), 0.02, color=RUSTM, mat='metal_dark', bones=('chest', 'upper_arm.L', 0.6)))
    # corda na cintura, tanga rasgada, dentes de troféu
    wy, zc = L.waistY - 0.03, L.zc(L.waistY)
    m.add(tube([(0, wy - 0.018, zc * 0.6), (0, wy + 0.018, zc * 0.6)], [(0.142, 0.118)] * 2, sides=8, phase=22.5, axis=(0, 1, 0),
               color=C('#7a6a45'), mat='leather', bones='hips', caps=(False, False)))
    hy = L.hipY
    m.add(plate([(-0.07, wy, 0.115), (0.075, wy, 0.115), (0.085, hy - 0.10, 0.125), (0.03, hy - 0.19, 0.12), (0.0, hy - 0.11, 0.125), (-0.045, hy - 0.16, 0.12)],
                color=RAG, bones='hips'),
          plate([(0.08, wy, -0.11), (-0.08, wy, -0.11), (-0.09, hy - 0.13, -0.12), (-0.02, hy - 0.08, -0.12), (0.04, hy - 0.17, -0.115)],
                color=shade(RAG, 0.8), bones='hips'))
    cy, cz = L.chestY + 0.035, L.zc(L.chestY) + 0.118
    for i, x in enumerate((-0.05, 0.0, 0.05)):
        m.add(spike((x, cy - abs(x) * 0.3, cz), (x, cy - 0.055 - abs(x) * 0.3, cz + 0.012), 0.012, sides=3, color=BONE, mat='bone',
                    bones='chest', detail=1, cap=False))
    # garras nos pés
    for sx in (1, -1):
        ax = L.ankle[0] * sx
        for dx in (-0.03, 0.0, 0.03):
            m.add(spike((ax + dx, 0.03, 0.145), (ax + dx * 1.3, 0.008, 0.20), 0.012, sides=3, color=shade(BONE, 0.7), mat='bone',
                        bones=f'foot.{"L" if sx > 0 else "R"}', detail=1, cap=False))
    # facão e escudo de tábuas
    m.add(gear.hold(gear.sword(0.34, 0.062, 'cleaver', blade=C('#585a5e'), guard=RUSTM), L, 'R', tilt=55))
    fm = (L.elbow + L.wrist) / 2
    for p in gear.round_shield(0.17, color=C('#4b3524'), boss=RUSTM):
        m.add(p.rot('y', 62).move(fm[0] + 0.045, fm[1], fm[2] + 0.02).bind('forearm.L'))

    new = humanoid_anims(
        m, stride=34, arm=30, walk_dur=0.70, run_dur=0.44, attack_dur=0.55, shuffle=True, lean_run=20,
        stance={'spine': (10, 0, 0), 'head': (-16, 0, 0), 'thigh.L': (-24, 0, 6), 'thigh.R': (-24, 0, -6),
                'shin.L': (44, 0, 0), 'shin.R': (44, 0, 0), 'foot.L': (-20, 0, 0), 'foot.R': (-20, 0, 0),
                'upper_arm.L': (-12, 0, 10), 'upper_arm.R': (-8, 0, -12), 'forearm.L': (-48, 0, 0), 'forearm.R': (-36, 0, 0)},
        stance_pos={'hips': (0, -0.022, 0)})
    a = new('Dodge', 0.6, False)
    a.p('hips', keys((0, (0, 0, 0)), (.35, (0.16, -0.10, -0.05)), (.6, (0.16, -0.08, -0.05)), (1, (0, 0, 0))))
    a.r('spine', keys((0, (0, 0, 0)), (.35, (14, 0, -22)), (.6, (12, 0, -18)), (1, (0, 0, 0))))
    a.r('head', keys((0, (0, 0, 0)), (.35, (-6, 0, 16)), (1, (0, 0, 0))))
    for sd in 'LR':
        a.r(f'thigh.{sd}', keys((0, (0, 0, 0)), (.35, (-24, 0, 0)), (.6, (-20, 0, 0)), (1, (0, 0, 0))))
        a.r(f'shin.{sd}', keys((0, (0, 0, 0)), (.35, (40, 0, 0)), (.6, (34, 0, 0)), (1, (0, 0, 0))))
    a.r('upper_arm.L', keys((0, (0, 0, 0)), (.35, (-30, 0, 30)), (1, (0, 0, 0))))
    return m
