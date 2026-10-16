import { expect, type Page } from '@playwright/test'

/** ProseMirror 的 Mod:macOS 上是 Cmd,其它平台是 Ctrl(CI 的 Linux WebKit)。 */
export async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => /Mac|iP(hone|[oa]d)/.test(navigator.platform))
  return mac ? 'Meta' : 'Control'
}

export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
}

/** 载入一篇新文档并把光标放到文末;path 不给时用演示目录里的新文件名。 */
export async function loadDoc(page: Page, markdown: string, path?: string): Promise<void> {
  await page.evaluate(
    async ({ md, p }) => {
      await window.typozaTest!.load(md, p)
    },
    { md: markdown, p: path },
  )
  // 用真实点击聚焦(WebKit 里程序化聚焦后,Home、⇧方向键等原生光标移动不生效);
  // 点在右下角的底部留白上:点中心可能落在居中的图片上,紧接着点图片会被 ProseMirror 当成双击
  const editor = page.locator('.tz-editor')
  const box = await editor.boundingBox()
  if (!box) throw new Error('编辑区不可见')
  await editor.click({ position: { x: box.width - 2, y: box.height - 2 } })
  await page.keyboard.press((await modKey(page)) === 'Meta' ? 'Meta+ArrowDown' : 'Control+End')
}

export async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => window.typozaTest!.markdown())
}
