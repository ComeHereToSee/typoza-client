// 命令注册表:命令 ID → 实现。快捷键、斜杠菜单、块菜单、原生菜单栏都按 ID 调用,
// 用户自定义快捷键也只改「键 → ID」的映射,不碰实现。
import { setBlockType } from 'prosemirror-commands'
import { undoInputRule } from 'prosemirror-inputrules'
import { Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
  clearFormatting,
  deleteBlock,
  duplicateBlock,
  indent,
  insertCallout,
  insertCodeBlock,
  insertDivider,
  insertFootnote,
  insertFrontMatter,
  insertInlineMath,
  insertMathBlock,
  insertTable,
  insertToc,
  insertToggle,
  moveBlock,
  outdent,
  progressiveSelectAll,
  redo,
  removeLink,
  selectCurrentBlock,
  setHeading,
  shiftHeading,
  toggleAllFolds,
  toggleCheckOrFold,
  toggleFormat,
  turnInto,
  undo,
} from './commands'
import { schema } from './schema'
import {
  applyLastColor,
  deleteFormatted,
  deleteSentence,
  deleteWord,
  editSelectedBlock,
  escapeSelect,
  jumpToSelection,
  modifyCurrentBlock,
  selectFormatted,
  selectSentence,
  selectSiblingBlock,
  selectWord,
} from './selection-commands'
import { NodeSelection } from 'prosemirror-state'

export type CommandRun = (view: EditorView) => boolean

export interface CommandDef {
  id: string
  /** 菜单、命令面板里显示的名字 */
  label: string
  run: CommandRun
}

const registry = new Map<string, CommandDef>()

export function registerCommand(def: CommandDef): void {
  registry.set(def.id, def)
}

export function getCommand(id: string): CommandDef | undefined {
  return registry.get(id)
}

export function allCommands(): CommandDef[] {
  return [...registry.values()]
}

/** 执行命令;未知 ID 直接报错(说明菜单或快捷键配置写错了)。 */
export function runCommand(view: EditorView, id: string): boolean {
  const def = registry.get(id)
  if (!def) throw new Error(`未注册的命令:${id}`)
  return def.run(view)
}

const m = schema.marks
const st = (cmd: (s: EditorView['state'], d?: EditorView['dispatch']) => boolean): CommandRun => (view) => cmd(view.state, view.dispatch)

