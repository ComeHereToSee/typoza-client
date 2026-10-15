// 快速打开(⌘P / ⇧⌘O):在当前文件夹的 Markdown 文件里模糊查找,↵ 打开,⌘↵ 在新标签页打开。
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

export interface QuickOpenOptions {
  root: string | null
  files: string[]
  recent: string[]
  open(path: string, newWindow: boolean): void
}

export function showQuickOpen(options: QuickOpenOptions): void {
  document.querySelector('.tz-quick-open')?.remove()
  const input = h('input', { class: 'tz-qo-input', placeholder: '输入文件名查找(↵ 打开,⌘↵ 新标签页)', spellcheck: 'false' })
  const list = h('div', { class: 'tz-qo-list' })
  const box = h('div', { class: 'tz-quick-open', role: 'dialog' }, h('div', { class: 'tz-qo-panel' }, input, list))
  let items: string[] = []
  let index = 0
  const rel = (p: string) => (options.root && p.startsWith(`${options.root}/`) ? p.slice(options.root.length + 1) : p)
  const render = () => {
    const q = input.value.trim()
    const pool = q ? [...new Set([...options.recent, ...options.files])] : [...new Set([...options.recent, ...options.files])].slice(0, 50)
    items = q
      ? pool
          .map((p) => ({ p, s: fuzzyScore(q, rel(p)) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 50)
          .map((x) => x.p)
      : pool
    index = Math.min(index, Math.max(0, items.length - 1))
    list.replaceChildren(
      ...items.map((p, i) => {
        const row = h(
          'div',
          { class: `tz-qo-item${i === index ? ' is-selected' : ''}` },
          h('span', { class: 'tz-qo-name' }, basename(p)),
          h('span', { class: 'tz-qo-path' }, rel(p)),
          options.recent.includes(p) ? h('span', { class: 'tz-qo-tag' }, '最近') : null,
        )
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          close()
          options.open(p, e.metaKey)
        })
        return row
      }),
    )
    if (items.length === 0) list.append(h('div', { class: 'tz-menu-empty' }, '没有匹配的文件'))
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
      const p = items[index]
      close()
      if (p) options.open(p, e.metaKey)
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
}
