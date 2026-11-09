import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const webRoot = fileURLToPath(new URL('.', import.meta.url))

// Isolated DSM application bundle: do not ship PWA service workers, Web
// credentials, Web app routes, or unbounded generic browser assets into SPK.
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'dist-synology',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: path.join(webRoot, 'synology.html') },
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      filesize: path.join(webRoot, 'node_modules', 'filesize', 'dist', 'filesize.js'),
      // Shared @xdrive/ui source lives outside web/. With preserveSymlinks,
      // Vite otherwise resolves peer imports from ui/shared rather than the
      // isolated DSM application's installed dependency tree. Route all shared
      // MUI/Emotion/React peers to one explicitly pinned Web installation.
      '@mui/icons-material': path.join(webRoot, 'node_modules', '@mui', 'icons-material'),
      '@mui/material': path.join(webRoot, 'node_modules', '@mui', 'material'),
      '@emotion/react': path.join(webRoot, 'node_modules', '@emotion', 'react'),
      '@emotion/styled': path.join(webRoot, 'node_modules', '@emotion', 'styled'),
      'react-dom': path.join(webRoot, 'node_modules', 'react-dom'),
      react: path.join(webRoot, 'node_modules', 'react'),
    },
  },
})
