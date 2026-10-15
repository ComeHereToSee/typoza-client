// P0 骨架:验证打包、WebKit E2E 与 macOS 外壳加载链路。正式编辑内核在后续阶段替换本文件内容。
import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: {},
  },
})

const root = document.getElementById('app')
if (!root) throw new Error('缺少 #app 挂载点')

const view = new EditorView(root, {
  state: EditorState.create({
    doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Typoza')])]),
  }),
})

declare global {
  interface Window {
    typoza: { smoke(): Promise<{ ok: boolean; text: string }> }
    webkit?: { messageHandlers?: Record<string, { postMessage(msg: unknown): Promise<unknown> }> }
  }
}

window.typoza = {
  async smoke() {
    return { ok: view.state.doc.textContent === 'Typoza', text: view.state.doc.textContent }
  },
}

void window.webkit?.messageHandlers?.typoza?.postMessage({ method: 'app.ready', params: {} })
