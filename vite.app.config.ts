import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Builds the desktop renderer from app.html (the root index.html is the marketing page) into dist/index.html.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-html-as-index',
      closeBundle() {
        const out = path.resolve(__dirname, 'dist')
        fs.renameSync(path.join(out, 'app.html'), path.join(out, 'index.html'))
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: path.resolve(__dirname, 'app.html') } },
})
