// 侧栏(Typora):文件树 / 文档列表 / 大纲,外加全局搜索。文件夹变化由宿主监听后推送刷新。
import type { HeadingItem } from '../core/blocks'
import { basename, dirname, joinPath } from '../core/paths'
import type { FileStat, Host, SearchHit } from '../host/types'
import { h } from '../ui/dom'
import { FloatingMenu, type MenuItem } from '../ui/menu'
import { promptInput } from '../ui/prompt'

export type SidebarTab = 'files' | 'list' | 'outline' | 'search'

export interface SidebarCallbacks {
  openFile(path: string, newWindow: boolean): void
  jumpToHeading(item: HeadingItem): void
  currentPath(): string | null
  onTabChange(tab: SidebarTab): void
  onError(message: string): void
}

const MD = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|txt)$/i

export class Sidebar {
  readonly el: HTMLElement
  private readonly body: HTMLDivElement
  private readonly tabs: Record<SidebarTab, HTMLButtonElement>
  private tab: SidebarTab = 'files'
  private root: string | null = null
  private readonly expanded = new Set<string>()
  private headings: HeadingItem[] = []
  private activeHeading = -1
  private searchInput: HTMLInputElement | null = null
  private searchResults: SearchHit[] = []
  private readonly menu = new FloatingMenu({ className: 'tz-context-menu' })
  private renderSeq = 0

  constructor(
    private readonly host: Host,
    private readonly cb: SidebarCallbacks,
  ) {
    const tab = (id: SidebarTab, label: string, title: string) => {
      const b = h('button', { type: 'button', class: 'tz-side-tab', title, 'data-tab': id }, label)
      b.addEventListener('click', () => this.setTab(id))
      return b
    }
    this.tabs = {
      files: tab('files', '文件', '文件树(⌃⌘3)'),
      list: tab('list', '文档', '文档列表(⌃⌘2)'),
      outline: tab('outline', '大纲', '大纲(⌃⌘1)'),
      search: tab('search', '搜索', '全局搜索(⇧⌘F)'),
    }
    this.body = h('div', { class: 'tz-side-body' })
    this.el = h('aside', { class: 'tz-sidebar' }, h('div', { class: 'tz-side-tabs' }, ...Object.values(this.tabs)), this.body)
  }

  get currentTab(): SidebarTab {
    return this.tab
  }

  setTab(tab: SidebarTab): void {
    this.tab = tab
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle('is-active', k === tab)
    this.cb.onTabChange(tab)
    void this.render()
    if (tab === 'search') requestAnimationFrame(() => this.searchInput?.focus())
  }

  setRoot(root: string | null): void {
    if (root === this.root) return
    this.root = root
    if (root) {
      this.expanded.add(root)
      void this.host.watch([root])
    }
    void this.render()
  }

  get rootFolder(): string | null {
    return this.root
  }

  setHeadings(headings: HeadingItem[], active: number): void {
    const changed = headings.length !== this.headings.length || headings.some((x, i) => x.text !== this.headings[i]?.text || x.level !== this.headings[i]?.level)
    this.headings = headings
    const activeChanged = active !== this.activeHeading
    this.activeHeading = active
    if (this.tab !== 'outline') return
    if (changed) void this.render()
    else if (activeChanged) this.highlightOutline()
  }

  /** 文件变化后刷新(文件树、文档列表)。 */
  refresh(): void {
    if (this.tab === 'files' || this.tab === 'list') void this.render()
  }

  markCurrent(): void {
    const cur = this.cb.currentPath()
    for (const el of Array.from(this.body.querySelectorAll<HTMLElement>('[data-path]'))) el.classList.toggle('is-current', el.dataset.path === cur)
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq
    let content: HTMLElement
    switch (this.tab) {
      case 'files':
        content = await this.renderTree()
        break
      case 'list':
        content = await this.renderList()
        break
      case 'outline':
        content = this.renderOutline()
        break
      case 'search':
        content = this.renderSearch()
        break
    }
    if (seq !== this.renderSeq) return
    this.body.replaceChildren(content)
    this.markCurrent()
    if (this.tab === 'outline') this.highlightOutline()
  }

  // ---------- 文件树 ----------

  private emptyRoot(): HTMLElement {
    const open = h('button', { type: 'button', class: 'tz-side-empty-btn' }, '打开文件夹…')
    open.addEventListener('click', () => {
      void this.host.openDialog({ directory: true }).then((paths) => {
        if (paths?.[0]) this.setRoot(paths[0])
      })
    })
    return h('div', { class: 'tz-side-empty' }, h('p', null, '还没有打开文件夹'), open)
  }

