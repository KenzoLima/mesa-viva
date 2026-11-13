"""Corpo humanoide compartilhado (elfos, goblins, vampiros, humanos, zumbis, guerreiros...).

Uma base de corpo + esqueleto com nomes fixos; cada criatura muda proporções e cores e
pendura equipamentos nos ossos. Soquetes de arma: weapon.R / weapon.L.
"""
import math
from types import SimpleNamespace
import numpy as np
from .mesh import tube, box, spike, plate, Anim, keys, const, shade, C

GREY = dict(skin=C('#8f8a84'), torso=C('#77736e'), pants=C('#5f5c59'), boots=C('#484644'),
            sleeve=C('#77736e'), bracer=C('#5f5c59'), hand=C('#8f8a84'))


def humanoid(m, H=1.80, head_h=0.24, head_w=0.092, neck=0.06, leg=0.51, shoulder=0.20, hip=0.095,
             chest=(0.185, 0.125), waist=(0.145, 0.10), pelvis=(0.165, 0.115), arm_r=0.050, leg_r=0.078,
             arm_len=0.60, hand=1.0, foot=1.0, lean=0.0, neck_r=0.048, arm_out=0.10, col=None, cape_bones=0, limb_sides=6):
    """Monta esqueleto + corpo. Devolve os pontos de referência para pendurar equipamento."""
    col = {**GREY, **(col or {})}
    hipY = H * leg
    headBase = H - head_h
    neckY = headBase - neck
    torso = neckY - hipY
    waistY, chestY, shY = hipY + 0.28 * torso, hipY + 0.62 * torso, hipY + 0.90 * torso
    kneeY, ankleY = hipY * 0.53, 0.085 * foot * H / 1.8

    def zc(y):  # curva da coluna (postura curvada)
        return lean * float(np.interp(y, [hipY, waistY, chestY, shY, neckY, headBase], [0, .25, .7, 1, 1.25, 1.5]))

    L = SimpleNamespace(H=H, hipY=hipY, waistY=waistY, chestY=chestY, shY=shY, neckY=neckY, headBase=headBase,
                        kneeY=kneeY, ankleY=ankleY, zc=zc, head_h=head_h, head_w=head_w, shoulder=shoulder,
                        hip=hip, chest=chest, waist=waist, pelvis=pelvis, arm_r=arm_r, leg_r=leg_r, col=col)

    m.bone('root', None, (0, 0, 0))
    m.bone('hips', 'root', (0, hipY, 0))
    m.bone('spine', 'hips', (0, waistY, zc(waistY)))
    m.bone('chest', 'spine', (0, chestY, zc(chestY)))
    m.bone('neck', 'chest', (0, neckY, zc(neckY)))
    m.bone('head', 'neck', (0, headBase, zc(headBase)))
    L.head = np.array((0, headBase, zc(headBase)))

    # braços (pose A)
    d = np.array((arm_out, -1, 0.0)); d /= np.linalg.norm(d)
    sh = np.array((shoulder, shY, zc(shY)))
    ua, fa = arm_len * 0.48, arm_len * 0.52
    elbow, wrist = sh + d * ua, sh + d * (ua + fa)
    hl = 0.105 * hand * H / 1.8
    palm = wrist + d * hl * 0.55
    L.sh, L.elbow, L.wrist, L.palm, L.arm_dir = sh, elbow, wrist, palm, d
    for s, sx in (('L', 1), ('R', -1)):
        f = np.array((sx, 1, 1))
        m.bone(f'upper_arm.{s}', 'chest', sh * f)
        m.bone(f'forearm.{s}', f'upper_arm.{s}', elbow * f)
        m.bone(f'hand.{s}', f'forearm.{s}', wrist * f)
        m.bone(f'weapon.{s}', f'hand.{s}', palm * f)
    # pernas
    hipj = np.array((hip, hipY, 0.0))
    knee = np.array((hip * 1.08, kneeY, 0.015))
    ankle = np.array((hip * 1.15, ankleY, -0.01))
    L.hipj, L.knee, L.ankle = hipj, knee, ankle
    for s, sx in (('L', 1), ('R', -1)):
        f = np.array((sx, 1, 1))
        m.bone(f'thigh.{s}', 'hips', hipj * f)
        m.bone(f'shin.{s}', f'thigh.{s}', knee * f)
        m.bone(f'foot.{s}', f'shin.{s}', ankle * f)
    prev = 'chest'
    for i in range(cape_bones):
        y = shY - 0.02 - i * (shY - 0.12) / max(cape_bones, 1)
        prev_name = f'cape_{i + 1:02d}'
        m.bone(prev_name, prev, (0, y, zc(min(y, shY)) - chest[1] - 0.03))
        prev = prev_name

    # tronco
    m.add(tube(
        [(0, hipY - 0.085 * H / 1.8, 0), (0, hipY + 0.02, 0), (0, waistY, zc(waistY)), (0, chestY, zc(chestY)),
         (0, shY, zc(shY)), (0, neckY + 0.005, zc(neckY))],
        [(pelvis[0] * 0.62, pelvis[1] * 0.8), pelvis, waist, chest, (shoulder * 0.93, chest[1] * 0.86),
         (neck_r * 1.7, neck_r * 1.6)],
        sides=8, phase=22.5, axis=(0, 1, 0), color=col['torso'],
        bones=['hips', 'hips', 'spine', 'chest', 'chest', 'chest']))
    # a bacia usa a cor da calça
    m.parts[-1].paint(col['pants'], lambda c: c[:, 1] < hipY + 0.03)
    m.add(tube([(0, neckY - 0.03, zc(neckY)), (0, headBase + 0.04, zc(headBase))], [neck_r * 1.1, neck_r],
               sides=6, axis=(0, 1, 0), color=col['skin'], mat='skin', bones=['chest', 'neck'], caps=(False, False)))
    # braço + mão
    r = arm_r
    arm = tube([sh + (0, r * 0.9, 0), sh + d * r * 0.3, sh + d * ua * 0.55, elbow, elbow + d * fa * 0.4, wrist],
               [r * 0.75, r * 1.28, r * 1.0, r * 0.84, r * 0.95, r * 0.66], sides=limb_sides, phase=30, color=col['sleeve'],
               bones=['upper_arm.L', 'upper_arm.L', 'upper_arm.L', ('upper_arm.L', 'forearm.L', .5), 'forearm.L',
                      'forearm.L'], hint=(1, 0, 0))
    arm.paint(col['bracer'], lambda c: c[:, 1] < elbow[1])
    hnd = tube([wrist - d * 0.005, wrist + d * hl * 0.45, wrist + d * hl], [(r * 0.5, r * 0.75), (r * 0.62, r * 1.05),
               (r * 0.38, r * 0.7)], sides=5, color=col['hand'], mat='skin', bones='hand.L')
    thumb = spike(wrist + d * hl * 0.25 + (0, 0, r * 0.7), wrist + d * hl * 0.75 + (-0.01, 0, r * 1.7), r * 0.32,
                  sides=3, color=col['hand'], mat='skin', bones='hand.L', detail=1)
    m.add(arm, arm.mirror(), hnd, hnd.mirror(), thumb, thumb.mirror())
    # perna + pé
    r = leg_r
    legp = tube([hipj + (0, 0.03, 0), hipj + (0.004, -(hipY - kneeY) * 0.45, 0.01), knee, knee + (0.004, -(kneeY - ankleY) * 0.38, -0.022),
                 ankle + (0, 0.02, 0)],
                [(r * 1.12, r * 1.2), r * 1.0, r * 0.76, (r * 0.78, r * 0.88), r * 0.5], sides=limb_sides, phase=30,
                color=col['pants'], bones=['thigh.L', 'thigh.L', ('thigh.L', 'shin.L', .5), 'shin.L', 'shin.L'])
    legp.paint(col['boots'], lambda c: c[:, 1] < kneeY - 0.01)
    fl = 0.25 * foot * H / 1.8
    fw = 0.085 * foot * H / 1.8
    ax = ankle[0]
    footp = tube([(ax, ankleY * 0.62, -fl * 0.28), (ax, ankleY * 0.62, fl * 0.15), (ax, ankleY * 0.36, fl * 0.72)],
                 [(fw * 0.62, ankleY * 0.62), (fw * 0.75, ankleY * 0.62), (fw * 0.62, ankleY * 0.36)],
                 sides=4, phase=45, color=col['boots'], bones='foot.L', axis=(0, 0, 1))
    m.add(legp, legp.mirror(), footp, footp.mirror())
    return L


