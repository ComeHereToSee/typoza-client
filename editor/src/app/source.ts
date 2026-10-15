// 源代码模式(⌃⌘/):整篇 Markdown 在 CodeMirror 里编辑,切回时重新解析。超大文件以只读源码打开(对照表 X-51)。
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'

export class SourceEditor {
  readonly view: EditorView

  constructor(mount: HTMLElement, text: string, onChange: () => void, lineNumbersOn: boolean, readOnly = false) {
    this.view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          drawSelection(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(classHighlighter),
          EditorView.lineWrapping,
          lineNumbersOn ? lineNumbers() : [],
          EditorView.contentAttributes.of({ spellcheck: 'false' }),
          // 只读时仍可选中、复制、查找,只是不能改
          readOnly ? EditorState.readOnly.of(true) : [],
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange()
          }),
        ],
      }),
    })
    this.view.dom.classList.add('tz-source')
  }

  get text(): string {
    return this.view.state.doc.toString()
  }

  /** 光标在原文里的偏移(换行按 \n 计) */
  get cursor(): number {
    return this.view.state.selection.main.head
  }

  setCursor(offset: number): void {
    const pos = Math.max(0, Math.min(offset, this.view.state.doc.length))
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  }

  focus(): void {
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }
}