  private async renderTree(): Promise<HTMLElement> {
    if (!this.root) return this.emptyRoot()
    const header = h('div', { class: 'tz-tree-root', title: this.root }, basename(this.root) || this.root)
    header.addEventListener('contextmenu', (e) => this.contextMenu(e, { path: this.root!, name: basename(this.root!), isDir: true, size: 0, mtime: 0 }))
    const tree = h('div', { class: 'tz-tree', role: 'tree' })
    await this.renderDir(this.root, tree, 0)
    return h('div', { class: 'tz-tree-wrap' }, header, tree)
  }

  private async renderDir(dir: string, into: HTMLElement, depth: number): Promise<void> {
    let entries: FileStat[]
    try {
      entries = await this.host.listDir(dir)
    } catch (err) {
      into.append(h('div', { class: 'tz-tree-error' }, `无法读取:${err instanceof Error ? err.message : String(err)}`))
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (!e.isDir && !MD.test(e.name)) continue
      const row = h(
        'div',
        { class: `tz-tree-item${e.isDir ? ' is-dir' : ''}`, role: 'treeitem', 'data-path': e.path, style: `padding-left:${8 + depth * 14}px`, title: e.path },
        h('span', { class: 'tz-tree-twisty' }, e.isDir ? (this.expanded.has(e.path) ? '▾' : '▸') : ''),
        h('span', { class: 'tz-tree-name' }, e.isDir ? e.name : e.name.replace(/\.(md|markdown)$/i, '')),
      )
      row.addEventListener('click', (ev) => {
        if (e.isDir) {
          if (this.expanded.has(e.path)) this.expanded.delete(e.path)
          else this.expanded.add(e.path)
          void this.render()
        } else {
          this.cb.openFile(e.path, ev.metaKey)
        }
      })
      row.addEventListener('contextmenu', (ev) => this.contextMenu(ev, e))
      into.append(row)
      if (e.isDir && this.expanded.has(e.path)) await this.renderDir(e.path, into, depth + 1)
    }
  }

  private contextMenu(ev: MouseEvent, e: FileStat): void {
    ev.preventDefault()
    const dir = e.isDir ? e.path : dirname(e.path)
    const items: MenuItem[] = [
      { id: 'new.file', label: '新建文件', run: () => void this.createEntry(dir, false) },
      { id: 'new.folder', label: '新建文件夹', run: () => void this.createEntry(dir, true) },
    ]
    if (e.path !== this.root) {
      items.push(
        { id: 'rename', label: '重命名…', run: () => void this.renameEntry(e) },
        { id: 'trash', label: '移到废纸篓', run: () => void this.trashEntry(e) },
      )
    }
    if (!e.isDir) items.push({ id: 'open.new', label: '在新标签页打开', run: () => this.cb.openFile(e.path, true) })
    items.push(
      { id: 'reveal', label: '在 Finder 中显示', run: () => void this.host.revealInFinder(e.path) },
      { id: 'copy.path', label: '拷贝文件路径', run: () => void navigator.clipboard.writeText(e.path) },
    )
    this.menu.open(items, { left: ev.clientX, top: ev.clientY, bottom: ev.clientY })
  }

  private async createEntry(dir: string, folder: boolean): Promise<void> {
    const name = await promptInput({ title: folder ? '新建文件夹' : '新建文件', placeholder: folder ? '文件夹名' : '文件名.md' })
    if (!name) return
    const file = folder || /\.\w+$/.test(name) ? name : `${name}.md`
    const path = joinPath(dir, file)
    try {
      if (await this.host.stat(path)) throw new Error(`已存在同名项:${file}`)
      if (folder) await this.host.mkdir(path)
      else await this.host.writeText(path, '')
      this.expanded.add(dir)
      await this.render()
      if (!folder) this.cb.openFile(path, false)
    } catch (err) {
      this.cb.onError(err instanceof Error ? err.message : String(err))
    }
  }

  private async renameEntry(e: FileStat): Promise<void> {
    const name = await promptInput({ title: '重命名', value: e.name })
    if (!name || name === e.name) return
    try {
      const target = joinPath(dirname(e.path), name)
      if (await this.host.stat(target)) throw new Error(`已存在同名项:${name}`)
      await this.host.rename(e.path, target)
      await this.render()
    } catch (err) {
      this.cb.onError(err instanceof Error ? err.message : String(err))
    }
  }

  private async trashEntry(e: FileStat): Promise<void> {
    const choice = await this.host.confirm({
      title: `把「${e.name}」移到废纸篓?`,
      message: '可以在废纸篓里恢复。',
      buttons: ['移到废纸篓', '取消'],
      style: 'warning',
    })
    if (choice !== 0) return
    try {
      await this.host.trash(e.path)
      await this.render()
    } catch (err) {
      this.cb.onError(err instanceof Error ? err.message : String(err))
    }
  }

