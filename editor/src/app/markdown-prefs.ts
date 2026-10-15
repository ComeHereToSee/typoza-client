// 偏好设置 → Markdown 解析 / 序列化选项(偏好「Markdown」「编辑器」页里影响识别与写法的那些项)。
import type { ParseOptions } from '../core/markdown/parse'
import type { SerializeOptions } from '../core/markdown/serialize'
import type { AppSettings } from './settings'

export function parseOptionsFrom(s: AppSettings): ParseOptions {
  return {
    inlineMath: s.inlineMath,
    subscript: s.subscript,
    superscript: s.superscript,
    highlight: s.highlight,
    alerts: s.alerts,
    autolink: s.autolink,
    strict: s.strictMode,
  }
}

/** 影响新建 / 编辑过的块怎么写回文件的选项(没动过的块原样写回)。 */
export function serializeOptionsFrom(s: AppSettings): SerializeOptions {
  return {
    inlineMath: s.inlineMath,
    ensureTrailingNewline: s.ensureTrailingNewline,
    headingStyle: s.headingStyle,
    bullet: s.listBullet,
    incrementListMarker: s.orderedListIncrement,
    listItemIndent: s.listIndent,
    autolink: s.autolink,
  }
}
