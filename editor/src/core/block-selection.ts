// 多块选择(Notion 7.4):Esc 选中一块后 ⇧↑⇧↓ 扩选、⇧+点击选连续多块、⇧⌘+点击增减单块、空白处框选。
// 单块仍用 NodeSelection(既有命令都按它判断);两块及以上用 BlockSelection:
// 每个所选块各占一个 SelectionRange,复制 / 剪切 / 删除走 ProseMirror 的默认流程(content() 与 replace())。
// 所选块必须同属一个容器(跨层级时取共同容器下的祖先块),这样 content() 拿到的是一组可以并排插入的兄弟块。
import { Fragment, type Node as PMNode, Slice } from 'prosemirror-model'
import { type EditorState, NodeSelection, Selection, type SelectionBookmark, SelectionRange, TextSelection } from 'prosemirror-state'
import type { Mappable } from 'prosemirror-transform'
import { type BlockInfo, selectedBlock } from './blocks'
import { schema } from './schema'

export class BlockSelection extends Selection {
  /** 各所选块之前的位置,升序 */
  readonly positions: readonly number[]
  /** 扩选的固定端与移动端(块位置) */
  readonly anchorBlock: number
  readonly headBlock: number

  constructor(
    $anchor: Selection['$anchor'],
    $head: Selection['$head'],
    ranges: readonly SelectionRange[],
    positions: readonly number[],
    anchorBlock: number,
    headBlock: number,
  ) {
    super($anchor, $head, ranges)
    this.positions = positions
    this.anchorBlock = anchorBlock
    this.headBlock = headBlock
  }

  /** positions 需已校验(同一容器、升序、至少两块)。 */
  static create(doc: PMNode, positions: readonly number[], anchorBlock: number, headBlock: number): BlockSelection {
    const ranges = positions.map((p) => {
      const node = doc.nodeAt(p)
      if (!node) throw new Error(`块选择的位置无效:${p}`)
      return new SelectionRange(doc.resolve(p), doc.resolve(p + node.nodeSize))
    })
    // anchor / head 取整个选择的两端:DOM 选区覆盖全部所选块,复制事件才会触发
    const start = ranges[0].$from
    const end = ranges[ranges.length - 1].$to
    const backward = headBlock < anchorBlock
    return new BlockSelection(backward ? end : start, backward ? start : end, ranges, positions, anchorBlock, headBlock)
  }

  override eq(other: Selection): boolean {
    return (
      other instanceof BlockSelection &&
      other.anchorBlock === this.anchorBlock &&
      other.headBlock === this.headBlock &&
      other.positions.length === this.positions.length &&
      other.positions.every((p, i) => p === this.positions[i])
    )
  }

  override map(doc: PMNode, mapping: Mappable): Selection {
    const kept: number[] = []
    for (const p of this.positions) {
      const r = mapping.mapResult(p, 1)
      if (!r.deleted) kept.push(r.pos)
    }
    return reselectBlocks(doc, kept, mapping.map(this.anchorBlock, 1), mapping.map(this.headBlock, 1), mapping.map(this.head))
  }

  override content(): Slice {
    const doc = this.$anchor.doc
    const nodes = this.positions.map((p) => {
      const node = doc.nodeAt(p)
      if (!node) throw new Error(`块选择的位置无效:${p}`)
      return node
    })
    return new Slice(Fragment.fromArray(nodes), 0, 0)
  }

  override toJSON(): { type: string; positions: number[]; anchor: number; head: number } {
    return { type: 'tz-blocks', positions: [...this.positions], anchor: this.anchorBlock, head: this.headBlock }
  }

  override getBookmark(): SelectionBookmark {
    return new BlockBookmark(this.positions, this.anchorBlock, this.headBlock)
  }
}

// 与 NodeSelection 一样不显示浏览器选区,所选块由 blockselect 插件加底色
BlockSelection.prototype.visible = false

class BlockBookmark implements SelectionBookmark {
  constructor(
    readonly positions: readonly number[],
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): BlockBookmark {
    const kept: number[] = []
    for (const p of this.positions) {
      const r = mapping.mapResult(p, 1)
      if (!r.deleted) kept.push(r.pos)
    }
    return new BlockBookmark(kept, mapping.map(this.anchor, 1), mapping.map(this.head, 1))
  }

