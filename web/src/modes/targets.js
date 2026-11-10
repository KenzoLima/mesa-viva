// Lista de alvos do modo Cartas, separada do cards.js para não baixar o MindAR só para abrir o menu.
// targets.json = [{ "name": "Llanowar Elves" }, ...] na MESMA ordem das imagens compiladas no targets.mind.

export async function loadTargets(base = './') {
  const isFile = (r) => r.ok && !(r.headers.get('content-type') ?? '').includes('html');
  const [list, hasMind] = await Promise.all([
    fetch(`${base}targets/targets.json`).then((r) => (isFile(r) ? r.json() : null)).catch(() => null),
    fetch(`${base}targets/targets.mind`, { method: 'HEAD' }).then(isFile).catch(() => false),
  ]);
  return hasMind && Array.isArray(list) && list.length ? list : null;
}
