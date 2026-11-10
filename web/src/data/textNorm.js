// Porta de ml/mtgar_data/text_norm.py (e TextNormalizer.cs). As três precisam dar o mesmo resultado.

const REPLACE = {
  'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ß': 'ss',
  '‘': "'", '’': "'", 'ʼ': "'", '`': "'", '´': "'",
  '–': '-', '—': '-', '−': '-',
};

/** Chave de busca: minúsculas, sem acentos, apóstrofos/traços padronizados. */
export function normalizeName(name) {
  if (!name) return '';
  let s = Array.from(name, (c) => REPLACE[c] ?? c).join('');
  s = s.normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.replace(/\s*\/{1,2}\s*/g, ' // ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
