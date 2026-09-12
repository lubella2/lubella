import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The preview iframe is served from the sandbox host, so the dev server must
    // accept that origin and be allowed to be framed.
    allowedHosts: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    // Same-origin proxy to the local Supabase-shaped gateway. The browser talks
    // to /api on its own origin, so there is no cross-host or localhost call
    // from the client — which also means this works unchanged inside the preview.
    proxy: {
      '/api': {
        target: process.env.VITE_GATEWAY_URL || 'http://127.0.0.1:54321',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