  resolve(doc: PMNode): Selection {
    return reselectBlocks(doc, [...this.positions], this.anchor, this.head, this.positions[0] ?? 0)
  }
}

/** 映射或撤销后重建块选择:丢掉已不存在或不再同属一个容器的块;一块都不剩时退回附近的光标。 */
export function reselectBlocks(doc: PMNode, positions: number[], anchor: number, head: number, fallback = positions[0] ?? 0): Selection {
  const valid = positions.filter((p) => p >= 0 && p < doc.content.size && isSelectableBlock(doc.nodeAt(p)))
  if (valid.length === 0) return Selection.near(doc.resolve(Math.max(0, Math.min(fallback, doc.content.size))))
  const $first = doc.resolve(valid[0])
  const siblings = valid.filter((p) => {
    const $p = doc.resolve(p)
    return $p.depth === $first.depth && $p.start() === $first.start()
  })
  return selectBlocks(doc, siblings, siblings.includes(anchor) ? anchor : siblings[0], siblings.includes(head) ? head : siblings[siblings.length - 1])
}

/** 可以作为「块」被选中的节点(YAML 与折叠块标题行不单独成块)。 */
export function isSelectableBlock(node: PMNode | null | undefined): node is PMNode {
  return Boolean(node && node.isBlock && node.type !== schema.nodes.frontmatter && node.type !== schema.nodes.toggle_summary)
}

/** 块选中态:选中了一个块(NodeSelection)或多个块。 */
export function isBlockSelected(sel: Selection): boolean {
  return sel instanceof BlockSelection || (sel instanceof NodeSelection && sel.node.isBlock)
}

/** 按位置选块:一块用 NodeSelection,多块用 BlockSelection。positions 须同属一个容器。 */
export function selectBlocks(doc: PMNode, positions: readonly number[], anchor: number, head: number): Selection {
  const sorted = [...new Set(positions)].sort((a, b) => a - b)
  if (sorted.length === 0) throw new Error('没有要选中的块')
  if (sorted.length === 1) return NodeSelection.create(doc, sorted[0])
  return BlockSelection.create(doc, sorted, anchor, head)
}

/** 当前选区涉及的块:多块选择 → 全部所选块;单块或光标 → 一个块。 */
export function selectedBlocks(state: EditorState): BlockInfo[] {
  const sel = state.selection
  if (sel instanceof BlockSelection) {
    return sel.positions.map((pos) => {
      const node = state.doc.nodeAt(pos)
      if (!node) throw new Error(`块选择的位置无效:${pos}`)
      return { node, pos, depth: state.doc.resolve(pos).depth }
    })
  }
  const one = selectedBlock(sel)
  return one ? [one] : []
}

/** 同一容器里相邻的块;没有(或相邻的是 YAML、折叠块标题行)时返回 null。 */
export function siblingBlock(doc: PMNode, pos: number, dir: -1 | 1): number | null {
  const $pos = doc.resolve(pos)
  const index = $pos.index() + dir
  if (index < 0 || index >= $pos.parent.childCount) return null
  if (!isSelectableBlock($pos.parent.child(index))) return null
  return $pos.posAtIndex(index)
}

/** 从固定端到移动端之间的全部同级块。 */
export function rangeSelection(doc: PMNode, anchor: number, head: number): Selection {
  const $a = doc.resolve(anchor)
  const from = Math.min(anchor, head)
  const to = Math.max(anchor, head)
  const positions: number[] = []
  $a.parent.forEach((child, offset) => {
    const pos = $a.start() + offset
    if (pos >= from && pos <= to && isSelectableBlock(child)) positions.push(pos)
  })
  return selectBlocks(doc, positions, anchor, head)
}

/** 当前选择的固定端与移动端(块位置);不在块选中态时为 null。 */
function blockEnds(sel: Selection): { anchor: number; head: number } | null {
  if (sel instanceof BlockSelection) return { anchor: sel.anchorBlock, head: sel.headBlock }
  if (sel instanceof NodeSelection && sel.node.isBlock) return { anchor: sel.from, head: sel.from }
  return null
}

