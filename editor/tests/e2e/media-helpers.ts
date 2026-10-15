// 图片、媒体、右键菜单、编辑菜单 E2E 共用的小工具(内存宿主)。
import type { Page } from '@playwright/test'
import { modKey } from './helpers'

/** 发菜单命令(与原生菜单栏同一通道)。 */
export async function runMenuCommand(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => window.typozaTest!.host.emit('menu.command', { id: cmd }), id)
}

/** 内存宿主记录的某个方法的调用参数。 */
export async function hostCalls(page: Page, method: string): Promise<unknown[][]> {
  return page.evaluate((m) => window.typozaTest!.host.calls.filter((c) => c.method === m).map((c) => c.args), method)
}

/** 预置内存文件。 */
export async function putFile(page: Page, path: string, data: string): Promise<void> {
  await page.evaluate(([p, d]) => {
    window.typozaTest!.host.files.set(p, { kind: 'file', data: d, mtime: Date.now() })
  }, [path, data] as const)
}

/** 往编辑器派发剪贴板事件(粘贴时剪贴板里只有这段纯文本);返回事件里写入的数据。 */
export async function clipboardEvent(page: Page, type: 'paste' | 'copy', text = ''): Promise<{ html: string; text: string }> {
  return page.evaluate(
    ([t, value]) => {
      const data = new DataTransfer()
      if (t === 'paste') data.setData('text/plain', value)
      const editor = document.querySelector('.tz-editor')
      if (!editor) throw new Error('找不到编辑器')
      editor.dispatchEvent(new ClipboardEvent(t, { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain') }
    },
    [type, text] as const,
  )
}

/** 在元素内某点直接派发右键菜单事件(不经过右键按下,选区保持不变)。 */
export async function contextMenuAt(page: Page, selector: string, offset: { x: number; y: number }): Promise<void> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`元素不可见:${selector}`)
  await page.evaluate(
    ([x, y]) => {
      const target = document.elementFromPoint(x, y)
      if (!target) throw new Error(`坐标处没有元素:${x},${y}`)
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
    },
    [box.x + offset.x, box.y + offset.y] as const,
  )
}

/** 光标移到文首。 */
export async function toDocStart(page: Page): Promise<void> {
  await page.keyboard.press((await modKey(page)) === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home')
}
