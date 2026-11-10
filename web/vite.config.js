import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS é obrigatório para a câmera e o WebXR no celular.
// O certificado é autoassinado: no celular, aceite o aviso do navegador uma vez.
// `npm run dev:http` (mode "http") serve sem HTTPS: só para ver o menu no PC; a câmera não abre assim.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'http' ? [] : [basicSsl()],
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: 'index.html', compilar: 'compilar.html' } },
  },
}));
