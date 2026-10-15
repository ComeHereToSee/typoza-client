// 弹出面板:偏好设置、字数统计、历史版本。
import { h } from '../ui/dom'
import type { HistoryEntry, Host } from '../host/types'
import { BUILTIN_THEMES, type AppSettings } from './settings'

export function modal(title: string, body: HTMLElement, onClose?: () => void): { root: HTMLElement; close: () => void } {
  const closeBtn = h('button', { type: 'button', class: 'tz-modal-close', title: '关闭(Esc)' }, '×')
  const panel = h('div', { class: 'tz-modal-panel', role: 'dialog', 'aria-label': title }, h('div', { class: 'tz-modal-head' }, h('h2', null, title), closeBtn), body)
  const root = h('div', { class: 'tz-modal' }, panel)
  const close = () => {
    root.remove()
    window.removeEventListener('keydown', onKey, true)
    onClose?.()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  closeBtn.addEventListener('click', close)
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close()
  })
  window.addEventListener('keydown', onKey, true)
  document.body.append(root)
  return { root, close }
}

// ---------- 偏好设置 ----------

type Field =
  | { key: keyof AppSettings; label: string; type: 'bool'; hint?: string }
  | { key: keyof AppSettings; label: string; type: 'select'; options: { value: string; label: string }[]; hint?: string }
  | { key: keyof AppSettings; label: string; type: 'text' | 'number'; placeholder?: string; hint?: string }

const SECTIONS: { id: string; title: string; fields: Field[] }[] = [
  {
    id: 'general',
    title: '通用',
    fields: [
      { key: 'autoSave', label: '自动保存', type: 'bool', hint: '停止输入 1 秒后自动保存;关闭后用 ⌘S 手动保存' },
      { key: 'ensureTrailingNewline', label: '保存时在文末添加空行', type: 'bool' },
      { key: 'showStatusBar', label: '显示状态栏', type: 'bool' },
    ],
  },
  {
    id: 'appearance',
    title: '外观',
    fields: [
      { key: 'theme', label: '主题', type: 'select', options: BUILTIN_THEMES.map((t) => ({ value: t.id, label: t.label })) },
      {
        key: 'appearance',
        label: '浅色 / 深色',
        type: 'select',
        options: [
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ],
      },
      {
        key: 'fontFamily',
        label: '正文字体',
        type: 'select',
        options: [
          { value: 'default', label: '默认' },
          { value: 'serif', label: '衬线' },
          { value: 'mono', label: '等宽' },
        ],
      },
      { key: 'fontSize', label: '字号(px)', type: 'number' },
      {
        key: 'pageWidth',
        label: '页面宽度',
        type: 'select',
        options: [
          { value: 'normal', label: '标准' },
          { value: 'wide', label: '加宽' },
          { value: 'full', label: '全宽' },
        ],
      },
    ],
  },
  {
    id: 'editor',
    title: '编辑器',
    fields: [
      { key: 'smartPunctuation', label: '智能标点(-> 变 →,-- 变 —)', type: 'bool' },
      { key: 'autoPair', label: '自动配对括号与引号', type: 'bool' },
      { key: 'spellcheck', label: '拼写检查', type: 'bool' },
      { key: 'codeLineNumbers', label: '代码块显示行号', type: 'bool' },
      { key: 'codeLineWrap', label: '代码块自动换行', type: 'bool' },
    ],
  },
  {
    id: 'markdown',
    title: 'Markdown',
    fields: [{ key: 'inlineMath', label: '识别 $…$ 行内公式', type: 'bool', hint: '关闭后单个 $ 按普通文字处理' }],
  },
  {
    id: 'image',
    title: '图片',
    fields: [
      {
        key: 'imageInsertAction',
        label: '插入图片时',
        type: 'select',
        options: [
          { value: 'copyToAssets', label: '复制到资源文件夹' },
          { value: 'copyToCurrent', label: '复制到当前文件夹' },
          { value: 'copyToCustom', label: '复制到指定文件夹' },
          { value: 'upload', label: '复制后用上传命令上传' },
          { value: 'none', label: '不处理(使用原路径)' },
        ],
      },
      { key: 'imageAssetsFolder', label: '资源文件夹', type: 'text', placeholder: './assets', hint: '可用 ${filename} 代表当前文件名' },
      { key: 'imageCustomFolder', label: '指定文件夹', type: 'text', placeholder: '/Users/…/Pictures' },
      { key: 'imageUploadCommand', label: '上传命令', type: 'text', placeholder: 'picgo upload', hint: '命令接收图片路径参数,标准输出最后几行是上传后的网址' },
      { key: 'imageUseRelative', label: '优先使用相对路径', type: 'bool' },
    ],
  },
  {
    id: 'export',
    title: '导出',
    fields: [{ key: 'pandocPath', label: 'Pandoc 路径', type: 'text', placeholder: '留空自动查找 /opt/homebrew/bin/pandoc 等', hint: '导出 Word、EPUB、LaTeX 等格式需要安装 Pandoc' }],
  },
]

