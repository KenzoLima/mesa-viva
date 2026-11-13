"""Escrita e verificação de GLB (glTF 2.0) com skin e animações, só com numpy."""
import json
import struct
import numpy as np
from .mesh import MATERIALS, euler

FPS = 24


def _srgb_to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _quat(R):
    t = R[0, 0] + R[1, 1] + R[2, 2]
    if t > 0:
        s = np.sqrt(t + 1) * 2
        q = ((R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4)
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = (s / 4, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s, (R[2, 1] - R[1, 2]) / s)
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = ((R[0, 1] + R[1, 0]) / s, s / 4, (R[1, 2] + R[2, 1]) / s, (R[0, 2] - R[2, 0]) / s)
    else:
        s = np.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = ((R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, s / 4, (R[1, 0] - R[0, 1]) / s)
    q = np.array(q, float)
    return q / np.linalg.norm(q)


class _Buf:
    def __init__(self):
        self.data = bytearray()
        self.views, self.accessors = [], []

    def add(self, arr, ctype, atype, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        while len(self.data) % 4:
            self.data.append(0)
        view = {'buffer': 0, 'byteOffset': len(self.data), 'byteLength': arr.nbytes}
        if target:
            view['target'] = target
        self.data += arr.tobytes()
        self.views.append(view)
        acc = {'bufferView': len(self.views) - 1, 'componentType': ctype,
               'count': int(arr.shape[0]), 'type': atype}
        if minmax:
            flat = arr.reshape(arr.shape[0], -1)
            acc['min'] = [float(x) for x in flat.min(0)]
            acc['max'] = [float(x) for x in flat.max(0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def write_glb(path, model, extras=None):
    A = model.arrays()
    P = A['P'].reshape(-1, 3).astype(np.float32)
    tri = A['P']
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.where(ln < 1e-12, 1, ln)
    N = np.repeat(n, 3, axis=0).astype(np.float32)
    Col = _srgb_to_linear(A['C'].reshape(-1, 3)).astype(np.float32)
    J = A['J'].reshape(-1, 4).astype(np.uint8)
    W = A['W'].reshape(-1, 4).astype(np.float32)
    Mc = np.repeat(A['M'], 3)

    buf = _Buf()
    prims, mats, mat_names = [], [], []
    for mname in sorted(set(A['M'])):
        sel = np.where(Mc == mname)[0]
        packed = np.concatenate([np.round(P[sel], 5), np.round(N[sel], 4), np.round(Col[sel], 4),
                                 J[sel].astype(np.float32), np.round(W[sel], 4)], axis=1)
        _, first, inv = np.unique(packed, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1)
        idx = sel[first]
        ctype, dt = (5123, np.uint16) if len(idx) < 65535 else (5125, np.uint32)
        attrs = {
            'POSITION': buf.add(P[idx], 5126, 'VEC3', 34962, minmax=True),
            'NORMAL': buf.add(N[idx], 5126, 'VEC3', 34962),
            'COLOR_0': buf.add(Col[idx], 5126, 'VEC3', 34962),
            'JOINTS_0': buf.add(J[idx], 5121, 'VEC4', 34962),
            'WEIGHTS_0': buf.add(W[idx], 5126, 'VEC4', 34962),
        }
        prims.append({'attributes': attrs, 'indices': buf.add(inv.astype(dt), ctype, 'SCALAR', 34963),
                      'material': len(mats), 'mode': 4})
        metal, rough, emis, double = MATERIALS[mname]
        m = {'name': 'BST_' + mname,
             'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': metal,
                                      'roughnessFactor': rough},
             'doubleSided': double}
        if emis:
            m['emissiveFactor'] = [float(x) for x in _srgb_to_linear(emis)]
        mats.append(m)
        mat_names.append(mname)

    names = A['bones']
    index = {b: i for i, b in enumerate(names)}
    # nós: 0 = raiz da cena, 1 = malha, 2.. = ossos
    nodes = [{'name': model.name, 'children': [1]}, {'name': model.name + '_mesh', 'mesh': 0, 'skin': 0}]
    off = 2
    for b in names:
        par, head = model.bones[b]
        local = head if par is None else head - model.bones[par][1]
        nodes.append({'name': b, 'translation': [float(x) for x in local]})
        if par is None:
            nodes[0]['children'].append(off + index[b])
        else:
            nodes[off + index[par]].setdefault('children', []).append(off + index[b])
    ibm = np.zeros((len(names), 16), np.float32)
    for i, b in enumerate(names):
        m4 = np.eye(4)
        m4[:3, 3] = -model.bones[b][1]
        ibm[i] = m4.T.reshape(-1)       # column-major
    skin = {'name': model.name + '_armature', 'joints': [off + i for i in range(len(names))],
            'inverseBindMatrices': buf.add(ibm, 5126, 'MAT4'),
            'skeleton': off + [i for i, b in enumerate(names) if model.bones[b][0] is None][0]}

    anims = []
    for a in model.anims:
        nk = max(2, int(round(a.duration * FPS))) + 1
        us = np.linspace(0, 1, nk)
        tacc = buf.add((us * a.duration).astype(np.float32), 5126, 'SCALAR', minmax=True)
        samples = [a.sample(u) for u in us]
        ch, sm = [], []
        for b in a.rot:
            qs, prev = [], None
            for rot, _ in samples:
                q = _quat(euler(*rot[b]))
                if prev is not None and np.dot(q, prev) < 0:
                    q = -q
                prev = q
                qs.append(q)
            sm.append({'input': tacc, 'output': buf.add(np.array(qs, np.float32), 5126, 'VEC4'),
                       'interpolation': 'LINEAR'})
            ch.append({'sampler': len(sm) - 1, 'target': {'node': off + index[b], 'path': 'rotation'}})
        for b in a.pos:
            par, head = model.bones[b]
            local = head if par is None else head - model.bones[par][1]
            ts = np.array([local + pos[b] for _, pos in samples], np.float32)
            sm.append({'input': tacc, 'output': buf.add(ts, 5126, 'VEC3'), 'interpolation': 'LINEAR'})
            ch.append({'sampler': len(sm) - 1, 'target': {'node': off + index[b], 'path': 'translation'}})
        anims.append({'name': a.name, 'channels': ch, 'samplers': sm})

    while len(buf.data) % 4:
        buf.data.append(0)
    doc = {
        'asset': {'version': '2.0', 'generator': 'MesaViva Bestiary Generator'},
        'scene': 0, 'scenes': [{'name': model.name, 'nodes': [0]}],
        'nodes': nodes, 'meshes': [{'name': model.name, 'primitives': prims}],
        'materials': mats, 'skins': [skin],
        'buffers': [{'byteLength': len(buf.data)}], 'bufferViews': buf.views, 'accessors': buf.accessors,
    }
    if anims:
        doc['animations'] = anims
    if extras:
        doc['scenes'][0]['extras'] = extras
    js = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(buf.data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON'))
        f.write(js)
        f.write(struct.pack('<I4s', len(buf.data), b'BIN\x00'))
        f.write(bytes(buf.data))
    return {'triangles': int(len(A['P'])), 'materials': mat_names, 'bones': len(names), 'bytes': total}


_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def verify_glb(path):
    """Relê o arquivo do disco e confere a estrutura. Devolve um resumo; levanta AssertionError se inválido."""
    raw = open(path, 'rb').read()
    magic, ver, total = struct.unpack_from('<4sII', raw, 0)
    assert magic == b'glTF' and ver == 2 and total == len(raw), 'cabeçalho GLB inválido'
    jl, jt = struct.unpack_from('<I4s', raw, 12)
    assert jt == b'JSON'
    doc = json.loads(raw[20:20 + jl])
    bl, bt = struct.unpack_from('<I4s', raw, 20 + jl)
    assert bt == b'BIN\x00' and bl == doc['buffers'][0]['byteLength']
    bin_ = raw[28 + jl:28 + jl + bl]

    def acc(i):
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        nc = _NC[a['type']]
        dt = np.dtype(_CT[a['componentType']])
        end = v['byteOffset'] + a['count'] * nc * dt.itemsize
        assert end <= v['byteOffset'] + v['byteLength'] <= len(bin_), 'accessor fora do buffer'
        assert v['byteOffset'] % dt.itemsize == 0, 'desalinhado'
        return np.frombuffer(bin_, dt, a['count'] * nc, v['byteOffset']).reshape(a['count'], nc)

    tris, lo, hi = 0, np.full(3, np.inf), np.full(3, -np.inf)
    njoints = len(doc['skins'][0]['joints'])
    for pr in doc['meshes'][0]['primitives']:
        at = pr['attributes']
        pos = acc(at['POSITION'])
        idx = acc(pr['indices'])
        assert len(idx) % 3 == 0 and idx.max() < len(pos)
        a = doc['accessors'][at['POSITION']]
        assert np.allclose(pos.min(0), a['min'], atol=1e-5) and np.allclose(pos.max(0), a['max'], atol=1e-5)
        nrm = acc(at['NORMAL'])
        assert np.allclose(np.linalg.norm(nrm, axis=1), 1, atol=1e-3), 'normal não unitária'
        t = pos[idx.reshape(-1, 3)]
        fn = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        area = np.linalg.norm(fn, axis=1)
        assert (area > 1e-10).all(), 'triângulo degenerado'
        assert (np.einsum('ij,ij->i', fn / area[:, None], nrm[idx.reshape(-1, 3)[:, 0]]) > 0.99).all(), \
            'normal não bate com o sentido da face'
        for k in ('COLOR_0', 'JOINTS_0', 'WEIGHTS_0'):
            assert len(acc(at[k])) == len(pos)
        assert acc(at['JOINTS_0']).max() < njoints
        assert np.allclose(acc(at['WEIGHTS_0']).sum(1), 1, atol=1e-3), 'pesos não somam 1'
        assert np.isfinite(pos).all()
        tris += len(idx) // 3
        lo, hi = np.minimum(lo, pos.min(0)), np.maximum(hi, pos.max(0))
    assert len(acc(doc['skins'][0]['inverseBindMatrices'])) == njoints
    clips = []
    for an in doc.get('animations', []):
        dur = 0
        for s in an['samplers']:
            ti, vo = acc(s['input']), acc(s['output'])
            assert len(ti) == len(vo) and (np.diff(ti[:, 0]) > 0).all() and np.isfinite(vo).all()
            dur = max(dur, float(ti[-1, 0]))
        for c in an['channels']:
            assert c['target']['node'] in doc['skins'][0]['joints']
        clips.append({'name': an['name'], 'duration': round(dur, 3), 'channels': len(an['channels'])})
    return {'triangles': tris, 'bbox_min': [round(float(x), 3) for x in lo],
            'bbox_max': [round(float(x), 3) for x in hi], 'joints': njoints,
            'materials': [m['name'] for m in doc['materials']], 'animations': clips, 'bytes': len(raw)}
