// CI 用的大文档性能剖析:起 Vite 开发服务器(不压缩,函数名保真)→ Chromium 打开编辑器 →
// 分阶段(解析 / 打开并渲染 / 连续输入 / 切回小文档)计时,并用 CDP 采样剖析器统计每阶段的函数自耗时 Top。
// 用法:node scripts/perf-profile.mjs <输出目录>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = process.argv[2]
if (!out) throw new Error('需要输出目录参数')
mkdirSync(out, { recursive: true })
const PORT = 5175

/** 与 src/smoke.ts 的 bigMarkdown 相同的混排文档(约 target 字节)。 */
function bigMarkdown(target) {
  const enc = new TextEncoder()
  const parts = []
  let bytes = 0
  for (let i = 1; bytes < target; i++) {
    let s = `## 第 ${i} 节 · 资助项目配置\n\n左栏「对象类型」→ 右上「新建对象类型」,填完点右上「保存并生效」。**加粗**、*斜体*、\`代码\` 与 [链接](https://example.com/${i}) 混排,用于测试大文件的打开与输入。\n\n- 唯一标识符:aid_project_${i}\n- 名称:资助项目 ${i}\n- [ ] 待办事项 ${i}\n\n> 第 ${i} 节的引用段落。\n\n`
    if (i % 10 === 0) s += `| 配置项 | 填什么 | 说明 |\n| --- | --- | --- |\n| 唯一标识符 | \`aid_${i}\` | 英文小写 |\n| 名称 | 资助项目 | 显示名 |\n\n\`\`\`js\nconst project${i} = { id: ${i}, name: '资助项目' }\n\`\`\`\n\n`
    parts.push(s)
    bytes += enc.encode(s).length
  }
  return parts.join('')
}

/** CDP 剖析结果 → 按函数聚合的自耗时与含子调用耗时(毫秒),各取前 n 名。 */
function summarize(profile, n = 40) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const c of node.children ?? []) parent.set(c, node.id)
  const selfUs = new Map()
  profile.samples.forEach((id, i) => selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)))
  const keyOf = (node) => {
    const f = node.callFrame
    const url = f.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    return `${f.functionName || '(匿名)'} ${url}:${f.lineNumber + 1}`
  }
  const self = new Map()
  const total = new Map()
  for (const [id, us] of selfUs) {
    const node = byId.get(id)
    if (!node) continue
    const k = keyOf(node)
    self.set(k, (self.get(k) ?? 0) + us)
    // 含子调用耗时:沿祖先链给每个函数记一次(递归只记一次)
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const ck = keyOf(byId.get(cur))
      if (seen.has(ck)) continue
      seen.add(ck)
      total.set(ck, (total.get(ck) ?? 0) + us)
    }
  }
  const top = (m) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, us]) => ({ fn: k, ms: Math.round(us / 100) / 10 }))
  return { self: top(self), total: top(total) }
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Vite 开发服务器 60 秒内没起来')), 60_000)
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(timer)
      resolve()
    }
  })
})

const report = { phases: {}, profiles: {} }
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('html[data-ready="true"]', { timeout: 120_000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  const profiled = async (name, fn) => {
    await cdp.send('Profiler.start')
    const result = await fn()
    const { profile } = await cdp.send('Profiler.stop')
    report.profiles[name] = summarize(profile)
    return result
  }

  const md = bigMarkdown(5 * 1024 * 1024)
  report.bytes = Buffer.byteLength(md)
  await page.evaluate((text) => {
    window.__bigMd = text
  }, md)

  report.phases.parseMs = await profiled('解析', () =>
    page.evaluate(() => {
      const t = performance.now()
      const { doc } = window.typozaTest.parse(window.__bigMd, { inlineMath: true })
      window.__bigBlocks = doc.childCount
      return Math.round(performance.now() - t)
    }),
  )
  report.blocks = await page.evaluate(() => window.__bigBlocks)

  report.phases.openMs = await profiled('打开并渲染', () =>
    page.evaluate(async () => {
      const host = window.typozaTest.host
      host.files.set('/demo/big.md', { kind: 'file', data: window.__bigMd, mtime: Date.now() })
      const t = performance.now()
      await window.typozaTest.app.openFile('/demo/big.md', { replace: true })
      await new Promise((r) => requestAnimationFrame(() => r()))
      return Math.round(performance.now() - t)
    }),
  )

  report.phases.input = await profiled('连续输入', () =>
    page.evaluate(() => {
      const view = window.typozaTest.app.view
      const samples = []
      for (let i = 0; i < 40; i++) {
        const t = performance.now()
        view.dispatch(view.state.tr.insertText('字', 3))
        void view.dom.getBoundingClientRect().height
        samples.push(performance.now() - t)
      }
      samples.sort((a, b) => a - b)
      return { p50: Math.round(samples[20] * 10) / 10, p95: Math.round(samples[37] * 10) / 10, max: Math.round(samples[39] * 10) / 10 }
    }),
  )

  report.phases.switchBackMs = await profiled('切回小文档', () =>
    page.evaluate(async () => {
      const t = performance.now()
      await window.typozaTest.load('# 小文档\n\n一段话。\n')
      return Math.round(performance.now() - t)
    }),
  )
} finally {
  await browser.close()
  server.kill()
}

writeFileSync(join(out, 'perf.json'), JSON.stringify(report, null, 2))
const lines = [`# 大文档性能剖析(Chromium,开发版)`, '', `文档 ${report.bytes} 字节,${report.blocks} 个顶层块`, '', '```json', JSON.stringify(report.phases, null, 2), '```']
for (const [name, p] of Object.entries(report.profiles)) {
  lines.push('', `## ${name} · 自耗时 Top`, '', '| 毫秒 | 函数 |', '|---|---|', ...p.self.map((x) => `| ${x.ms} | ${x.fn} |`))
  lines.push('', `## ${name} · 含子调用 Top`, '', '| 毫秒 | 函数 |', '|---|---|', ...p.total.slice(0, 25).map((x) => `| ${x.ms} | ${x.fn} |`))
}
writeFileSync(join(out, 'perf.md'), `${lines.join('\n')}\n`)
console.log(JSON.stringify(report.phases))
