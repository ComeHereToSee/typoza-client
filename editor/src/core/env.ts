// 编辑器运行环境:节点视图与插件共享的宿主、文档上下文、设置。由应用层创建并在切换文档时更新 ctx。
import type { EditorView } from 'prosemirror-view'
import type { Host } from '../host/types'
import { type LightboxImage, openLightbox } from '../ui/lightbox'
import { isExternalUrl, resolveLocalPath, type DocContext } from './paths'
import { schema } from './schema'
import { SMART_PUNCTUATION_OFF, type SmartPunctuation } from './smart-punctuation'

export interface EditorSettings {
  inlineMath: boolean
  smartPunctuation: SmartPunctuation
  autoPair: boolean
  /** 匹配 Markdown 字符:敲 * _ ` ~ = 时自动补成对(偏好 PE-03) */
  autoPairMarkdown: boolean
  /** 编辑时显示 Markdown 标记(偏好 PE-04) */
  showMarkdownMarkers: boolean
  /** 复制时纯文本部分写 Markdown 源码;关掉则写不带标记的文字(偏好 PE-05) */
  copyPlainAsMarkdown: boolean
  /** 无选区时复制 / 剪切整行(偏好 PE-06) */
  copyLineWithoutSelection: boolean
  codeLineNumbers: boolean
  codeLineWrap: boolean
  spellcheck: boolean
  /** 自定义快捷键:键 → 命令 ID */
  keybindings: Record<string, string>
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  inlineMath: true,
  smartPunctuation: SMART_PUNCTUATION_OFF,
  autoPair: true,
  autoPairMarkdown: false,
  showMarkdownMarkers: false,
  copyPlainAsMarkdown: true,
  copyLineWithoutSelection: false,
  codeLineNumbers: false,
  codeLineWrap: true,
  spellcheck: false,
  keybindings: {},
}

/** 需要对话框、文件选择、资源拷贝等应用层能力的操作,由应用层实现后注入。 */
export interface EditorActions {
  /** 选择本机文件,按图片设置拷进资源目录后插入 */
  insertLocalMedia(view: EditorView, kind: 'image' | 'video' | 'audio' | 'pdf' | 'file'): Promise<void>
  /** 输入网址后插入(网络图片、嵌入、书签……) */
  insertFromUrl(view: EditorView, kind: 'image' | 'embed' | 'bookmark' | 'video' | 'audio'): void
  /** 选择文档并插入相对链接(Notion 的 [[ ) */
  insertDocLink(view: EditorView): void
  /** 当前文件夹里可提及的文档(Notion 的 @),href 已是相对当前文档的链接 */
  listDocuments(): Promise<DocumentRef[]>
  /** 新建文档(Notion ⌘⌥9) */
  newDocument(): void
  /** 粘贴或拖入的文件:按类型(图片 / 视频 / 音频 / PDF / 其它)和图片设置拷进资源目录后插入 */
  importFiles(view: EditorView, files: ImportFile[], at?: number): Promise<void>
  /** 状态栏上方的提示条(书签取不到网页信息、操作失败等) */
  notify(message: string, error?: boolean): void
}

export interface DocumentRef {
  path: string
  /** 文件名去掉扩展名 */
  title: string
  /** 所在文件夹(相对根文件夹,菜单提示用) */
  dir: string
  href: string
}

export interface ImportFile {
  name: string
  /** 浏览器拿到的文件内容(剪贴板图片、浏览器里拖入) */
  base64?: string
  /** 原生拖入时的本机路径 */
  path?: string
}

export interface EditorEnv {
  host: Host
  ctx: DocContext
  settings: EditorSettings
  actions: EditorActions
  /**
   * 打开文档内链接:`#标题` 文内跳转、本地文档、其它本机文件、wikilink。
   * where:current 当前标签,tab 新标签(⌘+点击),window 新窗口(⌥⇧+点击);传布尔时 true 视同 tab。
   */
  openDocumentLink(target: string, where: OpenWhere | boolean): void
}

/** 打开文档的位置:当前标签 / 同一窗口组的新标签 / 新窗口(PRD 3.1、notion 5.1 第 10、11 行) */
export type OpenWhere = 'current' | 'tab' | 'window'

/** 文档里写的地址 → 网页可加载地址。本机文件走宿主的 typoza://local/。 */
export function resourceUrl(env: EditorEnv, src: string): string {
  if (!src) return ''
  if (isExternalUrl(src)) return src.startsWith('//') ? `https:${src}` : src
  if (src.startsWith('~/')) return env.host.resourceURL(env.host.homeDir() + src.slice(1))
  const local = resolveLocalPath(src, env.ctx)
  return local ? env.host.resourceURL(local) : src
}

export function localPathOf(env: EditorEnv, src: string): string | null {
  if (src.startsWith('~/')) return env.host.homeDir() + src.slice(1)
  return resolveLocalPath(src, env.ctx)
}

/** 收集文档里全部图片(按出现顺序),供灯箱前后切换。HTML 块里的 <img> 也算。 */
export function collectImages(view: EditorView, env: EditorEnv): { images: LightboxImage[]; positions: number[] } {
  const images: LightboxImage[] = []
  const positions: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.image) {
      const src = node.attrs.src as string
      const dom = view.nodeDOM(pos)
      images.push({
        url: resourceUrl(env, src),
        alt: node.attrs.alt,
        path: localPathOf(env, src),
        src,
        element: dom instanceof HTMLElement ? (dom.querySelector('img') ?? dom) : null,
      })
      positions.push(pos)
    } else if (node.type === schema.nodes.html_block) {
      const dom = view.nodeDOM(pos)
      const imgs = dom instanceof HTMLElement ? dom.querySelectorAll<HTMLImageElement>('.tz-html-preview img') : []
      for (const img of Array.from(imgs)) {
        const src = img.getAttribute('data-tz-src') ?? img.getAttribute('src') ?? ''
        images.push({ url: img.src, alt: img.alt, path: localPathOf(env, src), src, element: img })
        positions.push(pos)
      }
    }
  })
  return { images, positions }
}

/** 打开灯箱并定位到某张图(按文档位置或元素匹配)。 */
export function openImageLightbox(view: EditorView, env: EditorEnv, target: { pos?: number; element?: HTMLElement }): void {
  const { images, positions } = collectImages(view, env)
  let index = 0
  if (target.element) {
    const i = images.findIndex((img) => img.element === target.element || (img.element && target.element?.contains(img.element)))
    if (i >= 0) index = i
  } else if (target.pos !== undefined) {
    const i = positions.indexOf(target.pos)
    if (i >= 0) index = i
  }
  openLightbox(images, index, {
    reveal: (path) => void env.host.revealInFinder(path),
    // 网络图片由外壳下载后放进剪贴板(复制的是图像数据,不是网址)
    copy: (img) => {
      env.host.copyImageToClipboard(img.path ?? img.url).catch((err: unknown) => env.actions.notify(`复制图片失败:${err instanceof Error ? err.message : String(err)}`, true))
    },
    openExternal: (img) => {
      if (img.path) void env.host.openWithDefaultApp(img.path)
      else void env.host.openExternal(img.url)
    },
  })
}
