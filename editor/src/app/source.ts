// 源代码模式(⌃⌘/):整篇 Markdown 在 CodeMirror 里编辑,切回时重新解析。
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

  constructor(mount: HTMLElement, text: string, onChange: () => void, lineNumbersOn: boolean) {
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

  focus(): void {
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }
}
