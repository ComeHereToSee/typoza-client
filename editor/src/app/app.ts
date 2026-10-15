// 应用主控:一个窗口 = 一个文档(可带一个根文件夹)。负责文档读写、侧栏、各类面板、应用级命令与宿主事件。
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { collectHeadings, type HeadingItem } from '../core/blocks'
import { createEditorState, createEditorView, sliceToMarkdown } from '../core/editor'
import { type DocumentRef, type EditorEnv, DEFAULT_EDITOR_SETTINGS, type ImportFile } from '../core/env'
import { detectEmbed } from '../core/embed'
import { scrollToAnchor } from '../core/links'
import { parseMarkdown } from '../core/markdown/parse'
import { basename, dirname, joinPath, markdownHref, relativePath, resolveLocalPath } from '../core/paths'
import { registerCommand, runCommand } from '../core/registry'
import { schema } from '../core/schema'
import { setViewModes } from '../plugins/basics'
import type { ExportFormat, Host } from '../host/types'
import { h } from '../ui/dom'
import { closeLightbox, isLightboxOpen } from '../ui/lightbox'
import { promptInput, validateUrl } from '../ui/prompt'
import { resetMacros } from '../views/katex'
import { importFile } from './assets'
import { DocumentSession, frontMatterInfo, updateFrontMatterText } from './document'
import { buildExportHtml } from './exporter'
import { countWords, showHistory, showSettings, showWordCount } from './panels'
import { SyncController } from './sync'
import { showQuickOpen } from './quickopen'
import { type AppSettings, loadSettings } from './settings'
import { Sidebar, type SidebarTab } from './sidebar'
import { SourceEditor } from './source'

export interface AppOptions {
  host: Host
  mount: HTMLElement
  /** 启动时打开的文件或文件夹 */
  openPath: string | null
  openIsDir: boolean
  dark: boolean
}

const AUTOSAVE_DELAY = 1000

export class App {
  readonly host: Host
  settings!: AppSettings
  readonly session: DocumentSession
  readonly env: EditorEnv
  readonly sync: SyncController
  view!: EditorView
  private source: SourceEditor | null = null
  private sidebar!: Sidebar
  private readonly els: Record<'app' | 'main' | 'scroll' | 'page' | 'header' | 'editor' | 'status' | 'toast', HTMLElement>
  private autosaveTimer = 0
  private statusTimer = 0
  private systemDark: boolean
  private navBack: { path: string; pos: number }[] = []
  private navForward: { path: string; pos: number }[] = []
  private recent: string[] = []

  constructor(private readonly options: AppOptions) {
    this.host = options.host
    this.systemDark = options.dark
    this.session = new DocumentSession(this.host, () => this.settings)
    this.sync = new SyncController(this.host, {
      toast: (message, error) => this.toast(message, error),
      renderStatus: () => this.renderStatus(),
      openSyncPreferences: () => this.runAppCommand('app.syncPreferences'),
    })
    this.env = {
      host: this.host,
      ctx: { path: null, rootUrl: null },
      settings: { ...DEFAULT_EDITOR_SETTINGS },
      actions: {
        insertLocalMedia: (view, kind) => this.insertLocalMedia(view, kind),
        insertFromUrl: (view, kind) => void this.insertFromUrl(view, kind),
        insertDocLink: (view) => void this.insertDocLink(view),
        listDocuments: () => this.listDocuments(),
        newDocument: () => void this.runAppCommand('file.newWindow'),
        importFiles: (view, files, at) => this.importFiles(view, files, at),
      },
      openDocumentLink: (target, newWindow) => void this.openLink(target, newWindow),
    }
    const header = h('div', { class: 'tz-page-header' })
    const editor = h('div', { class: 'tz-editor-host' })
    const page = h('div', { class: 'tz-page', id: 'write-wrapper' }, header, editor)
    const scroll = h('div', { class: 'tz-scroll' }, page)
    const status = h('footer', { class: 'tz-statusbar' })
    const main = h('main', { class: 'tz-main' }, scroll, status)
    const toast = h('div', { class: 'tz-toast', hidden: true, role: 'status' })
    const app = h('div', { class: 'tz-app' }, main, toast)
    this.els = { app, main, scroll, page, header, editor, status, toast }
  }

  async init(): Promise<void> {
    this.settings = await loadSettings(this.host)
    this.syncEditorSettings()
    this.sidebar = new Sidebar(this.host, {
      openFile: (path, newWindow) => void this.openFile(path, { newWindow }),
      jumpToHeading: (item) => this.jumpToHeading(item),
      currentPath: () => this.session.path,
      onTabChange: (tab) => void this.updateSettings({ sidebarTab: tab, sidebarVisible: true }),
      onError: (msg) => this.toast(msg, true),
    })
    this.els.app.prepend(this.sidebar.el, this.resizer())
    this.options.mount.replaceChildren(this.els.app)
    this.applyAppearance()
    this.extraSettingsSections.push(this.sync.settingsSection())
    this.registerCommands()
    this.bindHostEvents()
    this.sync.bind()
    this.bindBrowserKeys()

    const doc = this.session.createEmpty()
    this.view = createEditorView(this.els.editor, createEditorState(doc, this.env), this.env, {
      onDocChange: () => this.onDocChange(),
      onUpdate: (v) => this.onEditorUpdate(v),
    })
    this.applyViewModes()
    this.sidebar.setTab(this.settings.sidebarTab)

    if (this.options.openPath) {
      if (this.options.openIsDir) this.sidebar.setRoot(this.options.openPath)
      else await this.openFile(this.options.openPath, { replace: true })
    }
    this.updateWindowState()
    this.renderStatus()
    this.view.focus()
  }

