// 文件操作(PRD 3.8 文件树、对照表 S-07~S-20、F-09、F-13、F-16、F-20),侧栏右键菜单与文件菜单共用:
// 新建、重命名、创建副本、移动(覆盖前确认)、移到废纸篓、属性、撤销上一次文件操作;
// 改名或移动后询问是否更新其他文档里指向它的链接(PRD 3.8 改名联动)。
import { isTextBundle, isTextDocument } from '../core/filetypes'
import { basename, dirname, joinPath } from '../core/paths'
import type { Host } from '../host/types'
import { h } from '../ui/dom'
import { promptInput } from '../ui/prompt'
import { rewriteLinks } from './linkrewrite'
import { countWords, modal } from './panels'
import { textBundleText } from './textbundle'

type UndoOp =
  | { kind: 'move'; from: string; to: string; replaced: string | null }
  | { kind: 'create'; path: string }
  | { kind: 'trash'; path: string; trashed: string }

export interface FileOpsUi {
  toast(message: string, error?: boolean, action?: { label: string; run: () => void }): void
  /** 文件或文件夹换了位置(改名、移动、撤销移动):当前文档路径、后退历史跟着变 */
  moved(from: string, to: string): void
  /** 文件或文件夹被移到了废纸篓 */
  trashed(path: string): void
  /** 文件树、文档列表重读 */
  refresh(): void
  /** 侧栏根文件夹:改名联动扫描的范围 */
  root(): string | null
  /** 当前文档有未保存的修改时先写盘(改链接前) */
  saveCurrent(): Promise<void>
  /** 这些文件被改写了:当前文档在其中就重新载入 */
  rewritten(paths: string[]): Promise<void>
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const BAD_NAME = /[/:]/

export class FileOps {
  private last: UndoOp | null = null

  constructor(
    private readonly host: Host,
    private readonly ui: FileOpsUi,
  ) {}

  get canUndo(): boolean {
    return this.last !== null
  }

  private undoAction(): { label: string; run: () => void } {
    return { label: '撤销', run: () => void this.undo() }
  }

  /** 新建文件 / 文件夹,直接输入名称(对照表 S-07)。返回新路径,取消或失败返回 null。 */
  async create(dir: string, folder: boolean): Promise<string | null> {
    const name = await promptInput({ title: folder ? '新建文件夹' : '新建文件', placeholder: folder ? '文件夹名' : '文件名.md' })
    if (!name) return null
    if (BAD_NAME.test(name)) {
      this.ui.toast('名称里不能有「/」或「:」', true)
      return null
    }
    const file = folder || /\.\w+$/.test(name) ? name : `${name}.md`
    const path = joinPath(dir, file)
    try {
      if (await this.host.stat(path)) throw new Error('目标路径已存在同名文件')
      if (folder) await this.host.mkdir(path)
      else await this.host.writeText(path, '')
      this.last = { kind: 'create', path }
      this.ui.refresh()
      return path
    } catch (err) {
      this.ui.toast(errText(err), true)
      return null
    }
  }

  /** 重命名(对照表 S-08、F-20)。返回新路径。 */
  async rename(path: string): Promise<string | null> {
    const name = await promptInput({ title: '重命名', value: basename(path) })
    if (!name || name === basename(path)) return null
    if (BAD_NAME.test(name)) {
      this.ui.toast('名称里不能有「/」或「:」', true)
      return null
    }
    return this.relocate(path, joinPath(dirname(path), name), '重命名文件失败', false)
  }

  /** 移动到…:选文件夹后移动(对照表 S-10、F-20)。 */
  async chooseAndMove(path: string): Promise<string | null> {
    const dirs = await this.host.openDialog({ directory: true })
    if (!dirs?.[0]) return null
    return this.moveInto(path, dirs[0])
  }

  /** 移到某个文件夹里(含拖动);目标已有同名项时先确认「是否继续移动并替换原有文件?」 */
  async moveInto(path: string, dir: string): Promise<string | null> {
    const target = joinPath(dir, basename(path))
    if (target === path) return null
    if (dir === path || dir.startsWith(`${path}/`)) {
      this.ui.toast('不能把文件夹移到它自己里面', true)
      return null
    }
    return this.relocate(path, target, '移动文件失败', true)
  }