/** ⇧↑ / ⇧↓:移动端换到相邻块,选中固定端与它之间的连续块。到头了保持不变。 */
export function extendBlockSelection(state: EditorState, dir: -1 | 1): Selection | null {
  const ends = blockEnds(state.selection)
  if (!ends) return null
  const next = siblingBlock(state.doc, ends.head, dir)
  if (next === null) return state.selection
  return rangeSelection(state.doc, ends.anchor, next)
}

/** 把块位置提升到共同容器下的祖先块(两块不在同一容器时)。 */
function liftToDepth(doc: PMNode, pos: number, depth: number): number {
  const $p = doc.resolve(pos)
  return $p.depth <= depth ? pos : $p.before(depth + 1)
}

function commonDepth(doc: PMNode, positions: readonly number[]): number {
  let depth = doc.resolve(positions[0]).depth
  for (const p of positions.slice(1)) {
    const $p = doc.resolve(p)
    depth = Math.min(depth, $p.depth, doc.resolve(positions[0]).sharedDepth(p))
  }
  return depth
}

/** ⇧+点击:从当前块(选中的块,或光标所在块)到点击的块,选中其间的连续块。 */
export function shiftClickSelection(state: EditorState, clicked: number): Selection | null {
  const ends = blockEnds(state.selection)
  const anchor = ends?.anchor ?? selectedBlock(state.selection)?.pos
  if (anchor === undefined) return null
  const depth = commonDepth(state.doc, [anchor, clicked])
  return rangeSelection(state.doc, liftToDepth(state.doc, anchor, depth), liftToDepth(state.doc, clicked, depth))
}

/** ⇧⌘+点击:点击的块不在选择里就加入,已在就移除;全部移除后光标回到该块。 */
export function toggleBlockSelection(state: EditorState, clicked: number): Selection {
  const sel = state.selection
  const current = sel instanceof BlockSelection ? [...sel.positions] : sel instanceof NodeSelection && sel.node.isBlock ? [sel.from] : []
  if (current.length === 0) return NodeSelection.create(state.doc, clicked)
  const depth = commonDepth(state.doc, [...current, clicked])
  const lifted = [...new Set(current.map((p) => liftToDepth(state.doc, p, depth)))]
  const target = liftToDepth(state.doc, clicked, depth)
  const next = lifted.includes(target) ? lifted.filter((p) => p !== target) : [...lifted, target]
  if (next.length === 0) return cursorInBlock(state.doc, target, 1)
  const sorted = [...next].sort((a, b) => a - b)
  return selectBlocks(state.doc, sorted, sorted[0], target)
}

/** 块里的文字光标:dir<0 放块末尾,dir>0 放块开头;块里没有文字时取最近的光标位置。 */
export function cursorInBlock(doc: PMNode, pos: number, dir: -1 | 1): Selection {
  const node = doc.nodeAt(pos)
  const edge = dir < 0 && node ? pos + node.nodeSize : pos
  const $edge = doc.resolve(edge)
  return Selection.findFrom($edge, dir, true) ?? Selection.findFrom($edge, -dir, true) ?? TextSelection.near($edge)
}

/** 退出块选中态:光标放到移动端那一块的末尾(Notion:块选中态 Esc、直接输入文字)。 */
export function exitBlockSelection(state: EditorState): Selection | null {
  const ends = blockEnds(state.selection)
  if (!ends) return null
  return cursorInBlock(state.doc, ends.head, -1)
}

/** 所选块的纯文字(状态栏字数、块菜单底部字数)。块之间空一行。 */
export function blocksText(blocks: readonly BlockInfo[]): string {
  return blocks.map((b) => b.node.textBetween(0, b.node.content.size, '\n\n', ' ')).join('\n\n')
}

/** 状态栏「已选」字数用的文字:多块选择取全部所选块,其它非空选区取选区文字;没有选区返回 null(notion-input.md 7.4)。 */
export function selectionText(state: EditorState): string | null {
  const sel = state.selection
  if (sel instanceof BlockSelection) return blocksText(selectedBlocks(state))
  if (sel.empty) return null
  return state.doc.textBetween(sel.from, sel.to, '\n\n', ' ')
}
