// 公式:块级公式显示渲染结果,光标进入时下方露出源码(Typora);行内公式点击弹出编辑框(Notion)。
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { h } from '../ui/dom'
import { renderTex } from './katex'

export class MathBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private preview: HTMLDivElement
  private rendered = ''

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.preview = h('div', { class: 'tz-math-preview', contenteditable: 'false' })
    this.contentDOM = h('pre', { class: 'tz-math-source', spellcheck: 'false' })
    this.dom = h('div', { class: 'tz-math-block' }, this.preview, this.contentDOM)
    this.preview.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = this.getPos()
      if (pos === undefined) return
      this.view.focus()
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1 + this.node.content.size)))
    })
    this.render()
  }

  private render(): void {
    const tex = this.node.textContent
    if (tex === this.rendered) return
    this.rendered = tex
    this.dom.classList.toggle('is-empty', tex.trim() === '')
    if (tex.trim() === '') {
      this.preview.textContent = '点击输入公式(LaTeX)'
      return
    }
    void renderTex(tex, this.preview, true)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return this.preview.contains(mutation.target as Node)
  }
}

export class MathInlineView implements NodeView {
  dom: HTMLSpanElement
  private editor: HTMLDivElement | null = null

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = h('span', { class: 'tz-math-inline' })
    this.render()
  }

  private render(): void {
    const tex = this.node.attrs.tex as string
    if (!tex.trim()) {
      this.dom.textContent = '公式'
      this.dom.classList.add('is-empty')
      return
    }
    this.dom.classList.remove('is-empty')
    void renderTex(tex, this.dom, false)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.tex !== this.node.attrs.tex
    this.node = node
    if (changed) this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
    this.openEditor()
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
    this.closeEditor()
  }

  private openEditor(): void {
    if (this.editor) return
    const original = this.node.attrs.tex as string
    const input = h('textarea', { class: 'tz-math-input', rows: '2', spellcheck: 'false', placeholder: 'LaTeX,如 E=mc^2' })
    input.value = original
    const done = h('button', { type: 'button', class: 'tz-math-done' }, '完成 ↵')
    const editor = h('div', { class: 'tz-popover tz-math-popover' }, input, done)
    this.editor = editor
    document.body.append(editor)
    const place = () => {
      const r = this.dom.getBoundingClientRect()
      editor.style.left = `${Math.max(8, r.left)}px`
      editor.style.top = `${r.bottom + 6}px`
    }
    place()
    const commit = (moveAfter: boolean) => {
      const pos = this.getPos()
      if (pos === undefined) return
      const tex = input.value
      const tr = this.view.state.tr
      if (tex.trim() === '') tr.delete(pos, pos + 1)
      else if (tex !== this.node.attrs.tex) tr.setNodeMarkup(pos, null, { tex })
      if (moveAfter) tr.setSelection(TextSelection.create(tr.doc, tex.trim() === '' ? pos : pos + 1))
      this.view.dispatch(tr)
      if (moveAfter) this.view.focus()
    }
    input.addEventListener('input', () => {
      // 实时预览:直接改节点属性(同一编辑会话的修改在撤销历史里合并)
      const pos = this.getPos()
      if (pos === undefined || !input.value.trim()) return
      const tr = this.view.state.tr.setNodeMarkup(pos, null, { tex: input.value })
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      this.view.dispatch(tr)
      place()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        input.value = original
        commit(true)
      }
    })
    done.addEventListener('click', () => commit(true))
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  private closeEditor(): void {
    this.editor?.remove()
    this.editor = null
  }

  stopEvent(e: Event): boolean {
    return Boolean(this.editor?.contains(e.target as Node))
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.closeEditor()
  }
}
