import { expect, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'
import { clipboardEvent, hostCalls, putFile } from './media-helpers'

// PRD 3.5 媒体与嵌入;notion-input 三「粘贴网址」(差距清单 1、37、38、56)
test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('粘贴视频网站网址:菜单可选保持链接 / 书签卡片 / 嵌入,嵌入存播放器地址', async ({ page }) => {
  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://www.youtube.com/watch?v=abc123')
  const menu = page.locator('.tz-paste-menu')
  await expect(menu.locator('.tz-menu-label')).toHaveText(['保持链接', '书签卡片', '嵌入 YouTube'])
  await menu.locator('.tz-menu-item', { hasText: '嵌入 YouTube' }).click()
  await expect.poll(() => markdown(page)).toContain(
    '<iframe src="https://www.youtube.com/embed/abc123" width="100%" height="400" frameborder="0" allowfullscreen></iframe>',
  )
})

test('粘贴图片 / 视频直链:菜单首项换成图片 / 视频', async ({ page }) => {
  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://a.example/clip.mp4')
  await expect(page.locator('.tz-paste-menu .tz-menu-label').first()).toHaveText('视频')
  await page.keyboard.press('Enter')
  await expect.poll(() => markdown(page)).toContain('<video src="https://a.example/clip.mp4" controls></video>')

  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://a.example/pic.png')
  await expect(page.locator('.tz-paste-menu .tz-menu-label').first()).toHaveText('图片')
})

test('粘贴网址后 Esc 保持为链接', async ({ page }) => {
  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://example.com/post')
  await expect(page.locator('.tz-paste-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.tz-paste-menu')).toHaveCount(0)
  expect((await markdown(page)).trim()).toBe('https://example.com/post')
})

test('书签卡片取到网页标题与描述后写回文档', async ({ page }) => {
  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://example.com/post')
  await page.locator('.tz-paste-menu .tz-menu-item', { hasText: '书签卡片' }).click()
  await expect(page.locator('.tz-bookmark-title')).toHaveText('预览:https://example.com/post')
  await expect
    .poll(() => markdown(page))
    .toContain('<a href="https://example.com/post" title="内存宿主生成的链接预览" data-tz-type="bookmark">预览:https://example.com/post</a>')
})

test('书签取不到网页信息:用网址作标题并提示', async ({ page }) => {
  await page.evaluate(() => {
    window.typozaTest!.host.fetchLinkPreview = async () => null
  })
  await loadDoc(page, '')
  await clipboardEvent(page, 'paste', 'https://example.com/none')
  await page.locator('.tz-paste-menu .tz-menu-item', { hasText: '书签卡片' }).click()
  await expect(page.locator('.tz-toast')).toContainText('无法获取网页信息,已用网址作标题')
  await expect.poll(() => markdown(page)).toContain('<a href="https://example.com/none" data-tz-type="bookmark">https://example.com/none</a>')
})

test('已存的书签打开时不改文件', async ({ page }) => {
  await loadDoc(page, '<a href="https://example.com" data-tz-type="bookmark">旧标题</a>\n')
  await expect(page.locator('.tz-bookmark-desc')).toHaveText('内存宿主生成的链接预览')
  expect(await markdown(page)).toBe('<a href="https://example.com" data-tz-type="bookmark">旧标题</a>\n')
})

test('站点拒绝嵌入:提示并可在浏览器打开或改为书签', async ({ page }) => {
  await page.evaluate(() => {
    window.typozaTest!.host.checkEmbed = async () => 'refused' as const
  })
  await loadDoc(page, '<iframe src="https://refuse.example.com/page" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n')
  const error = page.locator('.tz-media-error')
  await expect(error).toContainText('无法加载嵌入内容')
  await expect(error).toContainText('该网站不允许嵌入,可改为书签卡片')
  await error.locator('.tz-media-action', { hasText: '在浏览器中打开' }).click()
  await expect.poll(() => hostCalls(page, 'openExternal')).toContainEqual(['https://refuse.example.com/page'])
  await error.locator('.tz-media-action', { hasText: '改为书签' }).click()
  await expect
    .poll(() => markdown(page))
    .toContain('<a href="https://refuse.example.com/page" title="内存宿主生成的链接预览" data-tz-type="bookmark">预览:https://refuse.example.com/page</a>')
})

test('嵌入连不上:显示无法加载嵌入内容', async ({ page }) => {
  await page.evaluate(() => {
    window.typozaTest!.host.checkEmbed = async () => 'unreachable' as const
  })
  await loadDoc(page, '<iframe src="https://down.example.com/" width="100%" height="400"></iframe>\n')
  const error = page.locator('.tz-media-error')
  await expect(error).toContainText('无法加载嵌入内容')
  await expect(error).not.toContainText('不允许嵌入')
  await expect(error.locator('.tz-media-action')).toHaveText(['在浏览器中打开', '改为书签'])
})

test('视频文件丢失:显示「找不到媒体文件」与原路径', async ({ page }) => {
  await loadDoc(page, '<video src="assets/missing.mp4" controls></video>\n')
  const error = page.locator('.tz-media-error')
  await expect(error).toContainText('找不到媒体文件')
  await expect(error).toContainText('assets/missing.mp4')
  expect(await markdown(page)).toBe('<video src="assets/missing.mp4" controls></video>\n')
})

test('/pdf 填网址插入 PDF', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/pdf')
  await page.keyboard.press('Enter')
  const input = page.locator('.tz-media-source input')
  await expect(input).toBeFocused()
  await input.fill('https://example.com/a.pdf')
  await input.press('Enter')
  await expect.poll(() => markdown(page)).toContain('<iframe src="https://example.com/a.pdf" width="100%" height="600"></iframe>')
})