export function showSettings(settings: AppSettings, onChange: (patch: Partial<AppSettings>) => void, extraSections: { title: string; render: () => HTMLElement }[] = [], initialTitle?: string): void {
  const nav = h('nav', { class: 'tz-settings-nav' })
  const content = h('div', { class: 'tz-settings-content' })
  const sections = [
    ...SECTIONS.map((s) => ({ title: s.title, render: () => renderFields(s.fields, settings, onChange) })),
    ...extraSections,
  ]
  let active = 0
  const show = (i: number) => {
    active = i
    for (const [j, el] of Array.from(nav.children).entries()) el.classList.toggle('is-active', j === active)
    content.replaceChildren(sections[i].render())
  }
  sections.forEach((s, i) => {
    const b = h('button', { type: 'button', class: 'tz-settings-tab' }, s.title)
    b.addEventListener('click', () => show(i))
    nav.append(b)
  })
  modal('偏好设置', h('div', { class: 'tz-settings' }, nav, content))
  show(Math.max(0, sections.findIndex((s) => s.title === initialTitle)))
}

function renderFields(fields: Field[], settings: AppSettings, onChange: (patch: Partial<AppSettings>) => void): HTMLElement {
  const box = h('div', { class: 'tz-settings-fields' })
  for (const f of fields) {
    let control: HTMLElement
    const value = settings[f.key]
    if (f.type === 'bool') {
      const input = h('input', { type: 'checkbox' })
      input.checked = Boolean(value)
      input.addEventListener('change', () => onChange({ [f.key]: input.checked } as Partial<AppSettings>))
      control = input
    } else if (f.type === 'select') {
      const select = h('select', null, ...f.options.map((o) => h('option', { value: o.value }, o.label)))
      select.value = String(value)
      select.addEventListener('change', () => onChange({ [f.key]: select.value } as Partial<AppSettings>))
      control = select
    } else {
      const input = h('input', { type: f.type, placeholder: f.placeholder ?? '' })
      input.value = String(value ?? '')
      input.addEventListener('change', () => onChange({ [f.key]: f.type === 'number' ? Number(input.value) : input.value } as Partial<AppSettings>))
      control = input
    }
    box.append(h('label', { class: 'tz-field' }, h('span', { class: 'tz-field-label' }, f.label), control, f.hint ? h('span', { class: 'tz-field-hint' }, f.hint) : null))
  }
  return box
}

// ---------- 字数统计 ----------

