// 本地历史版本面板(PRD 3.14、对照表 F-19、Z-13):左侧按时间列出版本,右侧预览并标出与当前内容的差异;
// 【恢复此版本】先把当前内容记成快照再替换;【复制内容】取全文,或预览里选中的片段;
// 「已删除的文件」列出历史还在、文件已不在原位置的文档,可找回。云同步文件夹里的文件另有「云端」一栏(PRD 3.16)。
import { diffRows } from '../core/linediff'
import { basename } from '../core/paths'
import type { HistoryEntry, Host } from '../host/types'
import { h } from '../ui/dom'
import { modal } from './panels'

export interface HistoryVersionRef {
  /** 版本时间,毫秒时间戳 */
  time: number
  label: string
  meta?: string
  load(): Promise<string>
}

export interface HistoryPanelOptions {
  host: Host
  /** 当前文档;未保存的新文档为 null(只看「已删除的文件」) */
  path: string | null
  entries: HistoryEntry[]
  cloud: HistoryVersionRef[]
  /** 当前内容(Markdown),用于标出差异 */
  current(): string
  /** 恢复到所选版本:应用先把当前内容记成快照再替换 */
  restore(text: string, time: number): Promise<void>
  /** 找回已删除的文件:写回原位置并打开 */
  recover(path: string, text: string, time: number): Promise<void>
  toast(message: string, error?: boolean): void
}