  private async relocate(from: string, to: string, failText: string, allowReplace: boolean): Promise<string | null> {
    try {
      let replaced: string | null = null
      if (await this.host.stat(to)) {
        if (!allowReplace) throw new Error('目标路径已存在同名文件')
        const choice = await this.host.confirm({
          title: `「${basename(to)}」已存在`,
          message: '是否继续移动并替换原有文件?',
          buttons: ['替换', '取消'],
          style: 'warning',
        })
        if (choice !== 0) return null
        // 被替换的文件进废纸篓而不是直接删除,撤销时能放回来
        replaced = (await this.host.trash(to)) ?? null
      }
      await this.host.rename(from, to)
      this.last = { kind: 'move', from, to, replaced }
      this.ui.moved(from, to)
      this.ui.refresh()
    } catch (err) {
      this.ui.toast(`${failText}:${errText(err)}`, true)
      return null
    }
    const updated = await this.offerLinkUpdate(from, to)
    const done = dirname(from) === dirname(to) ? `已重命名为「${basename(to)}」` : `已移到「${basename(dirname(to))}」`
    this.ui.toast(updated ? `${done},并更新了 ${updated} 处链接` : done, false, this.undoAction())
    return to
  }

  /** 创建副本(对照表 S-09、F-16):同一文件夹下「名称 副本.md」,重名时加序号。 */
  async duplicate(path: string): Promise<string | null> {
    const dir = dirname(path)
    const name = basename(path)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let target = joinPath(dir, `${stem} 副本${ext}`)
    try {
      for (let i = 2; await this.host.stat(target); i++) target = joinPath(dir, `${stem} 副本 ${i}${ext}`)
      await this.host.copyFile(path, target)
    } catch (err) {
      this.ui.toast(`创建副本失败:${errText(err)}`, true)
      return null
    }
    this.last = { kind: 'create', path: target }
    this.ui.refresh()
    this.ui.toast(`已创建副本「${basename(target)}」`, false, this.undoAction())
    return target
  }

  /** 移到废纸篓(PRD 3.8、对照表 F-13、S-11)。 */
  async trash(path: string): Promise<boolean> {
    const choice = await this.host.confirm({
      title: `要把「${basename(path)}」移到废纸篓吗?`,
      message: '您可以从回收站恢复文件。',
      buttons: ['移到废纸篓', '取消'],
      style: 'warning',
    })
    if (choice !== 0) return false
    let trashed: string | null
    try {
      trashed = (await this.host.trash(path)) ?? null
    } catch (err) {
      this.ui.toast(`无法将文件移至回收站:${errText(err)}`, true)
      return false
    }
    this.last = trashed ? { kind: 'trash', path, trashed } : null
    this.ui.trashed(path)
    this.ui.refresh()
    this.ui.toast(`已把「${basename(path)}」移到废纸篓`, false, trashed ? this.undoAction() : undefined)
    return true
  }

  /** 撤销上一次文件操作(对照表 S-20):只能撤销最后一次。 */
  async undo(): Promise<boolean> {
    const op = this.last
    if (!op) return false
    this.last = null
    try {
      if (op.kind === 'move') {
        await this.host.rename(op.to, op.from)
        if (op.replaced) await this.host.rename(op.replaced, op.to)
        this.ui.moved(op.to, op.from)
      } else if (op.kind === 'create') {
        await this.host.trash(op.path)
        this.ui.trashed(op.path)
      } else {
        await this.host.rename(op.trashed, op.path)
      }
    } catch (err) {
      this.ui.toast(`撤销失败:${errText(err)}`, true)
      return false
    }
    this.ui.refresh()
    this.ui.toast('已撤销上一次文件操作')
    return true
  }

