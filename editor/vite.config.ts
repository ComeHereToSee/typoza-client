import { defineConfig } from 'vite'

// 产物由 macOS 外壳经自定义协议 typoza://app/ 加载,用相对路径;最低 macOS 13 → Safari 16 内核。
export default defineConfig({
  base: './',
  build: {
    target: 'safari16',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
