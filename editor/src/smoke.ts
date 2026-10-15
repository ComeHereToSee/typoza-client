// 打包产物冒烟自检(macOS CI 上以 --smoke-out 启动应用时由外壳调用):
// 在临时目录写一篇带图片 / 表格 / 动图的文档 → 打开 → 双击表格里的图片 → 确认灯箱打开且图片真的加载出来。
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

export async function runSmoke(app: App): Promise<SmokeResult> {
  const checks: Record<string, boolean> = {}
  const timings: Record<string, number> = { bootMs: Math.round(performance.now()) }
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
  } catch (err) {
    return { ok: false, checks, timings, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) }
  }
  return { ok: Object.values(checks).every(Boolean), checks, timings }
}
