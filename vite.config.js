import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      // Required for SharedArrayBuffer (FFmpeg multi-threading)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    // Prevents Vite from trying to pre-bundle the heavy WASM binaries
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});