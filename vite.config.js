import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'] },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: 'index.html' } },
  },
  server: { host: true },
});
