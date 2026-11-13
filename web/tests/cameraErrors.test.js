import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage, xrErrorMessage } from '../src/cameraErrors.js';

const err = (name, message = '') => Object.assign(new Error(message), { name });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

test('permissão negada ensina a liberar, com o caminho de cada aparelho', () => {
  assert.match(cameraErrorMessage(err('NotAllowedError', 'Permission denied'), { ua: IPHONE }), /Ajustes do Site/);
  assert.match(cameraErrorMessage(err('NotAllowedError'), { ua: ANDROID }), /cadeado/);
  assert.doesNotMatch(cameraErrorMessage(err('NotAllowedError', 'Permission denied'), { ua: ANDROID }), /Permission denied/);
});

test('sem câmera, câmera ocupada e página sem https', () => {
  assert.match(cameraErrorMessage(err('NotFoundError')), /nenhuma câmera/);
  assert.match(cameraErrorMessage(err('NotReadableError')), /outro app/);
  assert.match(cameraErrorMessage(err('NotAllowedError'), { secure: false }), /https/);
  assert.match(cameraErrorMessage(new TypeError("Cannot read properties of undefined (reading 'getUserMedia')")), /https/);
});

test('erro desconhecido mostra o detalhe; RA sem suporte manda para a câmera parada', () => {
  assert.match(cameraErrorMessage(err('WeirdError', 'boom')), /\(boom\)/);
  assert.match(xrErrorMessage(err('NotSupportedError')), /câmera parada/);
});
