// Mensagens para quando a câmera ou a RA não abrem: em português, dizendo o que fazer.
// O navegador só dá o nome do erro ("NotAllowedError") e um texto em inglês que muda de um para outro.
//
// Puro (sem DOM): roda nos testes do Node.

/** Aparelho é iPhone/iPad? (o caminho das permissões é outro) */
function isApple(ua) {
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
}

/**
 * Texto para mostrar quando getUserMedia falha.
 * err: o erro do navegador; ua: navigator.userAgent; secure: window.isSecureContext.
 */
export function cameraErrorMessage(err, { ua = '', secure = true } = {}) {
  const name = err?.name ?? '';
  if (!secure || name === 'TypeError' && /mediaDevices|getUserMedia|undefined/i.test(err?.message ?? '')) {
    return 'A câmera só abre em endereço seguro (https). Abra o app pelo link publicado ou pelo endereço https do npm run dev.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return isApple(ua)
      ? 'Sem permissão para usar a câmera. No iPhone: toque em "aA" na barra de endereço › Ajustes do Site › Câmera › Permitir, e tente de novo.'
      : 'Sem permissão para usar a câmera. Toque no cadeado ao lado do endereço › Permissões › Câmera › Permitir, e tente de novo.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'Não encontrei nenhuma câmera neste aparelho.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'A câmera está sendo usada por outro app ou aba. Feche-o e tente de novo.';
  }
  return `Não consegui abrir a câmera${err?.message ? ` (${err.message})` : ''}. Tente de novo.`;
}

/** Texto para quando a sessão de RA (WebXR) não abre. */
export function xrErrorMessage(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'O navegador não deixou abrir a RA. Confira a permissão da câmera e tente de novo, ou use a Mesa com câmera parada.';
  }
  if (name === 'NotSupportedError') {
    return 'Este aparelho não abre RA no navegador. Use a Mesa com câmera parada.';
  }
  return `Não consegui iniciar a RA${err?.message ? ` (${err.message})` : ''}. Tente de novo ou use a Mesa com câmera parada.`;
}
