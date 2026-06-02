import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { copyFileSync } from 'fs'

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'copy-manifest',
      writeBundle() {
        copyFileSync(
          resolve(process.cwd(), 'manifest.json'),
          resolve(process.cwd(), 'dist/manifest.json')
        )
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(process.cwd(), 'popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
