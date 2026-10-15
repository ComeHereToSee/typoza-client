// Typoza 在 mdast 上扩展的节点类型。解析时由 transform.ts 从标准节点(blockquote、html 等)识别出来,
// 序列化时由 serialize.ts 的处理器写回标准 Markdown 或通用 HTML。
import type { BlockContent, Parent, PhrasingContent } from 'mdast'
import type { CalloutKind, MediaKind } from '../schema'

/** GitHub 提示框:`> [!NOTE] 标题` */
export interface TzCallout extends Parent {
  type: 'tzCallout'
  kind: CalloutKind
  title: string
  children: BlockContent[]
}

/** 折叠块 `<details><summary>…</summary> … </details>` */
export interface TzToggle extends Parent {
  type: 'tzToggle'
  openInSource: boolean
  /** summary 的行内内容(由 HTML 解析而来) */
  summaryHtml: string
  children: BlockContent[]
}

export interface TzMedia {
  type: 'tzMedia'
  kind: MediaKind
  src: string
  title: string
  width: string | null
  height: string | null
  /** 原文 HTML;未编辑时原样写回 */
  html: string
}

export interface TzToc {
  type: 'tzToc'
}

export interface TzWikiLink {
  type: 'tzWikiLink'
  target: string
  alias: string | null
}

/** 由成对 HTML 标签识别出的行内格式:<u>、<span style="color">  */
export interface TzInlineMark extends Parent {
  type: 'tzInlineMark'
  mark: 'underline' | 'color'
  color: string | null
  background: string | null
  children: PhrasingContent[]
}

/** <img> 标签形式的图片(带 width / zoom 等 Markdown 表达不了的属性) */
export interface TzHtmlImage {
  type: 'tzHtmlImage'
  src: string
  alt: string
  title: string | null
  width: string | null
  height: string | null
  zoom: string | null
  align: string | null
}

/** <br> 形式的换行 */
export interface TzHtmlBreak {
  type: 'tzHtmlBreak'
}

declare module 'mdast' {
  interface LinkData {
    /** 原文是 GFM 裸网址 */
    tzAutolink?: boolean
  }
  interface BreakData {
    /** 原文是「行尾两空格」换行 */
    tzSpaces?: boolean
  }
  interface RootContentMap {
    tzCallout: TzCallout
    tzToggle: TzToggle
    tzMedia: TzMedia
    tzToc: TzToc
    tzWikiLink: TzWikiLink
    tzInlineMark: TzInlineMark
    tzHtmlImage: TzHtmlImage
    tzHtmlBreak: TzHtmlBreak
  }
  interface BlockContentMap {
    tzCallout: TzCallout
    tzToggle: TzToggle
    tzMedia: TzMedia
    tzToc: TzToc
  }
  interface PhrasingContentMap {
    tzWikiLink: TzWikiLink
    tzInlineMark: TzInlineMark
    tzHtmlImage: TzHtmlImage
    tzHtmlBreak: TzHtmlBreak
  }
}
