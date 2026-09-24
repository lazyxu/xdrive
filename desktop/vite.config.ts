import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const desktopRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = path.resolve(desktopRoot, '..')

export default defineConfig({
  root: path.join(desktopRoot, 'src', 'renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@xdrive/shared': path.join(repositoryRoot, 'ui', 'shared', 'src', 'index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      allow: [repositoryRoot],
    },
  },
  build: {
    outDir: path.join(desktopRoot, 'dist', 'renderer'),
    emptyOutDir: false,
  },
})
