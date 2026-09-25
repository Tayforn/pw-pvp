import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? process.env.VITE_BASE || '/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Дані ляльки (json/png через ?url) — завжди окремі файли, навіть маленькі:
    // усі лягають під /assets/index-* і immutable-кеш Caddy, без data:-URI в чанках.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: 'index.html',
      output: {
        // Головний бандл лишається index-<hash>.js — саме його шукає smoke-тест
        // у deploy.yml; чанки й активи отримують index-<імʼя>-<hash> і теж
        // підпадають під матчер /assets/index-*.
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: 'assets/index-[name]-[hash].js',
        assetFileNames: 'assets/index-[name]-[hash][extname]',
      },
    },
  },
}));