  /** PRD 3.8 改名联动:扫描根文件夹里的其它文档,询问是否更新指向它的 N 处链接。返回更新的处数。 */
  async offerLinkUpdate(from: string, to: string): Promise<number> {
    const root = this.ui.root()
    if (!root) return 0
    await this.ui.saveCurrent()
    const plan: { path: string; text: string; encoding: string; count: number }[] = []
    try {
      for (const path of await this.host.listMarkdown(root)) {
        // 被移动的文件(或被移动文件夹里的文件)自身不扫:它们的相对链接以新位置为准另算
        if (!isTextDocument(path) || path === to || path.startsWith(`${to}/`)) continue
        const { text, encoding } = await this.host.readText(path)
        const r = rewriteLinks(text, path, from, to)
        if (r.count) plan.push({ path, text: r.text, encoding, count: r.count })
      }
    } catch (err) {
      this.ui.toast(`检查链接失败:${errText(err)}`, true)
      return 0
    }
    const total = plan.reduce((n, p) => n + p.count, 0)
    if (total === 0) return 0
    const names = plan.slice(0, 6).map((p) => `「${basename(p.path)}」`).join('、')
    const choice = await this.host.confirm({
      title: `是否更新其他文档中指向它的 ${total} 处链接?`,
      message: plan.length > 6 ? `${names} 等 ${plan.length} 个文档` : names,
      buttons: ['更新', '不更新'],
    })
    if (choice !== 0) return 0
    try {
      for (const p of plan) await this.host.writeText(p.path, p.text, p.encoding)
    } catch (err) {
      this.ui.toast(`更新链接失败:${errText(err)}`, true)
      return 0
    }
    await this.ui.rewritten(plan.map((p) => p.path))
    return total
  }

  /** 属性 / 显示简介(对照表 S-12、F-09):路径、大小、创建与修改时间;文本文件另有字数、编码、换行符。 */
  async showInfo(path: string, title = '属性'): Promise<void> {
    const stat = await this.host.stat(path)
    if (!stat) {
      this.ui.toast('目标文件或文件夹不存在。', true)
      return
    }
    const rows: [string, string][] = [
      ['位置', path],
      ['种类', isTextBundle(path) ? 'TextBundle' : stat.isDir ? '文件夹' : '文件'],
    ]
    if (!stat.isDir) rows.push(['大小', formatSize(stat.size)])
    rows.push(['创建时间', stat.ctime ? formatTime(stat.ctime) : '未知'], ['修改时间', formatTime(stat.mtime)])
    try {
      const textPath = isTextBundle(path) ? await textBundleText(this.host, path) : !stat.isDir && isTextDocument(path) ? path : null
      if (textPath) {
        const { text, encoding } = await this.host.readText(textPath)
        rows.push(['字数', String(countWords(text).words)], ['编码', encoding], ['换行符', text.includes('\r\n') ? 'CRLF(Windows)' : 'LF(macOS / Linux)'])
      }
    } catch (err) {
      rows.push(['内容', `读取失败:${errText(err)}`])
    }
    const table = h('table', { class: 'tz-file-info' }, h('tbody', null, ...rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v)))))
    modal(title, table)
  }
}

// ---------- 最近使用的目录与固定(对照表 F-06、S-18) ----------
// 存在偏好设置文件里(键 recentFolders、pinnedFolders),外壳的「最近使用的目录」菜单读同一份。

export interface FolderLists {
  recent: string[]
  pinned: string[]
}

const MAX_RECENT_FOLDERS = 10

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export async function loadFolders(host: Host): Promise<FolderLists> {
  const s = await host.getSettings()
  return { recent: strings(s.recentFolders), pinned: strings(s.pinnedFolders) }
}

export async function noteRecentFolder(host: Host, path: string): Promise<void> {
  const { recent } = await loadFolders(host)
  if (recent[0] === path) return
  await host.setSettings({ recentFolders: [path, ...recent.filter((p) => p !== path)].slice(0, MAX_RECENT_FOLDERS) })
}

export async function setFolderPinned(host: Host, path: string, pinned: boolean): Promise<void> {
  const lists = await loadFolders(host)
  const rest = lists.pinned.filter((p) => p !== path)
  await host.setSettings({ pinnedFolders: pinned ? [path, ...rest] : rest })
}

/** 从列表中删除(最近与固定都去掉) */
export async function forgetFolder(host: Host, path: string): Promise<void> {
  const { recent, pinned } = await loadFolders(host)
  await host.setSettings({ recentFolders: recent.filter((p) => p !== path), pinnedFolders: pinned.filter((p) => p !== path) })
}
