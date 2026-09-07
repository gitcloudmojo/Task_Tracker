import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // In dev the API runs on its own port; this keeps the browser talking to
    // one origin so there is no CORS surprise.
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Inline the brand assets into the bundle. Keeps the logo working in the
    // single-file offline preview, which has no asset directory to load from.
    assetsInlineLimit: 262_144,
  },
});
