// Escolha de animações pelos nomes dos clipes do GLB (cada pacote de modelos usa nomes diferentes:
// "Attack_Fire", "CharacterArmature|Sword_Slash", "BatArmature|Bat_Attack2"…).
//
// Puro (sem three): roda nos testes do Node.

/** Nome sem o prefixo do esqueleto ("CharacterArmature|Punch" -> "Punch"). */
const bare = (name) => String(name ?? '').split('|').pop();

// Não é ataque, mesmo com "attack" no nome: parado em guarda, levando golpe, morrendo.
const NOT_ATTACK = /idle|hit|rec[ie]{2}ve|react|death|die|dodge|duck|block|brace/i;
// Do mais forte para o mais fraco. Dentro do mesmo nível, o clipe mais longo (golpe com mais preparo).
const TIERS = [
  /heavy|fire|breath|flame|special|ultimate|power|slam|smash|charge|combo|spell|cast/i,
  /attack|slash|weapon|sword|axe|bite|bash|thrust|stab|claw|strike|swing|cleave|sting/i,
  /punch|kick|headbutt|shoot|gun/i,
];

/**
 * Peso dentro do mesmo nível: o clipe mais longo (golpe com mais preparo); "Attack2" num pacote com
 * "Attack" ganha o empate (o segundo golpe costuma ser o mais elaborado).
 */
const weight = (c) => (c.duration ?? 0) + (/\d$/.test(bare(c.name)) ? 0.01 : 0);

/**
 * O ataque mais forte entre os clipes, ou null se o modelo não tem nenhum.
 * clips: AnimationClip[] (ou qualquer { name, duration }).
 */
export function strongestAttack(clips) {
  let best = null;
  let bestRank = Infinity;
  for (const c of clips ?? []) {
    const n = bare(c.name);
    if (NOT_ATTACK.test(n)) continue;
    const rank = TIERS.findIndex((re) => re.test(n));
    if (rank < 0) continue;
    if (rank < bestRank || (rank === bestRank && weight(c) > weight(best))) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/** O clipe de morte ("Death", "Bat_Death", "Robot_Death"…), ou null. */
export function deathClip(clips) {
  return (clips ?? []).find((c) => /^death$/i.test(bare(c.name)))
    ?? (clips ?? []).find((c) => /death|die|dying/i.test(bare(c.name)))
    ?? null;
}

/** O clipe de "parado": idle, senão voando/nadando, senão o primeiro que não é ataque. */
export function idleClip(clips) {
  const names = clips.map((c) => bare(c.name));
  const pick = (test) => clips[names.findIndex(test)];
  return pick((n) => /^idle$/i.test(n))
    ?? pick((n) => /idle/i.test(n) && !/attack|gun|shoot|eat/i.test(n))
    ?? pick((n) => /fly|flying|swim|standing/i.test(n) && !/fast/i.test(n))
    ?? pick((n) => !strongestAttack([{ name: n }]) && !NOT_ATTACK.test(n))
    ?? clips[0];
}
