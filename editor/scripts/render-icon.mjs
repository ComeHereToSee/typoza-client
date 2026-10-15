// CI 用:把 design/assets/app-icon.svg 渲染成 macOS iconset 需要的各尺寸 PNG(WebKit 渲染,透明背景)。
// 用法:node scripts/render-icon.mjs <输出的 .iconset 目录>;macOS 任务再用 iconutil 合成 .icns。
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webkit } from '@playwright/test'

const out = process.argv[2]
if (!out) throw new Error('需要输出目录参数,如 dist-icon/AppIcon.iconset')
const here = dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(resolve(here, '../../design/assets/app-icon.svg'), 'utf8')
mkdirSync(out, { recursive: true })

// iconset 规范的文件名与像素尺寸
const sizes = [16, 32, 128, 256, 512].flatMap((s) => [
  [`icon_${s}x${s}.png`, s],
  [`icon_${s}x${s}@2x.png`, s * 2],
])

const browser = await webkit.launch()
try {
  for (const [name, px] of sizes) {
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 })
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${px}" height="${px}"`)}</body></html>`)
    await page.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } })
    await page.close()
    console.log(`${name} ${px}×${px}`)
  }
} finally {
  await browser.close()
}
