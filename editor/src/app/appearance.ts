// 主题与外观(PRD 3.11;对照表 T-01 ~ T-06、PA-02 ~ PA-04、V-11 ~ V-14):
// 内置 6 款主题 + 主题文件夹里的自定义主题,深色模式可单独选主题;base.user.css / 主题名.user.css 追加样式;
// 字号跟随主题或自定义;⌘ + 滚轮与触控板捏合缩放页面;深色主题时打印改用浅色主题。
import { joinPath } from '../core/paths'
import type { Host } from '../host/types'
import { isLightboxOpen } from '../ui/lightbox'
import { type AppSettings, BUILTIN_THEMES, themesFolder } from './settings'

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100
}

/** 当前是否处于深色模式:手动选了深色,或跟随系统且系统是深色。 */
export function isDarkMode(s: AppSettings, systemDark: boolean): boolean {
  return s.appearance === 'dark' || (s.appearance === 'system' && systemDark)
}

/** 实际使用的主题:深色模式下用「深色模式主题」(T-06)。 */
export function effectiveTheme(s: AppSettings, systemDark: boolean): string {
  return isDarkMode(s, systemDark) ? s.darkTheme || s.theme : s.theme
}

/** 深色主题:内置的 Night;自定义主题按文件名带 dark / night 判断(Typora 主题的通行命名)。 */
export function isDarkTheme(id: string): boolean {
  const builtin = BUILTIN_THEMES.find((t) => t.id === id)
  return builtin ? builtin.dark : /dark|night/i.test(id)
}

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some((t) => t.id === id)
}

/** 把设置落到页面根节点上(主题、深浅色、字体、字号、宽度、缩放),并按需加载自定义主题样式。 */
export function applyAppearance(host: Host, s: AppSettings, systemDark: boolean, onError: (message: string) => void): void {
  const root = document.documentElement
  const theme = effectiveTheme(s, systemDark)
  root.classList.toggle('tz-dark', isDarkTheme(theme))
  root.dataset.theme = theme
  root.dataset.font = s.fontFamily
  root.dataset.width = s.pageWidth
  // 「使用主题的字体大小」时不写行内变量,让主题(内置主题或用户 CSS)自己的字号生效
  if (s.fontSizeMode === 'custom') root.style.setProperty('--tz-font-size', `${s.fontSize}px`)
  else root.style.removeProperty('--tz-font-size')
  root.style.setProperty('--tz-zoom', String(s.zoom))
  void loadThemeCss(host, theme, false).catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
}

let loadedTheme: string | null = null

function themeStyleElement(): HTMLStyleElement {
  let el = document.getElementById('tz-user-theme') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'tz-user-theme'
    // 放在 head 最后,同等优先级时盖过内置样式
    document.head.append(el)
  }
  return el
}

/** 主题 CSS 里的相对 url() 是相对主题文件夹写的,改成本机资源地址(typoza://local/…)才能在编辑器里加载。 */
export function rewriteThemeUrls(css: string, folder: string, resourceURL: (absPath: string) => string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _quote: string, url: string) => {
    if (/^(data:|https?:|typoza:|blob:|#)/i.test(url)) return whole
    const abs = url.startsWith('/') ? url : joinPath(folder, url)
    return `url("${resourceURL(abs)}")`
  })
}

/**
 * 加载自定义主题(T-02)与追加样式(T-03):自定义主题读「主题名.css」;所有主题都再追加 base.user.css 与「主题名.user.css」。
 * 同一主题只读一次,force 时重读(在主题菜单里再点一次即可让改过的 CSS 生效)。
 */