  // ---------- 文档列表 ----------

  private async renderList(): Promise<HTMLElement> {
    if (!this.root) return this.emptyRoot()
    const paths = await this.host.listMarkdown(this.root)
    const stats = (await Promise.all(paths.slice(0, 500).map((p) => this.host.stat(p)))).filter((s): s is FileStat => s !== null)
    stats.sort((a, b) => b.mtime - a.mtime)
    const list = h('div', { class: 'tz-doc-list' })
    for (const s of stats) {
      const rel = s.path.startsWith(`${this.root}/`) ? s.path.slice(this.root.length + 1) : s.path
      const item = h(
        'div',
        { class: 'tz-doc-item', 'data-path': s.path, title: s.path },
        h('div', { class: 'tz-doc-title' }, s.name.replace(/\.(md|markdown)$/i, '')),
        h('div', { class: 'tz-doc-meta' }, `${new Date(s.mtime).toLocaleString('zh-CN', { hour12: false })} · ${dirname(rel) === '/' ? '' : dirname(rel)}`),
      )
      item.addEventListener('click', (ev) => this.cb.openFile(s.path, ev.metaKey))
      item.addEventListener('contextmenu', (ev) => this.contextMenu(ev, s))
      list.append(item)
    }
    if (stats.length === 0) list.append(h('div', { class: 'tz-side-empty' }, '文件夹里没有 Markdown 文件'))
    return list
  }

  // ---------- 大纲 ----------

  private renderOutline(): HTMLElement {
    const box = h('div', { class: 'tz-outline' })
    if (this.headings.length === 0) {
      box.append(h('div', { class: 'tz-side-empty' }, '文档里还没有标题'))
      return box
    }
    const min = Math.min(...this.headings.map((x) => x.level))
    this.headings.forEach((item, i) => {
      const row = h('div', { class: `tz-outline-item tz-outline-l${item.level - min + 1}`, 'data-index': String(i) }, item.text || '(无标题)')
      row.addEventListener('click', () => this.cb.jumpToHeading(item))
      box.append(row)
    })
    return box
  }

  private highlightOutline(): void {
    for (const el of Array.from(this.body.querySelectorAll<HTMLElement>('.tz-outline-item'))) {
      const on = Number(el.dataset.index) === this.activeHeading
      el.classList.toggle('is-active', on)
      if (on) el.scrollIntoView({ block: 'nearest' })
    }
  }

  // ---------- 全局搜索 ----------

  private renderSearch(): HTMLElement {
    const input = h('input', { class: 'tz-search-input', placeholder: '在文件夹中搜索', spellcheck: 'false' })
    if (this.searchInput) input.value = this.searchInput.value
    this.searchInput = input
    const results = h('div', { class: 'tz-search-results' })
    const run = async () => {
      if (!this.root) {
        results.replaceChildren(h('div', { class: 'tz-side-empty' }, '先打开一个文件夹'))
        return
      }
      const q = input.value.trim()
      if (!q) {
        results.replaceChildren()
        return
      }
      results.replaceChildren(h('div', { class: 'tz-side-empty' }, '搜索中…'))
      try {
        this.searchResults = await this.host.search(this.root, q, { regex: false, caseSensitive: false, wholeWord: false, limit: 200 })
      } catch (err) {
        results.replaceChildren(h('div', { class: 'tz-tree-error' }, err instanceof Error ? err.message : String(err)))
        return
      }
      results.replaceChildren(...this.searchResults.map((hit) => this.renderHit(hit, q)))
      if (this.searchResults.length === 0) results.append(h('div', { class: 'tz-side-empty' }, '没有找到'))
    }
    let timer = 0
    input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => void run(), 250)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run()
    })
    if (input.value) void run()
    return h('div', { class: 'tz-search' }, input, results)
  }

  private renderHit(hit: SearchHit, q: string): HTMLElement {
    const rel = this.root && hit.path.startsWith(`${this.root}/`) ? hit.path.slice(this.root.length + 1) : hit.path
    const lines = hit.matches.slice(0, 5).map((m) => {
      const i = m.text.toLowerCase().indexOf(q.toLowerCase())
      const line = h('div', { class: 'tz-hit-line' })
      if (i >= 0) line.append(m.text.slice(0, i), h('mark', null, m.text.slice(i, i + q.length)), m.text.slice(i + q.length))
      else line.textContent = m.text
      return line
    })
    const box = h('div', { class: 'tz-hit', 'data-path': hit.path }, h('div', { class: 'tz-hit-file' }, rel, h('span', { class: 'tz-hit-count' }, String(hit.matches.length))), ...lines)
    box.addEventListener('click', (ev) => this.cb.openFile(hit.path, ev.metaKey))
    return box
  }
}