/** PRD 3.14 提示里的时间写法:2026-10-16 14:30 */
export function formatVersionTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 预览:给了当前内容就逐行标出差异(这个版本多出的行、少了的行),否则原样显示。 */
export function renderVersionPreview(current: string | null, version: string): HTMLElement {
  const box = h('div', { class: 'tz-history-preview' })
  if (current === null) {
    box.append(h('pre', { class: 'tz-diff-plain' }, version))
    return box
  }
  const rows = diffRows(current, version)
  if (!rows) {
    box.append(h('div', { class: 'tz-diff-summary' }, '内容较长,未标出差异'), h('pre', { class: 'tz-diff-plain' }, version))
    return box
  }
  let added = 0
  let removed = 0
  const lines: HTMLElement[] = []
  for (const r of rows) {
    if (r.kind === 'same') {
      lines.push(h('div', { class: 'tz-diff-line' }, r.right ?? ''))
      continue
    }
    if (r.left !== null) {
      removed++
      lines.push(h('div', { class: 'tz-diff-line is-removed', title: '当前内容里有,这个版本里没有' }, r.left))
    }
    if (r.right !== null) {
      added++
      lines.push(h('div', { class: 'tz-diff-line is-added', title: '这个版本里有,当前内容里没有' }, r.right))
    }
  }
  const summary = added || removed ? `与当前内容相比:这个版本多 ${added} 行、少 ${removed} 行` : '与当前内容相同'
  box.append(h('div', { class: 'tz-diff-summary' }, summary), h('div', { class: 'tz-diff-lines' }, ...lines))
  return box
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function showHistory(o: HistoryPanelOptions): void {
  const view = h('div', { class: 'tz-history-view' }, h('div', { class: 'tz-side-empty' }, '选择左侧的版本查看内容'))
  const restoreBtn = h('button', { type: 'button', class: 'tz-btn-primary', name: 'restore', disabled: true }, '恢复此版本')
  const copyBtn = h('button', { type: 'button', class: 'tz-btn', name: 'copy', disabled: true }, '复制内容')
  const list = h('div', { class: 'tz-history-list' })
  let selected: { text: string; time: number; deletedPath: string | null } | null = null
  let seq = 0

  const select = async (el: HTMLElement, load: () => Promise<string>, time: number, deletedPath: string | null) => {
    const mine = ++seq
    for (const x of Array.from(list.querySelectorAll('.tz-history-item'))) x.classList.remove('is-active')
    el.classList.add('is-active')
    selected = null
    restoreBtn.disabled = true
    copyBtn.disabled = true
    view.replaceChildren(h('div', { class: 'tz-side-empty' }, '加载中…'))
    try {
      const text = await load()
      if (mine !== seq) return
      selected = { text, time, deletedPath }
      view.replaceChildren(renderVersionPreview(deletedPath ? null : o.current(), text))
      restoreBtn.disabled = false
      copyBtn.disabled = false
    } catch (err) {
      if (mine === seq) view.replaceChildren(h('div', { class: 'tz-tree-error' }, `读取失败:${errText(err)}`))
    }
  }
  const item = (label: string, meta: string, onClick: (el: HTMLElement) => void) => {
    const el = h('div', { class: 'tz-history-item', role: 'button' }, h('div', null, label), h('div', { class: 'tz-history-meta' }, meta))
    el.addEventListener('click', () => onClick(el))
    return el
  }
  const group = (title: string) => h('div', { class: 'tz-history-group' }, title)

  const path = o.path
  if (path) {
    if (o.cloud.length) list.append(group('本机'))
    for (const e of o.entries) {
      list.append(item(formatVersionTime(e.time), `${e.source === 'cloud' ? '云端' : '本机'} · ${(e.size / 1024).toFixed(1)} KB`, (el) => void select(el, () => o.host.historyRead(path, e.id), e.time, null)))
    }
    if (o.entries.length === 0) list.append(h('div', { class: 'tz-side-empty' }, o.cloud.length ? '本机还没有历史版本' : '还没有历史版本(每次保存都会留一份)'))
    if (o.cloud.length) {
      list.append(group('云端'))
      for (const c of o.cloud) list.append(item(c.label, c.meta ?? '', (el) => void select(el, () => c.load(), c.time, null)))
    }
  }

  // 已删除的文件:点开再列出它的各个版本
  const deleted = h('div', { class: 'tz-history-deleted' })
  list.append(group('已删除的文件'), deleted)
  o.host.historyDeleted().then(
    (files) => {
      if (files.length === 0) deleted.append(h('div', { class: 'tz-side-empty' }, '没有已删除的文件'))
      for (const f of files) {
        const versions = h('div', { class: 'tz-history-sub', hidden: true })
        const head = item(basename(f.path), `${f.count} 个版本 · ${formatVersionTime(f.time)}`, () => {
          versions.hidden = !versions.hidden
          if (versions.childElementCount) return
          o.host.historyList(f.path).then(
            (entries) => {
              for (const e of entries) versions.append(item(formatVersionTime(e.time), `${(e.size / 1024).toFixed(1)} KB`, (el) => void select(el, () => o.host.historyRead(f.path, e.id), e.time, f.path)))
            },
            (err: unknown) => versions.append(h('div', { class: 'tz-tree-error' }, `读取失败:${errText(err)}`)),
          )
        })
        head.classList.add('is-deleted')
        head.title = f.path
        deleted.append(head, versions)
      }
    },
    (err: unknown) => deleted.append(h('div', { class: 'tz-tree-error' }, `读取失败:${errText(err)}`)),
  )

  const { close } = modal(
    '浏览所有版本',
    h('div', { class: 'tz-history' }, list, h('div', { class: 'tz-history-right' }, view, h('div', { class: 'tz-history-actions' }, copyBtn, restoreBtn))),
  )
  restoreBtn.addEventListener('click', () => {
    const s = selected
    if (!s) return
    restoreBtn.disabled = true
    const done = s.deletedPath ? o.recover(s.deletedPath, s.text, s.time) : o.restore(s.text, s.time)
    done.then(
      () => close(),
      (err: unknown) => {
        restoreBtn.disabled = false
        o.toast(`恢复失败:${errText(err)}`, true)
      },
    )
  })
  // 按下按钮时不清掉预览里的选区:选了一段就只复制那一段(PRD 3.14「只取片段」)
  copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
  copyBtn.addEventListener('click', () => {
    const s = selected
    if (!s) return
    const sel = window.getSelection()
    const part = sel && !sel.isCollapsed && sel.anchorNode && view.contains(sel.anchorNode) ? sel.toString() : ''
    o.host.clipboardWrite({ text: part || s.text }).then(
      () => o.toast(part ? '已复制所选内容' : '已复制这个版本的全部内容'),
      (err: unknown) => o.toast(`复制失败:${errText(err)}`, true),
    )
  })
}
