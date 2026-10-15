// 快速打开(⌘P / ⇧⌘O,PRD 3.9):按文件名与首个标题模糊查找当前根文件夹与最近文件;↩ 当前标签打开,⌘↩ 新标签打开。
import type { OpenWhere } from '../core/env'
import { displayName } from '../core/filetypes'
import { basename } from '../core/paths'
import { h } from '../ui/dom'

/** 子序列模糊匹配打分:连续命中、命中词首、命中文件名得分更高;不匹配返回 -1。 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const nameStart = t.lastIndexOf('/') + 1
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (found >= nameStart ? 2 : 0) + (found === 0 || /[/\s._-]/.test(t[found - 1] ?? '') ? 3 : 0)
    ti = found + 1
  }
  return score - Math.min(10, t.length / 20)
}

/** 一个文件的得分:文件路径与首个标题取高者;都不匹配返回 -1。 */
export function quickOpenScore(query: string, relPath: string, title: string | null): number {
  const byPath = fuzzyScore(query, relPath)
  // 标题不含路径,「命中文件名」的加分对它恒成立,略降一点,同分时文件名优先
  const byTitle = title ? fuzzyScore(query, title) - 1 : -1
  return Math.max(byPath, byTitle)
}

export interface QuickOpenOptions {
  root: string | null
  files: string[]
  recent: string[]
  /** 各文件的首个标题(异步取,取到后按标题也能匹配) */
  titles?(paths: string[]): Promise<(string | null)[]>
  open(path: string, where: OpenWhere): void
}

const MAX_TITLE_LOOKUP = 3000

export function showQuickOpen(options: QuickOpenOptions): void {
  document.querySelector('.tz-quick-open')?.remove()
  const input = h('input', { class: 'tz-qo-input', placeholder: '输入文件名或标题查找(↩ 打开,⌘↩ 在新标签页打开)', spellcheck: 'false' })
  const list = h('div', { class: 'tz-qo-list' })
  const box = h('div', { class: 'tz-quick-open', role: 'dialog' }, h('div', { class: 'tz-qo-panel' }, input, list))
  const pool = [...new Set([...options.recent, ...options.files])]
  const titles = new Map<string, string>()
  let items: string[] = []
  let index = 0
  const rel = (p: string) => (options.root && p.startsWith(`${options.root}/`) ? p.slice(options.root.length + 1) : p)
  const render = () => {
    const q = input.value.trim()
    items = q
      ? pool
          .map((p) => ({ p, s: quickOpenScore(q, rel(p), titles.get(p) ?? null) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 50)
          .map((x) => x.p)
      : pool.slice(0, 50)
    index = Math.min(index, Math.max(0, items.length - 1))
    list.replaceChildren(
      ...items.map((p, i) => {
        const title = titles.get(p)
        const row = h(
          'div',
          { class: `tz-qo-item${i === index ? ' is-selected' : ''}`, 'data-path': p },
          h('span', { class: 'tz-qo-name' }, displayName(p) || basename(p)),
          title && title !== displayName(p) ? h('span', { class: 'tz-qo-title' }, title) : null,
          h('span', { class: 'tz-qo-path' }, rel(p)),
          options.recent.includes(p) ? h('span', { class: 'tz-qo-tag' }, '最近') : null,
        )
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          close()
          options.open(p, e.metaKey || e.ctrlKey ? 'tab' : 'current')
        })
        return row
      }),
    )
    if (items.length === 0) list.append(h('div', { class: 'tz-menu-empty' }, '没有找到对应的内容'))
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }
  const close = () => box.remove()
  input.addEventListener('input', () => {
    index = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') index = Math.min(items.length - 1, index + 1)
    else if (e.key === 'ArrowUp') index = Math.max(0, index - 1)
    else if (e.key === 'Escape') return close()
    else if (e.key === 'Enter') {
      e.preventDefault()
      const p = items[index]
      close()
      if (p) options.open(p, e.metaKey || e.ctrlKey ? 'tab' : 'current')
      return
    } else return
    e.preventDefault()
    render()
  })
  box.addEventListener('mousedown', (e) => {
    if (e.target === box) close()
  })
  document.body.append(box)
  render()
  input.focus()
  if (options.titles && pool.length) {
    const wanted = pool.slice(0, MAX_TITLE_LOOKUP)
    options.titles(wanted).then(
      (found) => {
        found.forEach((t, i) => {
          if (t) titles.set(wanted[i], t)
        })
        if (box.isConnected) render()
      },
      (err: unknown) => {
        // 标题只用来多一种匹配方式;取不到时按文件名照常可用,把原因留在列表末尾
        if (box.isConnected) list.append(h('div', { class: 'tz-menu-empty' }, `读取标题失败:${err instanceof Error ? err.message : String(err)}`))
      },
    )
  }
}
