// Imagem da câmera dentro da sessão de RA (WebXR Raw Camera Access, Chrome no Android com ARCore).
// O navegador entrega a imagem como uma textura da GPU que só vale durante o quadro; aqui ela é
// copiada por um shader mínimo para uma textura nossa, lida com readPixels e virada para ficar em pé.
// Junto vão as matrizes da vista daquele quadro, para levar a mesa até os pixels daquela foto depois
// (o OCR demora mais que um quadro).

import * as THREE from 'three';

const MAX_SIDE = 1600; // o OCR não usa mais que isso

export function cameraAccessAvailable(session) {
  return typeof XRWebGLBinding !== 'undefined' && !!session.enabledFeatures?.includes('camera-access');
}

export class XrCameraImage {
  constructor(renderer, session) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.binding = new XRWebGLBinding(session, this.gl);
    this.program = null;
  }

  #setup() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    // Triângulo que cobre a tela inteira, sem atributos (gl_VertexID).
    gl.attachShader(p, compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv;
      void main() {
        vec2 q = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        uv = q;
        gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
      }`));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec2 uv;
      uniform sampler2D cam;
      out vec4 color;
      void main() { color = texture(cam, uv); }`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.program = p;
    this.vao = gl.createVertexArray();
  }

  /**
   * Chamar DENTRO do quadro da sessão, depois de desenhar a cena. view: XRView do quadro.
   * Retorna { canvas, w, h, proj, view } ou null (aparelho sem a imagem neste quadro).
   */
  grab(view) {
    if (!view?.camera) return null;
    const tex = this.binding.getCameraImage(view.camera);
    if (!tex) return null;
    const gl = this.gl;
    if (!this.program) this.#setup();
    const k = Math.min(1, MAX_SIDE / Math.max(view.camera.width, view.camera.height));
    const w = Math.round(view.camera.width * k);
    const h = Math.round(view.camera.height * k);

    const out = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.program, 'cam'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(out);
    gl.bindVertexArray(null);
    // Devolve o WebGL ao Three.js (ele reconfigura tudo no próximo desenho).
    this.renderer.resetState();

    // O readPixels lê de baixo para cima: vira para a linha 0 ser o topo da imagem.
    const row = w * 4;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(img, 0, 0);
    return { canvas, w, h, proj: Array.from(view.projectionMatrix), view: Array.from(view.transform.matrix) };
  }
}

/** Ponto do mundo → pixel da imagem w × h tirada com as matrizes proj/view (null se atrás). */
export function projectShot(pw, shot) {
  const v = new THREE.Vector3(pw.x, pw.y, pw.z)
    .applyMatrix4(new THREE.Matrix4().fromArray(shot.view).invert());
  if (v.z >= 0) return null;
  v.applyMatrix4(new THREE.Matrix4().fromArray(shot.proj));
  return { x: ((v.x + 1) / 2) * shot.w, y: ((1 - v.y) / 2) * shot.h };
}