  // ---------- 设置与外观 ----------

  private syncEditorSettings(): void {
    const s = this.settings
    Object.assign(this.env.settings, {
      inlineMath: s.inlineMath,
      smartPunctuation: s.smartPunctuation,
      autoPair: s.autoPair,
      codeLineNumbers: s.codeLineNumbers,
      codeLineWrap: s.codeLineWrap,
      spellcheck: s.spellcheck,
      keybindings: s.keybindings,
    })
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const rebuild = ['smartPunctuation', 'keybindings', 'inlineMath', 'codeLineNumbers', 'codeLineWrap'].some((k) => k in patch)
    Object.assign(this.settings, patch)
    this.syncEditorSettings()
    await this.host.setSettings(patch as Record<string, unknown>)
    this.applyAppearance()
    this.applyViewModes()
    // 输入规则、快捷键、代码块配置是建编辑器时定的,改了要重建状态(保留文档与选区)
    if (rebuild && this.view) {
      const { doc, selection } = this.view.state
      const state = createEditorState(doc, this.env)
      this.view.updateState(state.apply(state.tr.setSelection(TextSelection.create(state.doc, Math.min(selection.from, doc.content.size)))))
    }
    this.renderStatus()
  }

  private isDark(): boolean {
    return this.settings.appearance === 'dark' || (this.settings.appearance === 'system' && this.systemDark) || this.settings.theme === 'night'
  }

  private applyAppearance(): void {
    const s = this.settings
    const root = document.documentElement
    root.classList.toggle('tz-dark', this.isDark())
    root.dataset.theme = s.theme
    root.dataset.font = s.fontFamily
    root.dataset.width = s.pageWidth
    root.style.setProperty('--tz-font-size', `${s.fontSize}px`)
    root.style.setProperty('--tz-zoom', String(s.zoom))
    this.els.status.hidden = !s.showStatusBar
    this.sidebar?.el.toggleAttribute('hidden', !s.sidebarVisible)
    this.els.app.style.setProperty('--tz-sidebar-width', `${s.sidebarWidth}px`)
  }

  private applyViewModes(): void {
    if (!this.view) return
    setViewModes(this.view, { focus: this.settings.focusMode, typewriter: this.settings.typewriterMode })
  }

