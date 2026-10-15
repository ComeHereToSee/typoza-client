// 打包产物冒烟自检(macOS CI 上以 --smoke-out 启动应用时由外壳调用):
// 在临时目录写一篇带图片 / 表格 / 动图的文档 → 打开 → 双击表格里的图片 → 确认灯箱打开且图片真的加载出来。
import { TextSelection } from 'prosemirror-state'
import type { App } from './app/app'
import { DEMO_MARKDOWN, TINY_GIF, sampleSvg } from './demo'

export interface SmokeResult {
  ok: boolean
  checks: Record<string, boolean>
  timings: Record<string, number>
  error?: string
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function until(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (cond()) return true
    await wait(30)
  }
  return cond()
}

/** 约 target 字节的混排文档:标题、段落(含行内格式与链接)、列表、待办、引用;每 10 节一张表格和一段代码。 */
export function bigMarkdown(target: number): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let bytes = 0
  for (let i = 1; bytes < target; i++) {
    let s = `## 第 ${i} 节 · 资助项目配置\n\n左栏「对象类型」→ 右上「新建对象类型」,填完点右上「保存并生效」。**加粗**、*斜体*、\`代码\` 与 [链接](https://example.com/${i}) 混排,用于测试大文件的打开与输入。\n\n- 唯一标识符:aid_project_${i}\n- 名称:资助项目 ${i}\n- [ ] 待办事项 ${i}\n\n> 第 ${i} 节的引用段落。\n\n`
    if (i % 10 === 0) s += `| 配置项 | 填什么 | 说明 |\n| --- | --- | --- |\n| 唯一标识符 | \`aid_${i}\` | 英文小写 |\n| 名称 | 资助项目 | 显示名 |\n\n\`\`\`js\nconst project${i} = { id: ${i}, name: '资助项目' }\n\`\`\`\n\n`
    parts.push(s)
    bytes += enc.encode(s).length
  }
  return parts.join('')
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

export async function runSmoke(app: App, bootTimings: Record<string, number> = {}): Promise<SmokeResult> {
  const checks: Record<string, boolean> = {}
  const timings: Record<string, number> = { ...bootTimings, bootMs: Math.round(performance.now()) }
  try {
    const host = app.host
    const dir = `${host.homeDir()}/Library/Caches/app.typoza.mac/smoke`
    await host.mkdir(`${dir}/assets`)
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))
    await host.writeBase64(`${dir}/assets/form.svg`, b64(sampleSvg('基本信息表单', 1200, 680)))
    await host.writeBase64(`${dir}/assets/id.svg`, b64(sampleSvg('标识符', 400, 240, '#448361')))
    await host.writeBase64(`${dir}/assets/name.svg`, b64(sampleSvg('名称', 400, 240, '#D9730D')))
    await host.writeBase64(`${dir}/assets/anim.gif`, TINY_GIF)
    await host.writeText(`${dir}/smoke.md`, DEMO_MARKDOWN)

    // PRD 质量要求:5MB 文档从发起打开到首屏渲染完成;在其中连续输入的单键耗时(p95);保存耗时
    const big = bigMarkdown(5 * 1024 * 1024)
    await host.writeText(`${dir}/big.md`, big)
    timings.bigBytes = new TextEncoder().encode(big).length
    let t = performance.now()
    await app.openFile(`${dir}/big.md`, { replace: true })
    await nextFrame()
    timings.bigOpenMs = Math.round(performance.now() - t)
    checks.bigDocLoaded = app.view.state.doc.childCount > 10000
    const view = app.view
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.doc.child(0).nodeSize - 1))))
    const samples: number[] = []
    for (let i = 0; i < 60; i++) {
      const s0 = performance.now()
      view.dispatch(view.state.tr.insertText('字'))
      void view.dom.getBoundingClientRect().height // 强制排版,计入上屏前的布局
      samples.push(performance.now() - s0)
    }
    timings.bigInputP95Ms = Math.round(percentile(samples, 95) * 10) / 10
    timings.bigInputMaxMs = Math.round(Math.max(...samples) * 10) / 10
    t = performance.now()
    checks.bigSaved = await app.save()
    timings.bigSaveMs = Math.round(performance.now() - t)

    const t0 = performance.now()
    await app.openFile(`${dir}/smoke.md`, { replace: true })
    timings.openMs = Math.round(performance.now() - t0)
    checks.documentLoaded = app.view.state.doc.textContent.includes('资助项目')

    const tableImg = document.querySelector<HTMLImageElement>('.tz-editor table .tz-image img')
    checks.tableImageRendered = Boolean(tableImg)
    checks.tableImageLoaded = await until(() => Boolean(tableImg?.complete && tableImg.naturalWidth > 0), 5000)

    tableImg?.closest('.tz-image')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    checks.lightboxOpened = await until(() => Boolean(document.querySelector('.tz-lightbox')), 2000)
    const lbImg = document.querySelector<HTMLImageElement>('.tz-lightbox .tz-lb-img')
    checks.lightboxImageLoaded = await until(() => Boolean(lbImg && lbImg.naturalWidth > 0 && !lbImg.hidden), 5000)
    checks.lightboxCounter = (document.querySelector('.tz-lb-counter')?.textContent ?? '').includes('/')

    // 保存往返:未编辑的文档写回后与原文逐字相同
    checks.roundTrip = app.markdown() === DEMO_MARKDOWN

    // 云同步链路:网页 → 外壳 → 辅助进程 → 返回;全新环境下应为未登录
    const t1 = performance.now()
    const sync = await host.syncCall<{ signedIn: boolean; vaults: unknown[] }>('sync.status')
    timings.syncStatusMs = Math.round(performance.now() - t1)
    checks.syncHelper = sync.signedIn === false && Array.isArray(sync.vaults)
  } catch (err) {
    return { ok: false, checks, timings, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) }
  }
  return { ok: Object.values(checks).every(Boolean), checks, timings }
}
