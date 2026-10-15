import { expect, test, type Page } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 偏好设置、主题、缩放、智能标点、导出与打印、拖入文件(PRD 3.11 ~ 3.13;对照表 T-01 ~ T-06、V-11 ~ V-14、PA-*、PM-13/14、F-37/38、PF-08 ~ PF-10)。

async function command(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => window.typozaTest!.host.emit('menu.command', { id: cmd }), id)
}

async function openPreferences(page: Page, tab: string): Promise<void> {
  await command(page, 'app.preferences')
  await page.locator(`.tz-settings-tab[data-page="${tab}"]`).click()
  await expect(page.locator(`.tz-settings-tab[data-page="${tab}"]`)).toHaveClass(/is-active/)
}

async function closeModal(page: Page): Promise<void> {
  await page.locator('.tz-modal').last().locator('.tz-modal-close').click()
  await expect(page.locator('.tz-modal')).toHaveCount(0)
}

const savedSetting = (page: Page, key: string) => page.evaluate((k) => window.typozaTest!.host.settings[k], key)

const calls = (page: Page, method: string) =>
  page.evaluate((m) => window.typozaTest!.host.calls.filter((c) => c.method === m).map((c) => c.args), method)

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test.describe('主题', () => {
  test('主题菜单切换内置主题;深色模式单独选主题', async ({ page }) => {
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'github')
    await expect(html).not.toHaveClass(/tz-dark/)

    await command(page, 'theme.pixyll')
    await expect(html).toHaveAttribute('data-theme', 'pixyll')
    await expect.poll(() => savedSetting(page, 'theme')).toBe('pixyll')

    // 切到深色:用深色模式主题(默认 Night)
    await command(page, 'view.toggleDark')
    await expect(html).toHaveAttribute('data-theme', 'night')
    await expect(html).toHaveClass(/tz-dark/)

    // 深色模式下在主题菜单里选的是深色模式主题,浅色主题不变
    await command(page, 'theme.gothic')
    await expect(html).toHaveAttribute('data-theme', 'gothic')
    await expect(html).not.toHaveClass(/tz-dark/)
    await expect.poll(() => savedSetting(page, 'darkTheme')).toBe('gothic')

    await command(page, 'view.toggleDark')
    await expect(html).toHaveAttribute('data-theme', 'pixyll')
  })

  test('主题文件夹里的自定义主题与 base.user.css;找不到主题文件时提示', async ({ page }) => {
    await page.evaluate(() => {
      const folder = '/Users/test/Library/Application Support/Typoza/themes'
      const files = window.typozaTest!.host.files
      files.set(folder, { kind: 'dir', mtime: 1 })
      files.set(`${folder}/my-dark.css`, { kind: 'file', data: '#write { --custom-theme: 1; background: url(img/bg.png); }', mtime: 1 })
      files.set(`${folder}/base.user.css`, { kind: 'file', data: '.tz-editor { --base-user: 1; }', mtime: 1 })
    })
    await command(page, 'theme.my-dark')
    const style = page.locator('#tz-user-theme')
    await expect(style).toContainText('--custom-theme: 1')
    await expect(style).toContainText('--base-user: 1')
    await expect(style).not.toContainText('url(img/bg.png)')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'my-dark')
    // 文件名带 dark / night 的自定义主题按深色主题处理
    await expect(page.locator('html')).toHaveClass(/tz-dark/)

    await command(page, 'theme.missing')
    await expect(page.locator('.tz-toast')).toContainText('找不到主题文件')
  })

  test('深色主题时打印改用浅色主题,打印后还原', async ({ page }) => {
    await command(page, 'view.toggleDark')
    await expect(page.locator('html')).toHaveClass(/tz-dark/)
    await command(page, 'file.print')
    await expect.poll(() => calls(page, 'print')).toEqual([['github', false]])
    await expect(page.locator('html')).toHaveClass(/tz-dark/)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  })
})