const builtins: CommandDef[] = [
  { id: 'edit.undo', label: '撤销', run: st(undo) },
  { id: 'edit.redo', label: '重做', run: st(redo) },
  { id: 'edit.undoInputRule', label: '撤销自动格式', run: st(undoInputRule) },
  { id: 'edit.selectAll', label: '全选', run: st(progressiveSelectAll) },

  { id: 'format.bold', label: '加粗', run: st(toggleFormat(m.strong)) },
  { id: 'format.italic', label: '斜体', run: st(toggleFormat(m.em)) },
  { id: 'format.underline', label: '下划线', run: st(toggleFormat(m.underline)) },
  { id: 'format.strike', label: '删除线', run: st(toggleFormat(m.strike)) },
  { id: 'format.code', label: '行内代码', run: st(toggleFormat(m.code)) },
  { id: 'format.highlight', label: '高亮', run: st(toggleFormat(m.highlight)) },
  { id: 'format.superscript', label: '上标', run: st(toggleFormat(m.sup)) },
  { id: 'format.subscript', label: '下标', run: st(toggleFormat(m.sub)) },
  { id: 'format.inlineMath', label: '行内公式', run: st(insertInlineMath) },
  { id: 'format.unlink', label: '移除链接', run: st(removeLink) },
  { id: 'format.clear', label: '清除样式', run: st(clearFormatting) },

  { id: 'block.paragraph', label: '正文', run: (v) => turnInto(v, 'paragraph') },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    id: `block.h${level}`,
    label: `${level} 级标题`,
    run: st(setHeading(level)),
  })),
  { id: 'block.headingUp', label: '提升标题级别', run: st(shiftHeading(1)) },
  { id: 'block.headingDown', label: '降低标题级别', run: st(shiftHeading(-1)) },
  { id: 'block.bullet', label: '无序列表', run: (v) => turnInto(v, 'bullet') },
  { id: 'block.numbered', label: '有序列表', run: (v) => turnInto(v, 'numbered') },
  { id: 'block.todo', label: '待办列表', run: (v) => turnInto(v, 'todo') },
  { id: 'block.toggle', label: '折叠列表', run: (v) => turnInto(v, 'toggle') },
  { id: 'block.quote', label: '引用', run: (v) => turnInto(v, 'quote') },
  { id: 'block.callout', label: '标注', run: (v) => turnInto(v, 'callout') },
  { id: 'block.code', label: '代码块', run: (v) => turnInto(v, 'code') },
  { id: 'block.math', label: '公式块', run: (v) => turnInto(v, 'math') },

  { id: 'insert.table', label: '表格', run: st(insertTable(3, 3)) },
  { id: 'insert.divider', label: '分割线', run: st(insertDivider) },
  { id: 'insert.toc', label: '目录', run: st(insertToc) },
  { id: 'insert.footnote', label: '脚注', run: st(insertFootnote) },
  { id: 'insert.frontMatter', label: 'YAML Front Matter', run: st(insertFrontMatter) },
  { id: 'insert.codeBlock', label: '代码块', run: st(insertCodeBlock()) },
  { id: 'insert.mathBlock', label: '公式块', run: st(insertMathBlock) },
  { id: 'insert.callout', label: '标注块', run: st(insertCallout('tip')) },
  { id: 'insert.toggle', label: '折叠块', run: st(insertToggle) },

  { id: 'block.select', label: '选中块', run: st(selectCurrentBlock) },
  { id: 'block.duplicate', label: '复制块', run: st(duplicateBlock) },
  { id: 'block.moveUp', label: '上移块', run: st(moveBlock(-1)) },
  { id: 'block.moveDown', label: '下移块', run: st(moveBlock(1)) },
  { id: 'block.delete', label: '删除块', run: st(deleteBlock) },
  { id: 'block.indent', label: '增加缩进', run: st(indent) },
  { id: 'block.outdent', label: '减少缩进', run: st(outdent) },
  { id: 'block.toggleCheck', label: '切换待办 / 展开折叠', run: st(toggleCheckOrFold) },
  { id: 'block.toggleAllFolds', label: '全部展开 / 收起', run: st(toggleAllFolds) },
  {
    id: 'block.paragraphAfter',
    label: '在下方插入段落',
    run: (view) => {
      const { state } = view
      const $to = state.selection.$to
      const pos = $to.after(1)
      const tr = state.tr.insert(pos, schema.nodes.paragraph.create())
      tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
      view.dispatch(tr.scrollIntoView())
      return true
    },
  },
  {
    id: 'block.paragraphBefore',
    label: '在上方插入段落',
    run: (view) => {
      const { state } = view
      const pos = state.selection.$from.before(1)
      const tr = state.tr.insert(pos, schema.nodes.paragraph.create())
      tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
      view.dispatch(tr.scrollIntoView())
      return true
    },
  },
  { id: 'block.codeToParagraph', label: '转为正文', run: st(setBlockType(schema.nodes.paragraph)) },

  { id: 'format.lastColor', label: '应用上次使用的颜色', run: st(applyLastColor) },
  { id: 'select.word', label: '选中当前词', run: st(selectWord) },
  { id: 'select.line', label: '选中当前行或句', run: st(selectSentence) },
  { id: 'select.format', label: '选中当前格式文本', run: st(selectFormatted) },
  { id: 'delete.word', label: '删除当前词', run: st(deleteWord) },
  { id: 'delete.line', label: '删除当前行或句', run: st(deleteSentence) },
  { id: 'delete.format', label: '删除当前格式文本', run: st(deleteFormatted) },
  { id: 'edit.jumpToSelection', label: '跳转到所选内容', run: st(jumpToSelection) },
  { id: 'block.escape', label: '选中块 / 退出块选中', run: st(escapeSelect) },
  { id: 'block.selectPrev', label: '选中上一块', run: st(selectSiblingBlock(-1)) },
  { id: 'block.selectNext', label: '选中下一块', run: st(selectSiblingBlock(1)) },
  { id: 'block.editSelected', label: '编辑所选块', run: st(editSelectedBlock) },
  { id: 'block.modify', label: '修改当前块', run: st(modifyCurrentBlock) },
  {
    // 块选中态才移动(文字编辑态保留 macOS 默认的扩选到文首 / 文末)
    id: 'block.moveUpSelected',
    label: '上移所选块',
    run: (view) => view.state.selection instanceof NodeSelection && moveBlock(-1)(view.state, view.dispatch),
  },
  {
    id: 'block.moveDownSelected',
    label: '下移所选块',
    run: (view) => view.state.selection instanceof NodeSelection && moveBlock(1)(view.state, view.dispatch),
  },
  {
    id: 'insert.comment',
    label: '注释',
    run: (view) => {
      const { from, to } = view.state.selection
      const inner = view.state.doc.textBetween(from, to)
      view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.html_inline.create({ html: `<!-- ${inner || '注释'} -->` })))
      return true
    },
  },
  {
    id: 'insert.linkReference',
    label: '链接引用',
    run: (view) => {
      const { state } = view
      const pos = state.selection.$to.after(1)
      const tr = state.tr.insert(pos, schema.nodes.definition.create({ label: 'ref', url: 'https://' }))
      view.dispatch(tr.scrollIntoView())
      return true
    },
  },
]

for (const def of builtins) registerCommand(def)
