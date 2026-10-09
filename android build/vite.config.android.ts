// Builds the shared React UI (../src) for the Android WebView.
// The UI itself is unchanged: shim/entry.ts installs an Android implementation of window.electronAPI first.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  publicDir: path.resolve(__dirname, '../public'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'www'),
    emptyOutDir: true,
    target: 'es2019',
  },
  server: { fs: { allow: [path.resolve(__dirname, '..')] } },
});