test.describe('缩放', () => {
  const zoom = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--tz-zoom'))
  const wheel = (page: Page, init: WheelEventInit) =>
    page.evaluate((i) => document.querySelector('.tz-editor')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...i })), init)

  test('放大、缩小、实际大小命令', async ({ page }) => {
    await command(page, 'view.zoomIn')
    await command(page, 'view.zoomIn')
    await expect.poll(() => zoom(page)).toBe('1.2')
    await expect.poll(() => savedSetting(page, 'zoom')).toBe(1.2)
    await command(page, 'view.zoomOut')
    await expect.poll(() => zoom(page)).toBe('1.1')
    await command(page, 'view.zoomReset')
    await expect.poll(() => zoom(page)).toBe('1')
  })

  test('⌘ + 滚轮与双指缩放;偏好里关掉后不再缩放', async ({ page }) => {
    await wheel(page, { deltaY: -100, metaKey: true })
    await expect.poll(() => zoom(page)).toBe('1.22')
    // 停下 300 毫秒后写进设置
    await expect.poll(() => savedSetting(page, 'zoom')).toBe(1.22)
    // 触控板捏合在 WebKit 里是带 ctrlKey 的滚轮事件
    await wheel(page, { deltaY: 20, ctrlKey: true })
    await expect.poll(() => zoom(page)).toBe('1')

    await openPreferences(page, '外观')
    await page.locator('input[data-key=zoomWithWheel]').uncheck()
    await page.locator('input[data-key=pinchZoom]').uncheck()
    await expect.poll(() => savedSetting(page, 'zoomWithWheel')).toBe(false)
    await closeModal(page)
    await wheel(page, { deltaY: -100, metaKey: true })
    await wheel(page, { deltaY: -100, ctrlKey: true })
    expect(await zoom(page)).toBe('1')
  })
})

test.describe('偏好设置', () => {
  test('页签齐全;编辑器页关闭打字机 / 专注模式;通用页重置警告提示', async ({ page }) => {
    await command(page, 'view.focusMode')
    await command(page, 'view.typewriterMode')
    await expect(page.locator('.tz-editor')).toHaveClass(/tz-focus-mode/)
    await expect(page.locator('.tz-editor')).toHaveClass(/tz-typewriter-mode/)

    await command(page, 'app.preferences')
    const tabs = await page.locator('.tz-settings-tab').allTextContents()
    expect(tabs.slice(0, 8)).toEqual(['文件', '编辑器', '图像', 'Markdown', '导出', '外观', '通用', '快捷键'])

    await page.locator('.tz-settings-tab[data-page="编辑器"]').click()
    await page.getByRole('button', { name: '关闭打字机 / 专注模式' }).click()
    await expect(page.locator('.tz-toast')).toHaveText('打字机模式 / 专注模式 已被关闭。')
    await expect(page.locator('.tz-editor')).not.toHaveClass(/tz-focus-mode/)
    await expect(page.locator('.tz-editor')).not.toHaveClass(/tz-typewriter-mode/)

    // 文件页「恢复未保存的草稿」与文件菜单同一个原生命令
    await page.locator('.tz-settings-tab[data-page="文件"]').click()
    await page.getByRole('button', { name: '恢复未保存的草稿' }).click()
    await expect.poll(() => calls(page, 'runNativeCommand')).toEqual([['native.recoverDrafts']])

    // Markdown 页「空格与换行」与编辑菜单同一组显示选项
    await page.locator('.tz-settings-tab[data-page="Markdown"]').click()
    await page.locator('input[data-key=firstLineIndent]').check()
    await expect(page.locator('html')).toHaveClass(/tz-first-line-indent/)
    await expect.poll(() => savedSetting(page, 'firstLineIndent')).toBe(true)

    await page.locator('.tz-settings-tab[data-page="通用"]').click()
    await expect(page.locator('input[data-key=quitOnLastWindowClosed]')).not.toBeChecked()
    await page.getByRole('button', { name: '重置全部警告提示对话框' }).click()
    await expect(page.locator('.tz-toast')).toHaveText('警告提示对话框已被重置')
  })

  test('快捷键页:录制新键位,冲突时提示占用者,确认后生效;恢复默认', async ({ page }) => {
    const mod = await modKey(page)
    await openPreferences(page, '快捷键')
    await page.locator('.tz-keys-search').fill('加粗')
    const bold = page.locator('.tz-key-btn[data-command="format.bold"]')
    await expect(bold).toHaveText('⌘B')
    await bold.click()
    await expect(bold).toHaveText('请按下新键位…')
    // 录制中按 Esc 只取消录制,不关面板
    await page.keyboard.press('Escape')
    await expect(bold).toHaveText('⌘B')
    await expect(page.locator('.tz-modal')).toHaveCount(1)

    await bold.click()
    await page.keyboard.press(`${mod}+i`)
    const row = page.locator('.tz-key-row', { has: bold })
    await expect(row.locator('.tz-key-note')).toContainText('该键位已被『斜体』使用')
    await row.getByRole('button', { name: '仍然使用' }).click()
    await expect(page.locator('.tz-key-btn[data-command="format.bold"]')).toHaveText('⌘I')
    await expect.poll(() => savedSetting(page, 'keybindings')).toEqual({ 'Mod-b': '', 'Mod-i': 'format.bold' })
    await expect.poll(() => calls(page, 'setMenuKeys')).toContainEqual([
      expect.arrayContaining([
        { id: 'format.bold', key: 'Mod-i' },
        { id: 'format.italic', key: '' },
      ]),
    ])
    await closeModal(page)

    // 编辑器键位随之重建
    await loadDoc(page, '文字')
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.press(`${mod}+i`)
    expect((await markdown(page)).trim()).toBe('**文字**')

    await openPreferences(page, '快捷键')
    await page.getByRole('button', { name: '恢复默认' }).click()
    await expect.poll(() => savedSetting(page, 'keybindings')).toEqual({})
  })
})

