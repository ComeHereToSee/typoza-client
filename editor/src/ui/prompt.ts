// 页内输入浮层(替代 window.prompt):输入网址、替代文字、链接等。
import { h } from './dom'

export interface PromptOptions {
  title: string
  placeholder?: string
  value?: string
  okText?: string
  anchor?: { left: number; top: number; bottom: number }
  /** 返回错误提示文字表示不合法 */
  validate?: (value: string) => string | null
}

export function promptInput(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'tz-prompt-input', placeholder: options.placeholder ?? '', spellcheck: 'false' })
    input.value = options.value ?? ''
    const error = h('div', { class: 'tz-prompt-error', hidden: true })
    const ok = h('button', { type: 'button', class: 'tz-prompt-ok' }, options.okText ?? '确定')
    const box = h('div', { class: 'tz-popover tz-prompt' }, h('div', { class: 'tz-prompt-title' }, options.title), input, error, ok)
    document.body.append(box)
    const a = options.anchor
    if (a) {
      box.style.left = `${Math.min(Math.max(8, a.left), window.innerWidth - 340)}px`
      box.style.top = `${a.bottom + 8}px`
    } else {
      box.classList.add('is-centered')
    }
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      document.removeEventListener('mousedown', outside, true)
      box.remove()
      resolve(value)
    }
    const submit = () => {
      const v = input.value.trim()
      const msg = options.validate?.(v) ?? null
      if (msg) {
        error.textContent = msg
        error.hidden = false
        return
      }
      finish(v)
    }
    const outside = (e: MouseEvent) => {
      if (!box.contains(e.target as Node)) finish(null)
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    ok.addEventListener('click', submit)
    document.addEventListener('mousedown', outside, true)
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  })
}

/** 网址校验:只接受 http(s)。 */
export function validateUrl(value: string): string | null {
  try {
    const u = new URL(value)
    return /^https?:$/.test(u.protocol) ? null : '只支持 http / https 网址'
  } catch {
    return '请输入完整网址,如 https://example.com'
  }
}
