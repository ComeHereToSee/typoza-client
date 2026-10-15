// 代码块:在 ProseMirror 里嵌 CodeMirror 6(按 prosemirror.net 官方「嵌入代码编辑器」示例的同步方式)。
// 语言按需加载;mermaid 等图表语言在代码下方渲染预览,光标不在块内时只显示图表(Typora 行为)。
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { LanguageDescription, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState as CMState } from '@codemirror/state'
import { EditorView as CMView, type KeyBinding, type ViewUpdate, drawSelection, keymap as cmKeymap, lineNumbers } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { exitCode, setBlockType } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { type Command, Selection, TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import type { EditorEnv } from '../core/env'
import { schema } from '../core/schema'
import { ICONS, h, svgIcon } from '../ui/dom'
import { renderDiagram, isDiagramLanguage } from './diagram'

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  objc: 'objective-c',
}

function findLanguage(name: string): LanguageDescription | null {
  if (!name) return null
  const key = ALIASES[name.toLowerCase()] ?? name
  return LanguageDescription.matchLanguageName(languages, key, true)
}

export class CodeBlockView implements NodeView {
  dom: HTMLElement
  private cm: CMView
  private updating = false
  private readonly language = new Compartment()
  private readonly gutter = new Compartment()
  private readonly wrap = new Compartment()
  private readonly langInput: HTMLInputElement
  private readonly preview: HTMLDivElement
  private loadedLanguage = ''
  private renderTimer = 0

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly env: EditorEnv,
  ) {
    this.cm = new CMView({
      state: CMState.create({
        doc: node.textContent,
        extensions: [
          cmKeymap.of([...this.escapeKeys(), indentWithTab, ...defaultKeymap]),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(classHighlighter),
          this.language.of([]),
          this.gutter.of(env.settings.codeLineNumbers ? lineNumbers() : []),
          this.wrap.of(env.settings.codeLineWrap ? CMView.lineWrapping : []),
          CMView.updateListener.of((update) => this.forwardUpdate(update)),
          CMView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
        ],
      }),
    })

    this.langInput = h('input', {
      class: 'tz-code-lang',
      placeholder: '语言',
      value: node.attrs.language ?? '',
      spellcheck: 'false',
      list: 'tz-code-languages',
    })
    this.langInput.addEventListener('change', () => this.setLanguageAttr(this.langInput.value.trim()))
    this.langInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.setLanguageAttr(this.langInput.value.trim())
        this.cm.focus()
      }
    })
    const copy = h(
      'button',
      {
        class: 'tz-code-copy',
        title: '复制代码',
        type: 'button',
        onclick: ((e: Event) => {
          e.preventDefault()
          void navigator.clipboard.writeText(this.node.textContent)
          copy.classList.add('is-done')
          setTimeout(() => copy.classList.remove('is-done'), 1200)
        }) as EventListener,
      },
      svgIcon(ICONS.copy, 14),
    )
    const header = h('div', { class: 'tz-code-header', contenteditable: 'false' }, this.langInput, copy)
    this.preview = h('div', { class: 'tz-diagram-preview', contenteditable: 'false', hidden: true })
    this.preview.addEventListener('mousedown', (e) => {
      // 点图表进入编辑
      e.preventDefault()
      this.cm.focus()
      const pos = this.getPos()
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)))
    })
    this.dom = h('div', { class: 'tz-code-block' }, header, this.cm.dom, this.preview)
    ensureLanguageList()
    this.applyLanguage()
  }

  private setLanguageAttr(language: string): void {
    const pos = this.getPos()
    if (pos === undefined || language === this.node.attrs.language) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, language }))
  }

  private applyLanguage(): void {
    const name = this.node.attrs.language ?? ''
    this.dom.dataset.language = name
    const diagram = isDiagramLanguage(name)
    this.dom.classList.toggle('is-diagram', diagram)
    this.preview.hidden = !diagram
    if (diagram) this.scheduleDiagram()
    if (name === this.loadedLanguage) return
    this.loadedLanguage = name
    const desc = findLanguage(name)
    if (!desc) {
      this.cm.dispatch({ effects: this.language.reconfigure([]) })
      return
    }
    void desc.load().then((support) => {
      if (this.loadedLanguage === name) this.cm.dispatch({ effects: this.language.reconfigure(support) })
    })
  }

  private scheduleDiagram(): void {
    clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => {
      void renderDiagram(this.node.attrs.language, this.node.textContent, this.preview)
    }, 250)
  }

  // ---------- CodeMirror ↔ ProseMirror 同步 ----------

  private forwardUpdate(update: ViewUpdate): void {
    if (this.updating || !this.cm.hasFocus) return
    const pos = this.getPos()
    if (pos === undefined) return
    let offset = pos + 1
    const { main } = update.state.selection
    const selFrom = offset + main.from
    const selTo = offset + main.to
    const pmSel = this.view.state.selection
    if (update.docChanged || pmSel.from !== selFrom || pmSel.to !== selTo) {
      const tr = this.view.state.tr
      update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
        if (text.length) tr.replaceWith(offset + fromA, offset + toA, schema.text(text.toString()))
        else tr.delete(offset + fromA, offset + toA)
        offset += toB - fromB - (toA - fromA)
      })
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo))
      this.view.dispatch(tr)
    }
  }

  setSelection(anchor: number, head: number): void {
    this.cm.focus()
    this.updating = true
    this.cm.dispatch({ selection: { anchor, head } })
    this.updating = false
  }

  private escapeKeys(): KeyBinding[] {
    const view = this.view
    const pm = (cmd: Command) => () => cmd(view.state, view.dispatch, view)
    return [
      { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
      { key: 'ArrowLeft', run: () => this.maybeEscape('char', -1) },
      { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
      { key: 'ArrowRight', run: () => this.maybeEscape('char', 1) },
      {
        key: 'Mod-Enter',
        run: () => {
          if (!exitCode(view.state, view.dispatch)) return false
          view.focus()
          return true
        },
      },
      {
        // 空代码块里退格:变回普通段落(与 Notion 一致)
        key: 'Backspace',
        run: () => {
          if (this.cm.state.doc.length > 0) return false
          const ok = setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
          if (ok) view.focus()
          return ok
        },
      },
      { key: 'Mod-z', run: pm(undo) },
      { key: 'Mod-Shift-z', run: pm(redo) },
      { key: 'Mod-y', run: pm(redo) },
    ]
  }

  private maybeEscape(unit: 'line' | 'char', dir: -1 | 1): boolean {
    const { state } = this.cm
    let range: { from: number; to: number } = state.selection.main
    if (!state.selection.main.empty) return false
    if (unit === 'line') range = state.doc.lineAt(state.selection.main.head)
    if (dir < 0 ? range.from > 0 : range.to < state.doc.length) return false
    const pos = this.getPos()
    if (pos === undefined) return false
    const target = pos + (dir < 0 ? 0 : this.node.nodeSize)
    const selection = Selection.near(this.view.state.doc.resolve(target), dir)
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
    return true
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const languageChanged = node.attrs.language !== this.node.attrs.language
    this.node = node
    if (languageChanged) {
      this.langInput.value = node.attrs.language ?? ''
      this.applyLanguage()
    }
    if (this.updating) return true
    const next = node.textContent
    const cur = this.cm.state.doc.toString()
    if (next !== cur) {
      let start = 0
      let curEnd = cur.length
      let nextEnd = next.length
      while (start < curEnd && cur.charCodeAt(start) === next.charCodeAt(start)) start++
      while (curEnd > start && nextEnd > start && cur.charCodeAt(curEnd - 1) === next.charCodeAt(nextEnd - 1)) {
        curEnd--
        nextEnd--
      }
      this.updating = true
      this.cm.dispatch({ changes: { from: start, to: curEnd, insert: next.slice(start, nextEnd) } })
      this.updating = false
    }
    if (isDiagramLanguage(node.attrs.language)) this.scheduleDiagram()
    return true
  }

  /** 设置变化(行号、自动换行)时由编辑器调用。 */
  reconfigure(): void {
    this.cm.dispatch({
      effects: [
        this.gutter.reconfigure(this.env.settings.codeLineNumbers ? lineNumbers() : []),
        this.wrap.reconfigure(this.env.settings.codeLineWrap ? CMView.lineWrapping : []),
      ],
    })
  }

  selectNode(): void {
    this.cm.focus()
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    clearTimeout(this.renderTimer)
    this.cm.destroy()
  }
}

/** 语言输入框的候选列表(全局一份)。 */
function ensureLanguageList(): void {
  if (document.getElementById('tz-code-languages')) return
  const list = h('datalist', { id: 'tz-code-languages' })
  const names = new Set<string>(['mermaid', 'math'])
  for (const l of languages) names.add(l.name.toLowerCase())
  for (const name of [...names].sort()) list.append(h('option', { value: name }))
  document.body.append(list)
}

/** 方向键从普通文本块进入代码块时,把光标交给 CodeMirror(官方示例的 arrowHandler)。 */
export function codeBlockArrowHandler(dir: 'left' | 'right' | 'up' | 'down'): Command {
  return (state, dispatch, view) => {
    if (state.selection.empty && view?.endOfTextblock(dir)) {
      const side = dir === 'left' || dir === 'up' ? -1 : 1
      const $head = state.selection.$head
      const next = Selection.near(state.doc.resolve(side > 0 ? $head.after() : $head.before()), side)
      if (next.$head && next.$head.parent.type === schema.nodes.code_block) {
        if (dispatch) dispatch(state.tr.setSelection(next))
        return true
      }
    }
    return false
  }
}