export async function loadThemeCss(host: Host, theme: string, force: boolean): Promise<void> {
  if (!force && loadedTheme === theme) return
  loadedTheme = theme
  const folder = themesFolder(host)
  const names = [...(isBuiltinTheme(theme) ? [] : [`${theme}.css`]), 'base.user.css', `${theme}.user.css`]
  const parts: string[] = []
  for (const name of names) {
    const path = `${folder}/${name}`
    const stat = await host.stat(path)
    if (!stat) {
      if (name === `${theme}.css`) {
        themeStyleElement().textContent = ''
        throw new Error(`找不到主题文件:${path}`)
      }
      continue
    }
    const { text } = await host.readText(path)
    parts.push(`/* ${name} */\n${rewriteThemeUrls(text, folder, (p) => host.resourceURL(p))}`)
  }
  // 读文件期间又切了别的主题:以后切的为准
  if (loadedTheme === theme) themeStyleElement().textContent = parts.join('\n')
}

/** 主题文件夹里的自定义主题(不含 *.user.css),按文件名排序。 */
export async function listCustomThemes(host: Host): Promise<string[]> {
  const folder = themesFolder(host)
  if (!(await host.stat(folder))) return []
  return (await host.listDir(folder))
    .filter((f) => !f.isDir && /\.css$/i.test(f.name) && !/\.user\.css$/i.test(f.name))
    .map((f) => f.name.replace(/\.css$/i, ''))
    .filter((id) => !isBuiltinTheme(id))
    .sort((a, b) => a.localeCompare(b))
}

/** 打开主题文件夹(T-05),不存在先建。 */
export async function openThemesFolder(host: Host): Promise<void> {
  const folder = themesFolder(host)
  await host.mkdir(folder)
  await host.openWithDefaultApp(folder)
}

/**
 * ⌘ + 滚轮(PA-03)与触控板捏合(V-11)缩放页面。缩放立即生效,停下 300 毫秒后再写进设置,避免每个滚轮事件都写盘。
 * 灯箱打开时不处理:灯箱有自己的缩放。
 */
export function bindZoomGestures(getSettings: () => AppSettings, persist: (zoom: number) => void): void {
  let timer = 0
  let gestureBase: number | null = null
  const setZoom = (zoom: number) => {
    const z = clampZoom(zoom)
    const s = getSettings()
    if (z === s.zoom) return
    s.zoom = z
    document.documentElement.style.setProperty('--tz-zoom', String(z))
    clearTimeout(timer)
    timer = window.setTimeout(() => persist(z), 300)
  }
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.defaultPrevented || isLightboxOpen()) return
      const s = getSettings()
      // macOS 触控板捏合在 WebKit 里同时以带 ctrlKey 的滚轮事件出现;手势进行中时以手势事件为准
      const pinch = e.ctrlKey && !e.metaKey
      if (pinch ? !s.pinchZoom || gestureBase !== null : !(e.metaKey && s.zoomWithWheel)) return
      e.preventDefault()
      setZoom(s.zoom * Math.exp(-e.deltaY * (pinch ? 0.01 : 0.002)))
    },
    { passive: false },
  )
  window.addEventListener('gesturestart', (e) => {
    if (e.defaultPrevented || isLightboxOpen() || !getSettings().pinchZoom) return
    e.preventDefault()
    gestureBase = getSettings().zoom
  })
  window.addEventListener('gesturechange', (e) => {
    if (gestureBase === null) return
    e.preventDefault()
    setZoom(gestureBase * ((e as Event & { scale?: number }).scale ?? 1))
  })
  window.addEventListener('gestureend', () => {
    gestureBase = null
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * 打印(PRD 3.12):深色主题时临时换成浅色主题(设置的浅色主题;它本身也是深色时用 Github),打印结束后还原。
 * restore 由调用方提供(重新应用当前外观)。
 */
export async function printDocument(host: Host, s: AppSettings, systemDark: boolean, restore: () => void): Promise<void> {
  const theme = effectiveTheme(s, systemDark)
  if (isDarkTheme(theme)) {
    const light = isDarkTheme(s.theme) ? 'github' : s.theme
    const root = document.documentElement
    root.classList.remove('tz-dark')
    root.dataset.theme = light
    await loadThemeCss(host, light, false)
    // 等样式真正排版后再交给系统打印
    await nextFrame()
    await nextFrame()
  }
  try {
    await host.print()
  } finally {
    restore()
  }
}