export interface WordStats {
  characters: number
  charactersNoSpace: number
  words: number
  cjk: number
  lines: number
  paragraphs: number
  readingMinutes: number
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g

/** 字数:中日韩字符每字算一个词,其它按空白分词(与 Typora 的口径一致)。 */
export function countWords(text: string): WordStats {
  const cjk = (text.match(CJK) ?? []).length
  const latin = text.replace(CJK, ' ')
  const latinWords = (latin.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length
  const words = cjk + latinWords
  return {
    characters: text.length,
    charactersNoSpace: text.replace(/\s/g, '').length,
    words,
    cjk,
    lines: text ? text.split('\n').length : 0,
    paragraphs: text.split(/\n{2,}/).filter((p) => p.trim()).length,
    // 中文约 400 字 / 分钟,英文约 200 词 / 分钟
    readingMinutes: Math.max(1, Math.round(cjk / 400 + latinWords / 200)),
  }
}

export function showWordCount(stats: WordStats, selection: WordStats | null): void {
  const row = (label: string, v: number, s?: number) => h('tr', null, h('th', null, label), h('td', null, String(v)), h('td', null, s === undefined ? '' : String(s)))
  const table = h(
    'table',
    { class: 'tz-wordcount' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '全文'), h('th', null, selection ? '选中' : ''))),
    h(
      'tbody',
      null,
      row('字数', stats.words, selection?.words),
      row('字符数', stats.characters, selection?.characters),
      row('字符数(不含空白)', stats.charactersNoSpace, selection?.charactersNoSpace),
      row('中日韩字符', stats.cjk, selection?.cjk),
      row('段落', stats.paragraphs, selection?.paragraphs),
      row('行数', stats.lines, selection?.lines),
      row('阅读时间(分钟)', stats.readingMinutes, selection?.readingMinutes),
    ),
  )
  modal('字数统计', table)
}

// ---------- 历史版本 ----------

export function showHistory(host: Host, path: string, entries: HistoryEntry[], restore: (text: string) => void, extraEntries: { label: string; meta?: string; load: () => Promise<string> }[] = []): void {
  const preview = h('pre', { class: 'tz-history-preview' }, '选择左侧的版本查看内容')
  const restoreBtn = h('button', { type: 'button', class: 'tz-btn-primary', disabled: true }, '恢复这个版本')
  let current: string | null = null
  const list = h('div', { class: 'tz-history-list' })
  const select = async (el: HTMLElement, load: () => Promise<string>) => {
    for (const x of Array.from(list.children)) x.classList.remove('is-active')
    el.classList.add('is-active')
    preview.textContent = '加载中…'
    try {
      current = await load()
      preview.textContent = current
      restoreBtn.disabled = false
    } catch (err) {
      preview.textContent = `读取失败:${err instanceof Error ? err.message : String(err)}`
      restoreBtn.disabled = true
    }
  }
  // PRD 3.13:同步文件夹里的文件分「本机」「云端」两栏
  if (extraEntries.length) list.append(h('div', { class: 'tz-history-group' }, '本机'))
  for (const e of entries) {
    const el = h('div', { class: 'tz-history-item' }, h('div', null, new Date(e.time).toLocaleString('zh-CN', { hour12: false })), h('div', { class: 'tz-history-meta' }, `${e.source === 'cloud' ? '云端' : '本机'} · ${(e.size / 1024).toFixed(1)} KB`))
    el.addEventListener('click', () => void select(el, () => host.historyRead(path, e.id)))
    list.append(el)
  }
  if (extraEntries.length) {
    if (entries.length === 0) list.append(h('div', { class: 'tz-side-empty' }, '本机还没有历史版本'))
    list.append(h('div', { class: 'tz-history-group' }, '云端'))
  }
  for (const x of extraEntries) {
    const el = h('div', { class: 'tz-history-item' }, h('div', null, x.label), x.meta ? h('div', { class: 'tz-history-meta' }, x.meta) : null)
    el.addEventListener('click', () => void select(el, x.load))
    list.append(el)
  }
  if (list.childElementCount === 0) list.append(h('div', { class: 'tz-side-empty' }, '还没有历史版本(每次保存都会留一份)'))
  const { close } = modal('浏览所有版本', h('div', { class: 'tz-history' }, list, h('div', { class: 'tz-history-right' }, preview, restoreBtn)))
  restoreBtn.addEventListener('click', () => {
    if (current === null) return
    restore(current)
    close()
  })
}