DEFAULT_RINGS = [  # (altura, rx, rz, deslocamento z) em frações de h / w
    (0.00, 0.34, 0.32, 0.42), (0.17, 0.74, 0.80, 0.16), (0.44, 1.00, 1.04, 0.00),
    (0.72, 1.02, 1.10, -0.03), (0.92, 0.76, 0.86, -0.08), (1.00, 0.30, 0.36, -0.10)]


def head(m, L, rings=None, skin=None, eye='glow_blue', eye_col=(1, 1, 1), eye_size=1.0, eye_slant=0.35,
         nose=1.0, brow=None, eye_y=0.56, eye_x=0.44):
    """Cabeça facetada: crânio em loft, sobrancelha, nariz e olhos. Devolve (frente_z, w, h)."""
    rings = rings or DEFAULT_RINGS
    skin = skin or L.col['skin']
    h, w = L.head_h, L.head_w
    b = L.head
    m.add(tube([b + (0, y * h, z * w) for y, _, _, z in rings], [(rx * w, rz * w) for _, rx, rz, _ in rings],
               sides=8, phase=22.5, axis=(0, 1, 0), color=skin, mat='skin', bones='head'))
    zf = lambda y: float(np.interp(y, [r[0] for r in rings], [r[3] * w + r[2] * w * 0.924 for r in rings]))
    xw = lambda y: float(np.interp(y, [r[0] for r in rings], [r[1] * w for r in rings]))
    if nose:
        m.add(tube([b + (0, 0.64 * h, zf(0.64) - 0.006), b + (0, 0.40 * h, zf(0.40) + 0.30 * w * nose)],
                   [(0.07 * w, 0.05 * w), (0.19 * w * nose, 0.10 * w)], sides=3, phase=90, color=shade(skin, 0.93),
                   mat='skin', bones='head', hint=(1, 0, 0)))
    bc = brow or shade(skin, 0.72)
    m.add(box(b + (0, 0.675 * h, zf(0.675) - 0.004), (xw(0.675) * 1.66, 0.055 * h, 0.03), color=bc, mat='skin',
              bones='head'))
    ex, ey, es = eye_x * w, eye_y * h, 0.20 * w * eye_size
    z = zf(eye_y) + 0.004
    mat = eye if eye.startswith('glow') else 'matte'
    for sx in (1, -1):
        m.add(plate([b + (sx * (ex - es), ey - es * eye_slant * 0.5, z), b + (sx * ex, ey - es * 0.55, z + 0.003),
                     b + (sx * (ex + es * 1.15), ey + es * eye_slant, z - 0.012), b + (sx * ex, ey + es * 0.5, z + 0.003)],
                    color=eye_col, mat=mat, bones='head'))
    return SimpleNamespace(zf=zf, xw=xw, w=w, h=h, b=b)


