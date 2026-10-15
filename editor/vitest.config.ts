import { defineConfig } from 'vitest/config'
import { emojiData } from './build/emoji-data'

export default defineConfig({
  plugins: [emojiData()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
})