test('/video 填在线视频网址存成嵌入;留空回车选本机文件', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/video')
  await page.keyboard.press('Enter')
  const input = page.locator('.tz-media-source input')
  await expect(input).toBeFocused()
  await input.fill('https://youtu.be/xyz')
  await input.press('Enter')
  await expect.poll(() => markdown(page)).toContain('<iframe src="https://www.youtube.com/embed/xyz"')

  await putFile(page, '/demo/clip.mp4', 'fake')
  await page.evaluate(() => window.typozaTest!.host.dialogQueue.push(['/demo/clip.mp4']))
  await loadDoc(page, '')
  await page.keyboard.type('/video')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tz-media-source input')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => markdown(page)).toContain('<video src="assets/clip.mp4" controls></video>')
})

test('选中 PDF 按 ⌘↩ 用系统「预览」打开', async ({ page }) => {
  await putFile(page, '/demo/assets/doc.pdf', '%PDF-1.4')
  await loadDoc(page, '<iframe src="assets/doc.pdf" width="100%" height="600"></iframe>\n')
  const media = page.locator('.tz-editor .tz-media')
  await media.hover()
  await media.locator('button[title="选中此块"]').click()
  await expect(media).toHaveClass(/ProseMirror-selectednode/)
  await page.keyboard.press(`${await modKey(page)}+Enter`)
  await expect.poll(() => hostCalls(page, 'openInPreview')).toEqual([['/demo/assets/doc.pdf']])
})

test('选中视频按空格播放 / 暂停,不改文档', async ({ page }) => {
  await putFile(page, '/demo/assets/clip.mp4', 'fake')
  await page.evaluate(() => {
    // 内存里的假视频不能真播放:记录 play / pause 调用
    const log: string[] = []
    ;(window as unknown as { __media: string[] }).__media = log
    const playing = new WeakSet<HTMLMediaElement>()
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return !playing.has(this)
      },
    })
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      playing.add(this)
      log.push('play')
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      playing.delete(this)
      log.push('pause')
    }
  })
  await loadDoc(page, '<video src="assets/clip.mp4" controls></video>\n')
  const media = page.locator('.tz-editor .tz-media')
  await media.hover()
  await media.locator('button[title="选中此块"]').click()
  await page.keyboard.press(' ')
  await page.keyboard.press(' ')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __media: string[] }).__media)).toEqual(['play', 'pause'])
  expect(await markdown(page)).toBe('<video src="assets/clip.mp4" controls></video>\n')
})