def cape(m, rows, color, lining=None, cols=5, curve=0.35, jag=0.0, mat='cloth'):
    """Capa em grade. rows = [(y, meia_largura, z, osso)]; jag = recorte em zigue-zague da barra."""
    pts, w = [], []
    for ri, (y, hw, z, bone) in enumerate(rows):
        for c in range(cols):
            a = -1 + 2 * c / (cols - 1)
            up = jag * (1 - c % 2) if ri == len(rows) - 1 else 0
            pts.append((hw * a, y + up, z + curve * hw * a * a))
            w.append(bone)
    tris = []
    for r in range(len(rows) - 1):
        for c in range(cols - 1):
            i = r * cols + c
            tris += [(i, i + 1, i + cols + 1), (i, i + cols + 1, i + cols)]
    out = [plate(pts, tris, color=color, mat=mat, bones=w)]
    out[0].g = out[0].g // 2 * 2
    if lining is not None:
        inner = plate([(x, y, z + 0.018) for x, y, z in pts], tris, color=lining, mat=mat, bones=w)
        inner.g = inner.g // 2 * 2
        out.append(inner)
    m.add(out)
    return out


# ---------------------------------------------------------------- animações base

def humanoid_anims(m, stride=30, arm=24, walk_dur=1.0, run_dur=0.62, stance=None, attack_dur=0.9,
                   cape=0, sway=1.0, lean_run=14, shuffle=False, stance_pos=None):
    """Idle, Walk, Run, Attack, Hit, Death. `stance` = pose de base somada a todas as animações."""
    s, tau = math.sin, 2 * math.pi
    stance = stance or {}

    def new(name, dur, loop=True):
        a = m.anim(Anim(name, dur, loop))
        for b, e in stance.items():
            a.r(b, const(*e))
        for b, e in (stance_pos or {}).items():
            a.p(b, const(*e))
        return a

    def cape_sway(a, base, amp, freq=1):
        for i in range(cape):
            a.r(f'cape_{i + 1:02d}', lambda u, i=i: (base * (1.0 if i == 0 else 0.45) + amp * s(tau * (freq * u - 0.18 * i)),
                                                     0, amp * 0.3 * s(tau * (u - 0.1 * i))))

    a = new('Idle', 2.4)
    a.r('chest', lambda u: (1.6 * s(tau * u) * sway, 2.0 * s(tau * u + 1) * sway, 0))
    a.r('spine', lambda u: (0.8 * s(tau * u), 0, 0.8 * s(tau * u + 0.5) * sway))
    a.r('head', lambda u: (-1.2 * s(tau * u), 5 * s(tau * u + 2.2) * sway, 0))
    a.r('upper_arm.L', lambda u: (1.5 * s(tau * u), 0, 1.5 * s(tau * u)))
    a.r('upper_arm.R', lambda u: (1.5 * s(tau * u + 0.4), 0, -1.5 * s(tau * u)))
    a.p('hips', lambda u: (0, -0.006 * (1 + s(tau * u)), 0))
    cape_sway(a, 3, 2.5)

    def gait(name, dur, A, B, bob, lean, knee):
        a = new(name, dur)
        for side, ph in (('L', 0.0), ('R', 0.5)):
            a.r(f'thigh.{side}', lambda u, ph=ph: (-A * s(tau * (u + ph)) - lean * 0.35, 0, 0))
            a.r(f'shin.{side}', lambda u, ph=ph: (knee * max(0.0, math.cos(tau * (u + ph))) ** 1.3 + 6, 0, 0))
            a.r(f'foot.{side}', lambda u, ph=ph: (-10 * s(tau * (u + ph)), 0, 0))
            a.r(f'upper_arm.{side}', lambda u, ph=ph: (B * s(tau * (u + ph)), 0, 0))
            a.r(f'forearm.{side}', lambda u, ph=ph: (-B * 0.6 - B * 0.4 * s(tau * (u + ph)), 0, 0))
        a.r('spine', lambda u: (lean, 5 * s(tau * u), 0))
        a.r('chest', lambda u: (lean * 0.3, 5 * s(tau * u), 2 * s(tau * u) if shuffle else 0))
        a.r('hips', lambda u: (0, -5 * s(tau * u), 3 * s(tau * u) if shuffle else 0))
        a.r('head', lambda u: (-lean * 0.8, -6 * s(tau * u), 0))
        a.p('hips', lambda u: (0, bob * math.cos(2 * tau * u) - bob, 0))
        cape_sway(a, 8 + lean * 0.9, 5, 2)
        return a
    gait('Walk', walk_dur, stride, arm, 0.018, 3, 42)
    gait('Run', run_dur, stride * 1.5, arm * 1.9, 0.04, lean_run, 80)

    a = new('Attack', attack_dur, False)
    a.r('upper_arm.R', keys((0, (0, 0, 0)), (.30, (-155, 0, -25)), (.46, (-55, 0, 12)), (.62, (15, 0, 25)), (1, (0, 0, 0))))
    a.r('forearm.R', keys((0, (0, 0, 0)), (.30, (-70, 0, 0)), (.46, (-8, 0, 0)), (.62, (-5, 0, 0)), (1, (0, 0, 0))))
    a.r('chest', keys((0, (0, 0, 0)), (.30, (-8, -28, 0)), (.48, (14, 26, 0)), (.65, (10, 20, 0)), (1, (0, 0, 0))))
    a.r('spine', keys((0, (0, 0, 0)), (.30, (-4, -10, 0)), (.48, (10, 10, 0)), (1, (0, 0, 0))))
    a.r('head', keys((0, (0, 0, 0)), (.30, (4, 22, 0)), (.48, (-8, -18, 0)), (1, (0, 0, 0))))
    a.r('upper_arm.L', keys((0, (0, 0, 0)), (.30, (-25, 0, 20)), (.48, (25, 0, 30)), (1, (0, 0, 0))))
    a.r('thigh.L', keys((0, (0, 0, 0)), (.30, (8, 0, 0)), (.48, (-28, 0, 0)), (.7, (-20, 0, 0)), (1, (0, 0, 0))))
    a.r('shin.L', keys((0, (0, 0, 0)), (.48, (30, 0, 0)), (.7, (22, 0, 0)), (1, (0, 0, 0))))
    a.r('thigh.R', keys((0, (0, 0, 0)), (.48, (14, 0, 0)), (1, (0, 0, 0))))
    a.p('hips', keys((0, (0, 0, 0)), (.30, (0, 0, -0.04)), (.48, (0, -0.07, 0.10)), (.7, (0, -0.05, 0.08)), (1, (0, 0, 0))))
    for i in range(cape):
        a.r(f'cape_{i + 1:02d}', keys((0, (3, 0, 0)), (.48, (22, 0, 0)), (1, (3, 0, 0))))

    a = new('Hit', 0.5, False)
    a.r('chest', keys((0, (0, 0, 0)), (.25, (-20, 12, 0)), (1, (0, 0, 0))))
    a.r('head', keys((0, (0, 0, 0)), (.2, (-16, 10, 0)), (.55, (8, 0, 0)), (1, (0, 0, 0))))
    a.r('upper_arm.L', keys((0, (0, 0, 0)), (.25, (20, 0, 28)), (1, (0, 0, 0))))
    a.r('upper_arm.R', keys((0, (0, 0, 0)), (.25, (25, 0, -24)), (1, (0, 0, 0))))
    a.r('thigh.R', keys((0, (0, 0, 0)), (.3, (18, 0, 0)), (1, (0, 0, 0))))
    a.p('hips', keys((0, (0, 0, 0)), (.25, (0, -0.03, -0.09)), (1, (0, 0, 0))))

    hipY = m.bones['hips'][1][1]
    a = new('Death', 1.7, False)
    a.r('hips', keys((0, (0, 0, 0)), (.30, (8, 0, 0)), (.55, (-30, 0, 4)), (.82, (-88, 0, 6)), (1, (-88, 0, 6))))
    a.p('hips', keys((0, (0, 0, 0)), (.30, (0, -hipY * 0.35, 0)), (.55, (0, -hipY * 0.55, -0.1)),
                     (.82, (0, -hipY + 0.13, -0.25)), (1, (0, -hipY + 0.13, -0.25))))
    for sd, k in (('L', 1), ('R', -1)):
        a.r(f'thigh.{sd}', keys((0, (0, 0, 0)), (.30, (-55, 0, 6 * k)), (.55, (-70, 0, 10 * k)), (.85, (-12 + 8 * k, 0, 9 * k)), (1, (-12 + 8 * k, 0, 9 * k))))
        a.r(f'shin.{sd}', keys((0, (0, 0, 0)), (.30, (95, 0, 0)), (.55, (110, 0, 0)), (.85, (18 + 10 * k, 0, 0)), (1, (18 + 10 * k, 0, 0))))
        a.r(f'upper_arm.{sd}', keys((0, (0, 0, 0)), (.30, (-20, 0, 25 * k)), (.6, (-60, 0, 50 * k)), (.88, (-10, 0, 62 * k)), (1, (-10, 0, 62 * k))))
        a.r(f'forearm.{sd}', keys((0, (0, 0, 0)), (.6, (-40, 0, 0)), (.88, (-15, 0, 0)), (1, (-15, 0, 0))))
    a.r('chest', keys((0, (0, 0, 0)), (.30, (18, 0, 0)), (.6, (-12, 0, 0)), (.9, (0, 0, 0)), (1, (0, 0, 0))))
    a.r('head', keys((0, (0, 0, 0)), (.30, (20, 0, 0)), (.6, (-22, 10, 0)), (.9, (-4, 25, 0)), (1, (-4, 25, 0))))
    for i in range(cape):
        a.r(f'cape_{i + 1:02d}', keys((0, (3, 0, 0)), (.5, (25, 0, 0)), (.85, (0, 0, 0)), (1, (0, 0, 0))))
    m.present = (m.anims[0], 0.1)
    return new
