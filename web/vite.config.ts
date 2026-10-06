import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const webRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  publicDir: '../assets/icon/web',
  resolve: {
    preserveSymlinks: true,
    alias: {
      filesize: path.join(webRoot, 'node_modules', 'filesize', 'dist', 'filesize.js'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
