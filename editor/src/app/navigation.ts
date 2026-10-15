// 跳转历史与链接目标解析。
// - 后退 / 前进(⌘[ / ⌘],notion 5.1 第 4、5 行):跨文档打开、文内锚点跳转前记下当前位置,后退时回到原文档的原位置。
// - 链接目标(PRD 3.2、对照表 X-09、X-10):相对 / 绝对路径、可省略 .md、wikilink 按文件名在根文件夹里找(同名优先同文件夹)。
import type { OpenWhere } from '../core/env'
import { displayName, isOpenable, isTextBundle, isTextDocument } from '../core/filetypes'
import { type DocContext, dirname, extname, joinPath, resolveLocalPath } from '../core/paths'
import type { Host } from '../host/types'

/** 点击时的修饰键 → 打开位置:⌥⇧ 新窗口,⌘(Linux 上 Ctrl)新标签,否则当前标签(notion 5.1 第 10、11 行) */
export function openWhereOf(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): OpenWhere {
  if (e.altKey && e.shiftKey) return 'window'
  return e.metaKey || e.ctrlKey ? 'tab' : 'current'
}

export interface NavEntry {
  /** 文档路径;未保存的新文档为 null(只用于同一文档内的锚点跳转) */
  path: string | null
  /** 跳转前的光标位置 */
  pos: number
}

const MAX_ENTRIES = 100

export class NavHistory {
  private back: NavEntry[] = []
  private forward: NavEntry[] = []

  /** 跳转前记下当前位置;新的跳转清空「前进」 */
  push(from: NavEntry): void {
    this.back.push(from)
    if (this.back.length > MAX_ENTRIES) this.back.shift()
    this.forward = []
  }

  /** 后退:返回要回到的位置,当前位置进「前进」;没有可退的返回 null */
  goBack(current: NavEntry): NavEntry | null {
    const prev = this.back.pop()
    if (!prev) return null
    this.forward.push(current)
    return prev
  }

  goForward(current: NavEntry): NavEntry | null {
    const next = this.forward.pop()
    if (!next) return null
    this.back.push(current)
    return next
  }

  /** 文件改名或移动后,历史里的路径跟着改 */
  rename(from: string, to: string): void {
    for (const e of [...this.back, ...this.forward]) {
      if (e.path && (e.path === from || e.path.startsWith(`${from}/`))) e.path = to + e.path.slice(from.length)
    }
  }

  get canGoBack(): boolean {
    return this.back.length > 0
  }

  get canGoForward(): boolean {
    return this.forward.length > 0
  }
}

export type LinkTarget =
  /** 文内锚点 */
  | { kind: 'anchor'; anchor: string }
  /** 能在 Typoza 打开的文档(含 TextBundle) */
  | { kind: 'doc'; path: string; anchor: string }
  /** 其它本机文件或文件夹:交给默认应用 */
  | { kind: 'file'; path: string }
  /** 不存在;creatable 表示可以询问后新建(Markdown 文档或省略扩展名的写法) */
  | { kind: 'missing'; path: string; creatable: boolean }

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 文档里的链接地址(不含网址)→ 打开目标。root 为侧栏根文件夹,wikilink 在其中按文件名查找。 */
export async function resolveLinkTarget(host: Host, target: string, ctx: DocContext, root: string | null): Promise<LinkTarget> {
  const hash = target.indexOf('#')
  const pathPart = hash >= 0 ? target.slice(0, hash) : target
  const anchor = hash >= 0 ? target.slice(hash + 1) : ''
  if (!pathPart) return { kind: 'anchor', anchor }

  // 未保存的新文档没有所在文件夹,相对路径按根文件夹解析
  const base: DocContext = ctx.path || !root ? ctx : { path: joinPath(root, '未命名.md'), rootUrl: ctx.rootUrl }
  const local = pathPart.startsWith('~/') ? host.homeDir() + safeDecode(pathPart.slice(1)) : resolveLocalPath(pathPart, base)
  if (local) {
    const stat = await host.stat(local)
    if (stat) {
      if (isTextBundle(local) || (!stat.isDir && isOpenable(local))) return { kind: 'doc', path: local, anchor }
      return { kind: 'file', path: local }
    }
    // 本地链接可以省略 .md(对照表 X-10)
    if (!extname(local)) {
      for (const ext of ['md', 'markdown']) {
        if (await host.stat(`${local}.${ext}`)) return { kind: 'doc', path: `${local}.${ext}`, anchor }
      }
    }
  }

  // wikilink 与只写文件名的链接:在根文件夹里按文件名找,同名时优先当前文档所在文件夹(notion 4.3)
  if (!pathPart.includes('/') && root) {
    const name = safeDecode(pathPart).replace(/\.(md|markdown)$/i, '')
    const same = (await host.listMarkdown(root)).filter((p) => displayName(p) === name)
    if (same.length) {
      const docDir = ctx.path ? dirname(ctx.path) : null
      return { kind: 'doc', path: same.find((p) => dirname(p) === docDir) ?? same[0], anchor }
    }
  }

  if (!local) return { kind: 'missing', path: safeDecode(pathPart), creatable: false }
  if (!extname(local)) return { kind: 'missing', path: `${local}.md`, creatable: true }
  return { kind: 'missing', path: local, creatable: isTextDocument(local) }
}
