"""Gera o Bestiário: GLB (LOD0/1/2), pranchas PNG, paleta e metadados JSON.

    python tools/bestiary/build.py                 # tudo
    python tools/bestiary/build.py goblin_warrior  # só uma criatura
    python tools/bestiary/build.py --no-render     # só modelos e metadados

Saída em MesaVivaAR/Bestiary/<Tribo>/{Models,Textures,Materials,Animations,Renders,Metadata}/<criatura>/.
"""
import importlib
import json
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from lowpoly import mesh, render  # noqa: E402
from lowpoly.gltf import write_glb, verify_glb, FPS  # noqa: E402
from lowpoly.humanoid import humanoid, head, humanoid_anims  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / 'Bestiary'
CREATURES = ['dragon_red', 'elf_warrior', 'goblin_warrior', 'vampire_lord']
BUDGET = {'pequena': (500, 1500), 'humanoide': (1500, 4000), 'grande': (3000, 7000),
          'especial': (5000, 10000), 'colossal': (8000, 15000)}
PANEL = (520, 600)


def mannequin():
    m = mesh.Model('human_reference')
    L = humanoid(m)
    head(m, L, eye='matte', eye_col=(0.1, 0.1, 0.1))
    humanoid_anims(m)
    return m


def posed(m):
    A = m.arrays()
    if m.present:
        rot, pos = m.present[0].sample(m.present[1])
        A = {**A, 'P': m.posed(A, rot, pos)}
    return A


