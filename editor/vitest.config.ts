import { defineConfig } from 'vitest/config'
import { emojiData } from './build/emoji-data'
import { patchDeps } from './build/patch-deps'

export default defineConfig({
  plugins: [patchDeps(), emojiData()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
    // 让 build/patch-deps.ts 的依赖补丁在单测里同样生效(默认 node_modules 不经 Vite 转换)
    server: { deps: { inline: [/micromark-extension-gfm-table/] } },
  },
})
