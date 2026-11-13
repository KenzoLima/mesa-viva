"""Equipamentos intercambiáveis. Todos nascem com o punho na origem e a lâmina ao longo de +Y;
`hold()` leva a peça para o soquete da mão (weapon.R / weapon.L)."""
import numpy as np
from .mesh import tube, box, spike, gem, plate, C, shade

STEEL, IRON, RUST = C('#7d8288'), C('#4a4d54'), C('#6b3a22')
WOOD, LEATHER, GOLD, BONE = C('#4a3222'), C('#33221a'), C('#9c7833'), C('#c9bc96')


def hold(parts, L, side='R', tilt=65, yaw=0, roll=0):
    """Posiciona na mão: tilt 90 = apontando para a frente, 0 = para cima."""
    sx = 1 if side == 'L' else -1
    palm = L.palm * (sx, 1, 1)
    out = []
    for p in parts:
        p.rot('y', 90 + roll).rot('x', tilt).rot('y', yaw).move(*palm).bind(f'weapon.{side}')
        out.append(p)
    return out


def sword(length=0.95, width=0.045, style='straight', blade=STEEL, guard=IRON, grip=LEATHER, accent=GOLD):
    t = width * 0.28
    parts = [tube([(0, -0.10, 0), (0, 0.075, 0)], [0.016, 0.014], sides=5, color=grip, mat='leather'),
             gem((0, -0.125, 0), 0.026, 0.03, color=accent, mat='gold')]
    y0 = 0.09
    if style == 'leaf':      # élfica: estreita na base, larga no terço final, guarda em asa
        prof = [(0.0, 0.55), (0.18, 0.50), (0.62, 1.05), (0.86, 0.70), (1.0, 0)]
        parts.append(tube([(-0.085, y0 + 0.03, 0), (-0.04, y0 - 0.005, 0), (0, y0, 0), (0.04, y0 - 0.005, 0), (0.085, y0 + 0.03, 0)],
                          [0, (0.016, 0.014), (0.022, 0.02), (0.016, 0.014), 0], sides=4, color=accent, mat='gold', hint=(0, 1, 0)))
    elif style == 'rapier':  # vampírica: lâmina fina, guarda em cruz longa com pontas e copo
        prof = [(0.0, 0.50), (0.5, 0.36), (0.9, 0.2), (1.0, 0)]
        parts.append(tube([(-0.12, y0 + 0.012, 0), (0, y0, 0), (0.12, y0 + 0.012, 0)], [0, 0.015, 0], sides=4, color=guard, mat='metal_dark', hint=(0, 1, 0)))
        parts.append(tube([(0, y0 - 0.055, 0), (0, y0 - 0.01, 0)], [0.022, 0.05], sides=6, color=accent, mat='gold', caps=(True, True)))
        parts.append(gem((0, y0 + 0.012, 0.02), 0.014, color=(1, 1, 1), mat='glow_red', detail=1))
    elif style == 'cleaver':  # goblin: facão torto e lascado
        w = width
        pts = [(-w * 0.35, y0, 0), (w * 0.55, y0 + 0.02, 0), (w * 1.25, y0 + length * 0.45, 0), (w * 1.0, y0 + length * 0.62, 0),
               (w * 1.35, y0 + length * 0.80, 0), (w * 0.45, y0 + length, 0), (-w * 0.55, y0 + length * 0.86, 0)]
        back = [(x, y, t) for x, y, _ in pts]
        front = [(x, y, -t) for x, y, _ in pts]
        n = len(pts)
        b = plate(front + back, tris=[(0, i + 1, i) for i in range(1, n - 1)] + [(n, n + i, n + i + 1) for i in range(1, n - 1)] +
                  [q for i in range(n) for q in ((i, (i + 1) % n, n + (i + 1) % n), (i, n + (i + 1) % n, n + i))],
                  color=blade, mat='metal_dark')
        parts += [b, box((0, y0 - 0.008, 0), (0.07, 0.022, 0.03), color=guard, mat='metal_dark')]
        return parts
    else:
        prof = [(0.0, 1.0), (0.8, 0.82), (1.0, 0)]
        parts.append(box((0, y0, 0), (0.20, 0.026, 0.034), color=guard, mat='metal_dark'))
    parts.append(tube([(0, y0 + length * u, 0) for u, _ in prof], [(width * k, t * (0.6 + 0.4 * k)) if k else 0 for _, k in prof],
                      sides=4, color=blade, mat='metal', caps=(True, False), hint=(1, 0, 0)))
    return parts


def round_shield(r=0.28, color=WOOD, rim=IRON, boss=IRON, planks=True):
    """Escudo redondo virado para +Z, centro na origem."""
    parts = [tube([(0, 0, 0), (0, 0, 0.03), (0, 0, 0.05)], [r, r * 0.97, r * 0.55], sides=8, phase=22.5, color=color,
                  axis=(0, 0, 1), mat='leather'),
             tube([(0, 0, 0.045), (0, 0, 0.075), (0, 0, 0.10)], [r * 0.30, r * 0.22, 0], sides=6, color=boss, axis=(0, 0, 1), mat='metal_dark')]
    return parts


def leaf_shield(h=0.62, w=0.20, color=C('#1d3323'), rim=GOLD):
    """Escudo élfico em folha, virado para +Z."""
    out = [(0, h * 0.55), (w * 0.75, h * 0.28), (w, 0), (w * 0.7, -h * 0.28), (0, -h * 0.5), (-w * 0.7, -h * 0.28), (-w, 0), (-w * 0.75, h * 0.28)]
    n = len(out)
    pts = [(0, 0.02, 0.055)] + [(x, y, 0.0) for x, y in out] + [(0, 0, -0.01)]
    tris = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)] + [(n + 1, 1 + (i + 1) % n, 1 + i) for i in range(n)]
    p = plate(pts, tris, color=color, mat='metal_dark')
    p.fc[::2][:4] = shade(color, 1.25)
    rib = tube([(0, -h * 0.5, 0.012), (0, 0, 0.062), (0, h * 0.55, 0.012)], [0.006, (0.018, 0.012), 0.006], sides=4, color=rim, mat='gold')
    return [p, rib]