test.describe('智能标点', () => {
  test('输入时转换:-- 变 –,--- 变 —;开启智能引号后直引号变弯引号', async ({ page }) => {
    await loadDoc(page, '')
    await page.keyboard.type('a -- b a---b')
    expect((await markdown(page)).trim()).toBe('a – b a—b')

    await openPreferences(page, 'Markdown')
    await page.locator('input[data-key=smartQuotes]').check()
    await closeModal(page)
    await loadDoc(page, '')
    await page.keyboard.type(`他说 "hi" it's`)
    expect((await markdown(page)).trim()).toBe('他说 “hi” it’s')
  })

  test('渲染时转换:只改显示,文件里保留直引号与连字符', async ({ page }) => {
    await openPreferences(page, 'Markdown')
    await page.locator('select[data-key=smartPunctuationMode]').selectOption('render')
    await page.locator('input[data-key=smartQuotes]').check()
    await closeModal(page)
    await loadDoc(page, 'x "y" -- z\n')
    await expect(page.locator('.tz-editor .tz-smart')).toHaveCount(3)
    expect(await markdown(page)).toBe('x "y" -- z\n')
  })
})

test.describe('导出', () => {
  test('导出 HTML → 导出成功 → 导出后在访达中显示;导出并覆盖上一次导出的文件先确认', async ({ page }) => {
    await openPreferences(page, '导出')
    await page.locator('select[data-key=exportAfter]').selectOption('revealFile')
    await closeModal(page)
    await loadDoc(page, '# 导出测试\n\n正文 <!-- 注释 -->\n', '/demo/导出测试.md')

    await command(page, 'file.export.html')
    await expect(page.locator('.tz-toast')).toHaveText('导出成功')
    const exported = await calls(page, 'exportDocument')
    expect(exported.map((a) => [a[0], a[1]])).toEqual([['html', '/demo/导出测试.html']])
    await expect.poll(() => calls(page, 'revealInFinder')).toEqual([['/demo/导出测试.html']])
    const html = await page.evaluate(() => window.typozaTest!.host.files.get('/demo/导出测试.html')?.data as string)
    expect(html).toContain('导出测试')
    expect(html).not.toContain('注释')

    await command(page, 'file.exportOverwrite')
    await expect
      .poll(async () => (await calls(page, 'confirm')).map((a) => (a[0] as { title: string }).title))
      .toContain('"导出并覆盖上一次导出的文件" 会覆盖位于 /demo/导出测试.html 的文件,是否继续?')
    await expect.poll(async () => (await calls(page, 'exportDocument')).length).toBe(2)
    expect((await calls(page, 'saveDialog')).length).toBe(1)
  })
})

test.describe('拖入文件', () => {
  test('Markdown 文件按偏好插入链接;文件夹在侧栏打开', async ({ page }) => {
    await openPreferences(page, '文件')
    await page.locator('select[data-key=dropMarkdownAction]').selectOption('link')
    await closeModal(page)
    await loadDoc(page, '参见\n', '/demo/拖入.md')

    const box = (await page.locator('.tz-editor p').first().boundingBox())!
    const drop = (paths: string[]) =>
      page.evaluate(({ p, x, y }) => window.typozaTest!.host.emit('app.dropFiles', { paths: p, x, y }), {
        p: paths,
        x: box.x + box.width - 4,
        y: box.y + box.height / 2,
      })
    await drop(['/demo/另一篇.md'])
    await expect.poll(async () => (await markdown(page)).trim()).toBe('参见[另一篇](另一篇.md)')

    await page.evaluate(() => window.typozaTest!.host.files.set('/demo/资料', { kind: 'dir', mtime: 1 }))
    await drop(['/demo/资料'])
    await expect.poll(() => page.evaluate(() => window.typozaTest!.app.settings.lastFolder)).toBe('/demo/资料')
  })
})