def build_one(cid, do_render=True):
    mod = importlib.import_module(f'creatures.{cid}')
    info = mod.INFO
    PANEL = info.get('panel', globals()['PANEL'])
    APANEL = info.get('anim_panel', (300, 340))
    tribe = OUT / info['tribe_dir']
    d = {k: tribe / k / cid for k in ('Models', 'Textures', 'Materials', 'Animations', 'Renders', 'Metadata')}
    for p in d.values():
        p.mkdir(parents=True, exist_ok=True)

    files, lods, m0 = {}, [], None
    for lod in (0, 1, 2):
        mesh.set_lod(lod)
        m = mod.build()
        name = f'{cid}.glb' if lod == 0 else f'{cid}_LOD{lod}.glb'
        extras = {'id': cid, 'tribe': info['tribe'], 'lod': lod, 'units': 'meters', 'up': '+Y', 'forward': '+Z'}
        write_glb(d['Models'] / name, m, extras)
        v = verify_glb(d['Models'] / name)        # relido do disco
        lods.append({'lod': lod, 'file': f'Models/{cid}/{name}', 'triangles': v['triangles'], 'bytes': v['bytes']})
        if lod == 0:
            m0, v0 = m, v
    mesh.set_lod(0)
    web = OUT.parent / 'web' / 'public' / 'models' / 'bestiary'     # cópia para o visualizador do app web
    if web.parent.exists():
        web.mkdir(exist_ok=True)
        shutil.copyfile(d['Models'] / f'{cid}.glb', web / f'{cid}.glb')

    A = m0.arrays()
    rest = A['P']
    size = rest.reshape(-1, 3).max(0) - rest.reshape(-1, 3).min(0)
    height = float(rest[:, :, 1].max())
    lo, hi = BUDGET[info['size_category']]
    used = sorted(set(A['M']))

    # paleta (PNG) e materiais (JSON)
    cols = np.unique((np.concatenate([p.fc for p in m0.parts]) * 255).round().astype(np.uint8), axis=0)
    sw = np.zeros((16, 16 * len(cols), 3), np.uint8)
    for i, c in enumerate(cols):
        sw[:, i * 16:(i + 1) * 16] = c
    Image.fromarray(sw).save(d['Textures'] / f'{cid}_palette.png')
    mats = [{'name': 'BST_' + n, 'metallic': mesh.MATERIALS[n][0], 'roughness': mesh.MATERIALS[n][1],
             'emissive': mesh.MATERIALS[n][2], 'doubleSided': mesh.MATERIALS[n][3],
             'baseColor': 'COLOR_0 (cor por vértice, linear)'} for n in used]
    (d['Materials'] / f'{cid}_materials.json').write_text(json.dumps(mats, indent=2, ensure_ascii=False), encoding='utf-8')
    clips = [{'name': a.name, 'duration': a.duration, 'loop': a.loop, 'fps': FPS, 'root_motion': False}
             for a in m0.anims]
    (d['Animations'] / f'{cid}_animations.json').write_text(json.dumps(
        {'embedded_in': f'Models/{cid}/{cid}.glb', 'clips': clips}, indent=2, ensure_ascii=False), encoding='utf-8')

    renders = []
    if do_render:
        Ap = posed(m0)
        P, Cc, M = Ap['P'], Ap['C'], Ap['M']
        views = [('front', 'Frente', 0, 0, 'lit'), ('side', 'Lateral', 90, 0, 'lit'), ('back', 'Costas', 180, 0, 'lit'),
                 ('threequarter', 'Perspectiva 3/4', 35, 14, 'lit'), ('wireframe', 'Wireframe', 35, 14, 'wire'),
                 ('materials', 'Materiais', 35, 14, 'mat')]
        panels = []
        for key, lab, yaw, pitch, mode in views:
            im = render.raster(P, Cc, M, yaw, pitch, PANEL, mode)
            im.save(d['Renders'] / f'{cid}_{key}.png')
            sub = ', '.join(n for n in used) if mode == 'mat' else (f"{v0['triangles']} tris" if mode == 'wire' else None)
            panels.append(render.label(im.copy(), lab, sub))
        mesh.set_lod(0)
        hm = mannequin()
        hA = posed(hm)
        sc = render.scale_panel(P, Cc, M, hA['P'], hA['C'], hA['M'], PANEL, float(P[:, :, 1].max()))
        sc.save(d['Renders'] / f'{cid}_scale.png')
        panels.append(render.label(sc.copy(), 'Escala', 'ao lado do humano padrão (1,80 m)'))
        # LODs lado a lado
        lp = []
        for lod in (0, 1, 2):
            mesh.set_lod(lod)
            Al = posed(mod.build())
            lp.append(Al)
        mesh.set_lod(0)
        w3 = PANEL[0] // 3
        lodimg = Image.new('RGB', PANEL, (12, 12, 15))
        sc_l, ce_l = render.fit(lp[0]['P'], 35, 14, (w3, PANEL[1]))
        for i, Al in enumerate(lp):
            lodimg.paste(render.raster(Al['P'], Al['C'], Al['M'], 35, 14, (w3, PANEL[1]), 'lit', sc_l, ce_l), (i * w3, 0))
        panels.append(render.label(lodimg, 'LOD 0 / 1 / 2', ' / '.join(f"{x['triangles']} tris" for x in lods)))
        title = f"{info['name']}  ·  {info['tribe']}"
        sub = f"{v0['triangles']} tris  ·  {height:.2f} m  ·  {v0['joints']} ossos  ·  {len(clips)} animações  ·  categoria {info['size_category']}"
        render.sheet(title, sub, panels).save(d['Renders'] / f'{cid}_sheet.png')
        # prancha de animações
        sc_a, ce_a = render.fit(P, 35, 10, APANEL, margin=0.24)
        rows = []
        for a in m0.anims:
            for u in (0.1, 0.32, 0.5, 0.72, 0.95):
                rot, pos = a.sample(u)
                im = render.raster(m0.posed(A, rot, pos), Cc, M, 35, 10, APANEL, 'lit', sc_a, ce_a)
                rows.append(render.label(im, a.name if u == 0.1 else '', f'{u * a.duration:.2f}s'))
        render.sheet(f"{info['name']} — animações", ', '.join(c['name'] for c in clips), rows, cols=5).save(
            d['Renders'] / f'{cid}_animations.png')
        renders = [f'Renders/{cid}/{cid}_{k}.png' for k in ('sheet', 'animations', 'front', 'side', 'back',
                                                            'threequarter', 'wireframe', 'materials', 'scale')]

    meta = {
        'id': cid, 'name': info['name'], 'tribe': info['tribe'], 'description': info['description'],
        'size_category': info['size_category'], 'height_m': round(height, 2),
        'bounds_m': {'width_x': round(float(size[0]), 2), 'height_y': round(float(size[1]), 2), 'length_z': round(float(size[2]), 2)},
        'triangles': v0['triangles'], 'triangle_budget': [lo, hi], 'within_budget': lo <= v0['triangles'] <= hi,
        'materials': ['BST_' + n for n in used], 'bones': v0['joints'], 'bone_names': A['bones'],
        'animations': clips, 'variants': info.get('variants', []), 'sockets': info.get('sockets', []),
        'files': {'model': f'Models/{cid}/{cid}.glb', 'lods': lods, 'blend': None,
                  'palette': f'Textures/{cid}/{cid}_palette.png', 'materials': f'Materials/{cid}/{cid}_materials.json',
                  'animations': f'Animations/{cid}/{cid}_animations.json', 'renders': renders},
        'export': {'format': 'GLB (glTF 2.0)', 'units': 'meters', 'up_axis': '+Y', 'forward_axis': '+Z',
                   'shading': 'flat (normais por face)', 'color': 'COLOR_0 por vértice, sem texturas',
                   'skinning': 'JOINTS_0/WEIGHTS_0, até 2 influências', 'generator': 'tools/bestiary/build.py',
                   'verified': 'estrutura relida do disco por verify_glb()', 'notes': info.get('notes', '')},
    }
    (d['Metadata'] / f'{cid}.json').write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"{cid:16s} LOD0 {v0['triangles']:5d} tris ({lo}-{hi}{'' if meta['within_budget'] else ' FORA'})  "
          f"LOD1 {lods[1]['triangles']}  LOD2 {lods[2]['triangles']}  altura {height:.2f} m  "
          f"{v0['joints']} ossos  {len(clips)} anims  {v0['bytes'] / 1024:.0f} KB")
    return meta


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    metas = [build_one(c, '--no-render' not in sys.argv) for c in (args or CREATURES)]
    if not args:
        idx = [{k: m[k] for k in ('id', 'name', 'tribe', 'size_category', 'height_m', 'triangles')} |
               {'metadata': f"{importlib.import_module('creatures.' + m['id']).INFO['tribe_dir']}/Metadata/{m['id']}/{m['id']}.json"}
               for m in metas]
        (OUT / 'bestiary_index.json').write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding='utf-8')