  private resizer(): HTMLElement {
    const el = h('div', { class: 'tz-side-resizer', title: '拖动调整侧栏宽度' })
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const start = this.settings.sidebarWidth
      const move = (ev: PointerEvent) => this.els.app.style.setProperty('--tz-sidebar-width', `${Math.min(520, Math.max(180, start + ev.clientX - startX))}px`)
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        void this.updateSettings({ sidebarWidth: Math.min(520, Math.max(180, start + ev.clientX - startX)) })
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    })
    return el
  }

  // ---------- 文档 ----------

  private setDocument(doc: PMNode): void {
    resetMacros()
    const fm = frontMatterInfo(doc, this.session.path)
    this.env.ctx.path = this.session.path
    this.env.ctx.rootUrl = fm.rootUrl
    this.view.updateState(createEditorState(doc, this.env))
    this.applyViewModes()
    this.renderHeader()
    this.els.scroll.scrollTop = 0
    if (this.session.path) {
      void this.host.watch([this.session.path])
      this.recent = [this.session.path, ...this.recent.filter((p) => p !== this.session.path)].slice(0, 20)
    }
    this.sidebar.markCurrent()
    this.updateWindowState()
    this.onEditorUpdate(this.view)
  }

  async openFile(path: string, opts: { newWindow?: boolean; replace?: boolean; encoding?: string } = {}): Promise<void> {
    if (opts.newWindow) {
      await this.host.openDocument(path, { newWindow: true })
      return
    }
    if (!(await this.confirmLeave())) return
    if (this.session.path && !opts.replace) this.navBack.push({ path: this.session.path, pos: this.view.state.selection.from })
    this.navForward = []
    try {
      if (this.source) this.toggleSourceMode(false)
      const doc = await this.session.load(path, opts.encoding)
      this.setDocument(doc)
      if (!this.sidebar.rootFolder) this.sidebar.setRoot(dirname(path))
    } catch (err) {
      this.toast(`无法打开 ${basename(path)}:${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  /** 离开当前文档前(切换文档、关窗口、退出):有未保存修改时自动保存或询问。返回 false 表示用户取消。 */
  async confirmLeave(): Promise<boolean> {
    if (!this.session.dirty) return true
    if (this.session.path && this.settings.autoSave) {
      await this.save()
      return true
    }
    const choice = await this.host.confirm({
      title: `要保存对「${this.session.title}」的修改吗?`,
      message: '不保存的话,修改会丢失。',
      buttons: ['保存', '不保存', '取消'],
      style: 'warning',
    })
    if (choice === 2) return false
    if (choice === 0) return this.save()
    return true
  }

  private onDocChange(): void {
    this.session.dirty = true
    this.updateWindowState()
    this.renderHeader()
    clearTimeout(this.autosaveTimer)
    if (this.settings.autoSave && this.session.path) {
      this.autosaveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY)
    }
  }

  private currentDoc(): PMNode {
    if (!this.source) return this.view.state.doc
    // 源码模式下以源码为准
    const parsed = parseMarkdown(this.source.text, { inlineMath: this.settings.inlineMath })
    this.session.meta = parsed.meta
    return parsed.doc
  }

  async save(): Promise<boolean> {
    clearTimeout(this.autosaveTimer)
    if (!this.session.path) return this.saveAs()
    try {
      await this.session.save(this.currentDoc())
      this.updateWindowState()
      return true
    } catch (err) {
      this.toast(`保存失败:${err instanceof Error ? err.message : String(err)}`, true)
      return false
    }
  }

  async saveAs(): Promise<boolean> {
    const defaultName = this.session.path ? basename(this.session.path) : `${this.firstHeadingText() || '未命名'}.md`
    const target = await this.host.saveDialog({ defaultName, extensions: ['md', 'markdown', 'txt'] })
    if (!target) return false
    try {
      await this.session.save(this.currentDoc(), target)
      this.env.ctx.path = target
      if (!this.sidebar.rootFolder) this.sidebar.setRoot(dirname(target))
      this.sidebar.refresh()
      this.updateWindowState()
      return true
    } catch (err) {
      this.toast(`保存失败:${err instanceof Error ? err.message : String(err)}`, true)
      return false
    }
  }

  private firstHeadingText(): string {
    return collectHeadings(this.view.state.doc)[0]?.text.replace(/[/:]/g, '-').slice(0, 60) ?? ''
  }

  /** 外部修改:没有未保存修改就静默重载;有则询问。 */
  private async onExternalChange(): Promise<void> {
    const path = this.session.path
    if (!path) return
    const stat = await this.host.stat(path)
    if (!stat) {
      this.toast('文件已被移动或删除;再次保存会在原位置重新创建', true)
      return
    }
    if (stat.mtime === this.session.savedMtime) return
    const { text } = await this.host.readText(path, this.session.encoding)
    if (text === this.session.savedText) {
      this.session.savedMtime = stat.mtime
      return
    }
    if (this.session.dirty) {
      const choice = await this.host.confirm({
        title: '文件已在磁盘上被修改',
        message: `「${basename(path)}」被其它程序修改了。要载入磁盘上的版本吗?`,
        buttons: ['载入磁盘版本', '保留我的修改'],
        style: 'warning',
      })
      if (choice !== 0) {
        this.session.savedMtime = stat.mtime
        return
      }
    }
    const pos = this.view.state.selection.from
    const scroll = this.els.scroll.scrollTop
    const doc = await this.session.load(path, this.session.encoding)
    this.setDocument(doc)
    this.els.scroll.scrollTop = scroll
    const clamped = Math.min(pos, this.view.state.doc.content.size)
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(clamped))))
  }

  private updateWindowState(): void {
    this.host.setWindowState({ path: this.session.path, title: this.session.title, edited: this.session.dirty })
  }

  // ---------- 页面头部:Notion 的图标与封面(存 front matter) ----------

  private renderHeader(): void {
    const fm = frontMatterInfo(this.view.state.doc, this.session.path)
    const header = this.els.header
    header.replaceChildren()
    if (fm.cover) {
      const url = this.coverUrl(fm.cover)
      const cover = h('div', { class: 'tz-cover' })
      if (url.startsWith('linear-gradient')) cover.style.background = url
      else cover.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
      const change = h('button', { type: 'button', class: 'tz-cover-btn' }, '移除封面')
      change.addEventListener('click', () => this.setFrontMatter('cover', null))
      cover.append(change)
      header.append(cover)
    }
    if (fm.icon) {
      const icon = h('button', { type: 'button', class: 'tz-page-icon', title: '更换图标' }, fm.icon)
      icon.addEventListener('click', () => void this.pickIcon())
      header.append(icon)
    }
    const actions = h('div', { class: 'tz-page-actions' })
    if (!fm.icon) {
      const b = h('button', { type: 'button' }, '☺ 添加图标')
      b.addEventListener('click', () => void this.pickIcon())
      actions.append(b)
    }
    if (!fm.cover) {
      const b = h('button', { type: 'button' }, '▧ 添加封面')
      b.addEventListener('click', () => void this.pickCover())
      actions.append(b)
    }
    header.append(actions)
    header.classList.toggle('has-cover', Boolean(fm.cover))
    header.classList.toggle('has-icon', Boolean(fm.icon))
  }

  private coverUrl(cover: string): string {
    if (cover.startsWith('linear-gradient')) return cover
    const local = resolveLocalPath(cover, this.env.ctx)
    return local ? this.host.resourceURL(local) : cover
  }

  private async pickIcon(): Promise<void> {
    const value = await promptInput({ title: '页面图标', placeholder: '输入或粘贴一个表情,如 📘(留空移除)', value: frontMatterInfo(this.view.state.doc, this.session.path).icon ?? '' })
    if (value === null) return
    this.setFrontMatter('icon', value || null)
  }

  private async pickCover(): Promise<void> {
    const paths = await this.host.openDialog({ extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] })
    if (!paths?.[0]) {
      this.setFrontMatter('cover', 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)')
      return
    }
    const imported = await importFile(this.importContext(), { name: basename(paths[0]), path: paths[0] })
    this.setFrontMatter('cover', imported.src)
  }

  private setFrontMatter(key: string, value: string | null): void {
    const { state } = this.view
    const first = state.doc.firstChild
    const tr = state.tr
    if (first?.type === schema.nodes.frontmatter) {
      const text = updateFrontMatterText(first.textContent, key, value)
      const content = text ? schema.text(text) : null
      tr.replaceWith(0, first.nodeSize, schema.nodes.frontmatter.create(null, content))
    } else if (value !== null) {
      tr.insert(0, schema.nodes.frontmatter.create(null, schema.text(updateFrontMatterText('', key, value))))
    }
    if (tr.docChanged) this.view.dispatch(tr)
  }

  // ---------- 编辑器更新:大纲、状态栏 ----------

  private onEditorUpdate(view: EditorView): void {
    clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => {
      const headings = collectHeadings(view.state.doc)
      const pos = view.state.selection.from
      let active = -1
      headings.forEach((x, i) => {
        if (x.pos <= pos) active = i
      })
      this.sidebar.setHeadings(headings, active)
      this.renderStatus()
    }, 120)
  }

  private jumpToHeading(item: HeadingItem): void {
    if (this.source) this.toggleSourceMode(false)
    const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, item.pos + 1))
    this.view.dispatch(tr)
    const dom = this.view.nodeDOM(item.pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
    this.view.focus()
  }

  private renderStatus(): void {
    if (!this.view || !this.settings.showStatusBar) return
    const text = this.source ? this.source.text : this.view.state.doc.textBetween(0, this.view.state.doc.content.size, '\n\n', ' ')
    const stats = countWords(text)
    const { from, to, empty } = this.view.state.selection
    const sel = !empty && !this.source ? countWords(this.view.state.doc.textBetween(from, to, '\n\n', ' ')) : null
    const words = h('button', { type: 'button', class: 'tz-status-btn', title: '字数统计' }, sel ? `已选 ${sel.words} 字 / 共 ${stats.words} 字` : `${stats.words} 字`)
    words.addEventListener('click', () => runCommand(this.view, 'view.wordCount'))
    const sidebarBtn = h('button', { type: 'button', class: 'tz-status-btn', title: '显示 / 隐藏侧栏(⌃⌘S)' }, '☰')
    sidebarBtn.addEventListener('click', () => this.runAppCommand('view.toggleSidebar'))
    const sourceBtn = h('button', { type: 'button', class: `tz-status-btn${this.source ? ' is-on' : ''}`, title: '源代码模式(⌃⌘/)' }, '</>')
    sourceBtn.addEventListener('click', () => this.runAppCommand('view.sourceMode'))
    const state = h('span', { class: 'tz-status-text' }, this.session.dirty ? (this.settings.autoSave && this.session.path ? '正在保存…' : '未保存') : this.session.path ? '已保存' : '')
    this.els.status.replaceChildren(sidebarBtn, sourceBtn, h('span', { class: 'tz-status-spacer' }), this.sync.statusButton() ?? '', state, words)
  }

  // ---------- 源码模式 ----------

  toggleSourceMode(on = !this.source): void {
    if (on && !this.source) {
      const text = this.session.serialize(this.view.state.doc)
      this.els.editor.hidden = true
      this.els.header.hidden = true
      const mount = h('div', { class: 'tz-source-host' })
      this.els.page.append(mount)
      this.source = new SourceEditor(mount, text, () => this.onDocChange(), this.settings.codeLineNumbers)
      this.source.focus()
    } else if (!on && this.source) {
      const doc = this.currentDoc()
      this.source.destroy()
      this.els.page.querySelector('.tz-source-host')?.remove()
      this.source = null
      this.els.editor.hidden = false
      this.els.header.hidden = false
      this.view.updateState(createEditorState(doc, this.env))
      this.renderHeader()
      this.view.focus()
    }
    this.renderStatus()
  }

  // ---------- 资源插入(EditorActions) ----------

  private importContext() {
    return {
      host: this.host,
      settings: this.settings,
      docPath: this.session.path,
      copyImagesTo: frontMatterInfo(this.view.state.doc, this.session.path).copyImagesTo,
    }
  }

  async importFiles(view: EditorView, files: ImportFile[], at?: number): Promise<void> {
    try {
      const nodes: PMNode[] = []
      for (const f of files) {
        const r = await importFile(this.importContext(), f)
        if (r.kind === 'image') nodes.push(schema.nodes.image.create({ src: r.src, alt: r.name.replace(/\.[^.]+$/, '') }))
        else nodes.push(schema.nodes.media.create({ kind: r.kind, src: r.src, title: r.kind === 'file' ? r.name : '' }))
      }
      const { state } = view
      const pos = at ?? state.selection.from
      const tr = state.tr
      const inline = nodes.every((n) => n.isInline)
      if (inline) {
        tr.insert(pos, nodes)
      } else {
        const $pos = state.doc.resolve(pos)
        const after = $pos.depth > 0 ? $pos.after(1) : pos
        tr.insert(after, nodes.map((n) => (n.isInline ? schema.nodes.paragraph.create(null, n) : n)))
      }
      view.dispatch(tr.scrollIntoView())
    } catch (err) {
      this.toast(`插入失败:${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  private async insertLocalMedia(view: EditorView, kind: 'image' | 'video' | 'audio' | 'pdf' | 'file'): Promise<void> {
    const ext: Record<string, string[]> = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'],
      video: ['mp4', 'mov', 'm4v', 'webm'],
      audio: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'],
      pdf: ['pdf'],
      file: [],
    }
    const paths = await this.host.openDialog({ multiple: true, extensions: ext[kind].length ? ext[kind] : undefined })
    if (!paths?.length) return
    await this.importFiles(view, paths.map((p) => ({ name: basename(p), path: p })))
  }

  private async insertFromUrl(view: EditorView, kind: 'image' | 'embed' | 'bookmark' | 'video' | 'audio'): Promise<void> {
    const titles = { image: '图片网址', embed: '要嵌入的网址(YouTube、哔哩哔哩、Figma……)', bookmark: '网页地址', video: '视频网址', audio: '音频网址' }
    const coords = view.coordsAtPos(view.state.selection.from)
    const url = await promptInput({ title: titles[kind], placeholder: 'https://', anchor: coords, validate: validateUrl })
    view.focus()
    if (!url) return
    const { state } = view
    const n = schema.nodes
    let node: PMNode
    if (kind === 'image') node = n.paragraph.create(null, n.image.create({ src: url }))
    else if (kind === 'embed') {
      const target = detectEmbed(url)
      node = n.media.create({ kind: target?.kind === 'embed' ? 'embed' : target && target.kind !== 'image' ? target.kind : 'embed', src: target?.src ?? url })
    } else node = n.media.create({ kind, src: url })
    const $from = state.selection.$from
    const para = $from.parent
    const tr = state.tr
    if (para.type === n.paragraph && para.content.size === 0) tr.replaceWith($from.before(), $from.after(), node)
    else tr.insert($from.after(1), node)
    view.dispatch(tr.scrollIntoView())
  }

  /** [[ / 「链接到文档」:选当前文件夹里的文档,插入相对链接 [标题](相对路径.md)。 */
  /** 指向 path 的相对链接(相对当前文档所在文件夹)。 */
  private docHref(path: string, root: string): string {
    return markdownHref(relativePath(this.session.path ? dirname(this.session.path) : root, path))
  }

  /** @ 提及的候选文档:根文件夹(或当前文档所在文件夹)下的 Markdown,最近打开的排前面。 */
  private async listDocuments(): Promise<DocumentRef[]> {
    const root = this.sidebar.rootFolder ?? (this.session.path ? dirname(this.session.path) : null)
    if (!root) return []
    const files = (await this.host.listMarkdown(root)).filter((p) => p !== this.session.path)
    const recent = new Map(this.recent.map((p, i) => [p, i]))
    files.sort((a, b) => (recent.get(a) ?? Infinity) - (recent.get(b) ?? Infinity))
    return files.map((path) => ({
      path,
      title: basename(path).replace(/\.(md|markdown)$/i, ''),
      dir: relativePath(root, dirname(path)) || '.',
      href: this.docHref(path, root),
    }))
  }

  private async insertDocLink(view: EditorView): Promise<void> {
    const root = this.sidebar.rootFolder ?? (this.session.path ? dirname(this.session.path) : null)
    if (!root) {
      this.toast('先保存文档或打开文件夹,才能链接到其它文档', true)
      return
    }
    const files = (await this.host.listMarkdown(root)).filter((p) => p !== this.session.path)
    showQuickOpen({
      root,
      files,
      recent: this.recent.filter((p) => p !== this.session.path),
      open: (path) => {
        const href = this.docHref(path, root)
        const title = basename(path).replace(/\.(md|markdown)$/i, '')
        const { from, to } = view.state.selection
        const tr = view.state.tr.insertText(title, from, to)
        tr.addMark(from, from + title.length, schema.marks.link.create({ href }))
        view.dispatch(tr)
        view.focus()
      },
    })
  }

  /** 打开文档内链接:相对路径相对当前文档;wikilink 按文件名在根文件夹里找。 */
  private async openLink(target: string, newWindow: boolean): Promise<void> {
    const [pathPart, anchor] = target.split('#')
    let path: string | null = null
    if (/\.(md|markdown|mdown|mkd|txt)$/i.test(pathPart)) {
      path = resolveLocalPath(pathPart, this.env.ctx)
    } else {
      // wikilink:[[笔记]] → 根文件夹下名为「笔记.md」的文件
      const root = this.sidebar.rootFolder ?? (this.session.path ? dirname(this.session.path) : null)
      if (root) {
        const all = await this.host.listMarkdown(root)
        path = all.find((p) => basename(p).replace(/\.(md|markdown)$/i, '') === pathPart) ?? null
      }
    }
    if (!path) {
      this.toast(`找不到文档:${pathPart}`, true)
      return
    }
    if (!(await this.host.stat(path))) {
      this.toast(`文档不存在:${path}`, true)
      return
    }
    await this.openFile(path, { newWindow })
    if (anchor && !newWindow) scrollToAnchor(this.view, anchor)
  }

  // ---------- 导出 ----------

  private async exportAs(format: ExportFormat): Promise<void> {
    const extMap: Record<ExportFormat, string> = {
      pdf: 'pdf',
      html: 'html',
      'html-plain': 'html',
      image: 'png',
      docx: 'docx',
      odt: 'odt',
      rtf: 'rtf',
      epub: 'epub',
      latex: 'tex',
      mediawiki: 'wiki',
      rst: 'rst',
      textile: 'textile',
      opml: 'opml',
    }
    const stem = this.session.path ? basename(this.session.path).replace(/\.[^.]+$/, '') : this.firstHeadingText() || '未命名'
    const target = await this.host.saveDialog({ defaultName: `${stem}.${extMap[format]}`, extensions: [extMap[format]] })
    if (!target) return
    if (this.source) this.toggleSourceMode(false)
    const html = buildExportHtml(this.view.dom, stem, target, format !== 'html-plain', this.isDark())
    const markdown = this.session.serialize(this.view.state.doc)
    try {
      await this.host.exportDocument({ format, html, markdown, sourcePath: this.session.path, target })
      this.toast(`已导出:${basename(target)}`)
    } catch (err) {
      this.toast(`导出失败:${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  // ---------- 命令 ----------

  private runAppCommand(id: string): void {
    runCommand(this.view, id)
  }

  private registerCommands(): void {
    const cmd = (id: string, label: string, run: () => void) => registerCommand({ id, label, run: () => (run(), true) })
    cmd('file.save', '保存', () => void this.save())
    cmd('file.saveAs', '另存为…', () => void this.saveAs())
    cmd('file.newWindow', '新建', () => void this.host.openDocument('', { newWindow: true }))
    cmd('file.newDocument', '新建文档', () => void this.host.openDocument('', { newWindow: true }))
    cmd('file.open', '打开…', () => {
      void this.host.openDialog({ extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }).then((p) => {
        if (p?.[0]) void this.openFile(p[0])
      })
    })
    cmd('file.openFolder', '打开文件夹…', () => {
      void this.host.openDialog({ directory: true }).then((p) => {
        if (p?.[0]) {
          this.sidebar.setRoot(p[0])
          void this.updateSettings({ sidebarVisible: true })
        }
      })
    })
    cmd('file.quickOpen', '快速打开…', () => {
      const root = this.sidebar.rootFolder
      void (root ? this.host.listMarkdown(root) : Promise.resolve([])).then((files) =>
        showQuickOpen({ root, files, recent: this.recent, open: (p, nw) => void this.openFile(p, { newWindow: nw }) }),
      )
    })
    cmd('file.revealInFinder', '在 Finder 中显示', () => {
      if (this.session.path) void this.host.revealInFinder(this.session.path)
    })
    cmd('file.copyPath', '复制当前文档路径', () => {
      if (this.session.path) {
        void navigator.clipboard.writeText(this.session.path)
        this.toast('已复制文档路径')
      }
    })
    cmd('file.history', '浏览所有版本…', () => {
      const path = this.session.path
      if (!path) return
      // 本机快照 + 云端版本(文件在同步文件夹里时);恢复都是把内容放回编辑器,保存后作为新版本同步
      void Promise.all([this.host.historyList(path), this.sync.cloudVersions(path)]).then(([entries, cloud]) =>
        showHistory(
          this.host,
          path,
          entries,
          (text) => {
            const { doc, meta } = parseMarkdown(text, { inlineMath: this.settings.inlineMath })
            this.session.meta = meta
            this.view.updateState(createEditorState(doc, this.env))
            this.onDocChange()
          },
          cloud.map((v) => ({
            label: new Date(v.mtime).toLocaleString('zh-CN', { hour12: false }),
            meta: `云端 · 第 ${v.version} 版 · ${v.thisDevice ? '本机' : '其他设备'} · ${(v.size / 1024).toFixed(1)} KB`,
            load: () => this.sync.readVersion(path, v.version),
          })),
        ),
      )
    })
    cmd('file.reload', '从磁盘重新载入', () => {
      if (this.session.path) void this.session.load(this.session.path, this.session.encoding).then((doc) => this.setDocument(doc))
    })
    cmd('file.reopenWithEncoding', '以其它编码重新打开…', () => {
      const path = this.session.path
      if (!path) return
      void promptInput({ title: '编码', placeholder: 'utf-8 / gb18030 / big5 / shift_jis / utf-16le', value: this.session.encoding }).then((enc) => {
        if (enc) void this.openFile(path, { replace: true, encoding: enc })
      })
    })
    cmd('file.print', '打印…', () => void this.host.print())
    for (const f of ['pdf', 'html', 'html-plain', 'image', 'docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'rst', 'textile', 'opml'] as ExportFormat[]) {
      cmd(`file.export.${f}`, `导出 ${f}`, () => void this.exportAs(f))
    }
    cmd('nav.back', '后退', () => {
      const prev = this.navBack.pop()
      if (!prev || !this.session.path) return
      this.navForward.push({ path: this.session.path, pos: this.view.state.selection.from })
      void this.openFile(prev.path, { replace: true })
    })
    cmd('nav.forward', '前进', () => {
      const next = this.navForward.pop()
      if (!next || !this.session.path) return
      this.navBack.push({ path: this.session.path, pos: this.view.state.selection.from })
      void this.openFile(next.path, { replace: true })
    })
    cmd('view.toggleSidebar', '显示 / 隐藏侧栏', () => void this.updateSettings({ sidebarVisible: !this.settings.sidebarVisible }))
    for (const [id, tab] of [
      ['view.outline', 'outline'],
      ['view.docList', 'list'],
      ['view.fileTree', 'files'],
      ['view.search', 'search'],
    ] as [string, SidebarTab][]) {
      cmd(id, tab, () => {
        void this.updateSettings({ sidebarVisible: true })
        this.sidebar.setTab(tab)
      })
    }
    cmd('view.sourceMode', '源代码模式', () => this.toggleSourceMode())
    cmd('view.focusMode', '专注模式', () => void this.updateSettings({ focusMode: !this.settings.focusMode }))
    cmd('view.typewriterMode', '打字机模式', () => void this.updateSettings({ typewriterMode: !this.settings.typewriterMode }))
    cmd('view.statusBar', '显示状态栏', () => void this.updateSettings({ showStatusBar: !this.settings.showStatusBar }))
    cmd('view.zoomIn', '放大', () => void this.updateSettings({ zoom: Math.min(2.5, Math.round((this.settings.zoom + 0.1) * 10) / 10) }))
    cmd('view.zoomOut', '缩小', () => void this.updateSettings({ zoom: Math.max(0.5, Math.round((this.settings.zoom - 0.1) * 10) / 10) }))
    cmd('view.zoomReset', '实际大小', () => void this.updateSettings({ zoom: 1 }))
    cmd('view.toggleDark', '切换浅色 / 深色', () => void this.updateSettings({ appearance: this.isDark() ? 'light' : 'dark' }))
    cmd('view.wordCount', '字数统计', () => {
      const doc = this.view.state.doc
      const { from, to, empty } = this.view.state.selection
      showWordCount(countWords(doc.textBetween(0, doc.content.size, '\n\n', ' ')), empty ? null : countWords(doc.textBetween(from, to, '\n\n', ' ')))
    })
    cmd('view.pageWidth', '页面宽度', () => {
      const order: AppSettings['pageWidth'][] = ['normal', 'wide', 'full']
      void this.updateSettings({ pageWidth: order[(order.indexOf(this.settings.pageWidth) + 1) % order.length] })
    })
    for (const theme of ['typoza', 'github', 'newsprint', 'night', 'whitey']) cmd(`theme.${theme}`, theme, () => void this.updateSettings({ theme }))
    cmd('app.preferences', '偏好设置…', () => showSettings(this.settings, (patch) => void this.updateSettings(patch), this.extraSettingsSections))
    cmd('app.syncPreferences', '云同步…', () => showSettings(this.settings, (patch) => void this.updateSettings(patch), this.extraSettingsSections, '云同步'))
    cmd('edit.copyMarkdown', '复制为 Markdown', () => {
      const { from, to } = this.view.state.selection
      void navigator.clipboard.writeText(sliceToMarkdown(this.view.state.doc.slice(from, to).content, this.env))
    })
    cmd('edit.copyPlain', '复制为纯文本', () => {
      const { from, to } = this.view.state.selection
      void navigator.clipboard.writeText(this.view.state.doc.textBetween(from, to, '\n\n', ' '))
    })
    cmd('edit.copyHtml', '复制为 HTML 代码', () => {
      const { dom } = this.view.serializeForClipboard(this.view.state.selection.content())
      void navigator.clipboard.writeText(dom.innerHTML)
    })
    cmd('block.toDocument', '转为新文档', () => void this.blockToDocument())
    cmd('insert.image', '插入图片…', () => void this.insertLocalMedia(this.view, 'image'))
  }

  /** 其它模块(如云同步)往偏好设置里加的页签。 */
  extraSettingsSections: { title: string; render: () => HTMLElement }[] = []

  /** ⌥⌘9:把当前块转成新文档——以块文字为文件名在当前文件夹新建,原处换成指向它的链接。 */
  private async blockToDocument(): Promise<void> {
    const dir = this.session.path ? dirname(this.session.path) : this.sidebar.rootFolder
    if (!dir) {
      this.toast('先保存当前文档,才能在同一文件夹里新建', true)
      return
    }
    const { $from } = this.view.state.selection
    const block = $from.parent
    const title = (block.textContent.trim() || '未命名').replace(/[/:]/g, '-').slice(0, 80)
    let path = joinPath(dir, `${title}.md`)
    for (let i = 1; await this.host.stat(path); i++) path = joinPath(dir, `${title}-${i}.md`)
    await this.host.writeText(path, `# ${title}\n`)
    const href = markdownHref(relativePath(dir, path))
    const start = $from.start()
    const end = $from.end()
    const tr = this.view.state.tr.replaceWith(start, end, schema.text(title, [schema.marks.link.create({ href })]))
    this.view.dispatch(tr)
    this.sidebar.refresh()
    this.toast(`已新建「${basename(path)}」`)
  }

  private bindHostEvents(): void {
    this.host.on('menu.command', ({ id }) => {
      if (isLightboxOpen() && id !== 'app.preferences') closeLightbox()
      try {
        runCommand(this.view, id)
      } catch (err) {
        this.toast(err instanceof Error ? err.message : String(err), true)
      }
    })
    this.host.on('app.open', ({ path, isDir }) => {
      if (isDir) this.sidebar.setRoot(path)
      else void this.openFile(path)
    })
    this.host.on('fs.changed', ({ paths }) => {
      if (this.session.path && paths.some((p) => p === this.session.path)) void this.onExternalChange()
      this.sidebar.refresh()
    })
    this.host.on('app.appearance', ({ dark }) => {
      this.systemDark = dark
      this.applyAppearance()
    })
    this.host.on('window.willClose', () => {
      void this.confirmLeave().then((ok) => {
        if (ok) this.host.closeWindow()
      })
    })
  }

  /** 浏览器里(开发、E2E)没有原生菜单,这些应用级快捷键由网页自己处理。 */
  private bindBrowserKeys(): void {
    if (this.host.platform !== 'browser') return
    const keys: Record<string, string> = {
      'Mod-s': 'file.save',
      'Mod-Alt-Shift-s': 'file.saveAs',
      'Mod-p': 'file.quickOpen',
      'Mod-Shift-o': 'file.quickOpen',
      'Mod-o': 'file.open',
      'Mod-f': 'find.open',
      'Mod-Alt-f': 'find.replace',
      'Mod-g': 'find.next',
      'Mod-Shift-g': 'find.prev',
      'Mod-Shift-f': 'view.search',
      'Ctrl-Mod-s': 'view.toggleSidebar',
      'Ctrl-Mod-1': 'view.outline',
      'Ctrl-Mod-2': 'view.docList',
      'Ctrl-Mod-3': 'view.fileTree',
      'Ctrl-Mod-/': 'view.sourceMode',
      F8: 'view.focusMode',
      F9: 'view.typewriterMode',
      'Mod-Shift-l': 'view.toggleDark',
      'Mod-=': 'view.zoomIn',
      'Mod--': 'view.zoomOut',
      'Mod-Shift-0': 'view.zoomReset',
      'Mod-,': 'app.preferences',
      'Mod-l': 'file.copyPath',
      'Mod-[': 'nav.back',
      'Mod-]': 'nav.forward',
      'Mod-Shift-c': 'edit.copyMarkdown',
    }
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return
      const name = keyName(e)
      const id = keys[name]
      if (!id) return
      e.preventDefault()
      runCommand(this.view, id)
    })
  }

  // ---------- 提示 ----------

  toast(message: string, error = false): void {
    const t = this.els.toast
    t.textContent = message
    t.classList.toggle('is-error', error)
    t.hidden = false
    clearTimeout(Number(t.dataset.timer))
    t.dataset.timer = String(window.setTimeout(() => (t.hidden = true), error ? 6000 : 2500))
  }

  /** 供 E2E 与冒烟测试使用的当前 Markdown。 */
  markdown(): string {
    return this.session.serialize(this.currentDoc())
  }
}

/** KeyboardEvent → prosemirror-keymap 风格的键名(Mod = Cmd)。 */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.metaKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  // Alt / Shift 组合会改变 e.key,用物理键还原
  if (e.altKey || e.shiftKey) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
    else if (e.code === 'Minus') key = '-'
    else if (e.code === 'Equal') key = '='
    else if (e.code === 'Slash') key = '/'
  } else if (key.length === 1) key = key.toLowerCase()
  parts.push(key)
  return parts.join('-')
}
