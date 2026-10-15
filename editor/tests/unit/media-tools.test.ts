// 图片、媒体、书签、查找、编辑菜单相关的纯逻辑(差距清单 1、11、37、38、46、64、68)。
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { simplifyHtml, transformCase } from '../../src/app/edit-commands'
import { updateFrontMatterText } from '../../src/app/document'
import { detectEmbed } from '../../src/core/embed'
import { ZOOM_PRESETS, imageSyntax, widthAttrs, zoomAttrs } from '../../src/core/image-ops'
import { normalizeUnicodeMarkers, parseMarkdown, setUnicodePunctuation } from '../../src/core/markdown/parse'
import { mediaHtml, serializeMarkdown } from '../../src/core/markdown/serialize'
import { schema } from '../../src/core/schema'
import { findMatches } from '../../src/plugins/find'
import { mediaNodeForUrl } from '../../src/plugins/media-insert'
import { plainTextSlice } from '../../src/plugins/paste'
import { showStyleAndMetaAsSource } from '../../src/views/blocks'

const parseOpts = { inlineMath: true }
const serOpts = { inlineMath: true, ensureTrailingNewline: false }

function find(doc: PMNode, type: string): PMNode[] {
  const out: PMNode[] = []
  doc.descendants((n) => {
    if (n.type.name === type) out.push(n)
  })
  return out
}

/** 用 JSON 重建文档:所有块都当作编辑过,走重新生成的路径。 */
function rebuild(doc: PMNode): PMNode {
  return schema.nodeFromJSON(doc.toJSON())
}

describe('粘贴网址识别 detectEmbed', () => {
  it('YouTube 各种分享地址换成嵌入播放器', () => {
    for (const url of ['https://www.youtube.com/watch?v=abc_123', 'https://youtu.be/abc_123', 'https://www.youtube.com/shorts/abc_123', 'https://m.youtube.com/watch?v=abc_123']) {
      expect(detectEmbed(url), url).toEqual({ kind: 'embed', src: 'https://www.youtube.com/embed/abc_123', provider: 'YouTube' })
    }
  })

  it('哔哩哔哩 BV 号带分 P', () => {
    expect(detectEmbed('https://www.bilibili.com/video/BV1xx411c7mD?p=2')).toEqual({
      kind: 'embed',
      src: 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&p=2&autoplay=0',
      provider: '哔哩哔哩',
    })
  })

  it('直链按扩展名归类(忽略查询串)', () => {
    expect(detectEmbed('https://a.example/x.PNG?w=2')?.kind).toBe('image')
    expect(detectEmbed('https://a.example/clip.mp4')?.kind).toBe('video')
    expect(detectEmbed('https://a.example/song.mp3#t=3')?.kind).toBe('audio')
    expect(detectEmbed('https://a.example/doc.pdf')?.kind).toBe('pdf')
  })

  it('普通网页、非 http 地址不识别', () => {
    expect(detectEmbed('https://example.com/post')).toBeNull()
    expect(detectEmbed('ftp://example.com/a.png')).toBeNull()
    expect(detectEmbed('不是网址')).toBeNull()
  })
})

describe('/pdf /video /audio 填网址', () => {
  it('在线视频网站存 <iframe> 嵌入地址,直链存 <video>', () => {
    const online = mediaNodeForUrl('video', 'https://youtu.be/abc')
    expect(online.attrs).toMatchObject({ kind: 'embed', src: 'https://www.youtube.com/embed/abc' })
    expect(mediaNodeForUrl('video', 'https://a.example/clip.mp4').attrs).toMatchObject({ kind: 'video', src: 'https://a.example/clip.mp4' })
    expect(mediaNodeForUrl('audio', 'https://a.example/song.mp3').attrs).toMatchObject({ kind: 'audio' })
    expect(mediaNodeForUrl('pdf', 'https://a.example/doc.pdf').attrs).toMatchObject({ kind: 'pdf', src: 'https://a.example/doc.pdf' })
  })

  it('PDF 网址存成 <iframe src="….pdf">', () => {
    const html = mediaHtml(mediaNodeForUrl('pdf', 'https://a.example/doc.pdf').attrs as Parameters<typeof mediaHtml>[0])
    expect(html).toBe('<iframe src="https://a.example/doc.pdf" width="100%" height="600"></iframe>')
  })
})

describe('书签卡片的标题与描述', () => {
  it('描述存在 <a title>,解析后重新生成不变', () => {
    const md = '<a href="https://example.com" title="一段描述" data-tz-type="bookmark">网页标题</a>\n'
    const { doc, meta } = parseMarkdown(md, parseOpts)
    const bookmark = find(doc, 'media')[0]
    expect(bookmark.attrs).toMatchObject({ kind: 'bookmark', src: 'https://example.com', title: '网页标题', description: '一段描述' })
    // 去掉原文 HTML,按属性重新生成
    const regenerated = schema.nodes.doc.create(null, schema.nodes.media.create({ ...bookmark.attrs, html: null }))
    expect(serializeMarkdown(regenerated, meta, serOpts)).toBe(md)
    expect(serializeMarkdown(rebuild(doc), meta, serOpts)).toBe(md)
  })

  it('取到的描述合成一行写回;没有描述时不写 title', () => {
    const base = { kind: 'bookmark', src: 'https://e.example/?a=1&b=2', title: '标题 <1>', width: null, height: null }
    expect(mediaHtml({ ...base, description: '第一行\n\n第二行 "引号"' })).toBe(
      '<a href="https://e.example/?a=1&amp;b=2" title="第一行 第二行 &quot;引号&quot;" data-tz-type="bookmark">标题 &lt;1&gt;</a>',
    )
    expect(mediaHtml({ ...base, description: '' })).toBe('<a href="https://e.example/?a=1&amp;b=2" data-tz-type="bookmark">标题 &lt;1&gt;</a>')
  })

  it('取不到网页信息时用网址作标题', () => {
    expect(mediaHtml({ kind: 'bookmark', src: 'https://e.example/p', title: '', width: null, height: null })).toBe(
      '<a href="https://e.example/p" data-tz-type="bookmark">https://e.example/p</a>',
    )
  })
})

describe('图片尺寸存储(PRD 3.4)', () => {
  const p = (img: PMNode) => schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, img))
  const meta = parseMarkdown('', parseOpts).meta

  it('拖手柄写 width 像素', () => {
    const img = schema.nodes.image.create({ src: 'assets/a.png', alt: '图', ...widthAttrs(480.4) })
    expect(serializeMarkdown(p(img), meta, serOpts)).toBe('<img src="assets/a.png" alt="图" width="480" />')
  })

  it('选比例写 zoom,100% 回到 ![]()', () => {
    expect(ZOOM_PRESETS).toEqual(['25%', '33%', '50%', '67%', '80%', '100%', '150%', '200%'])
    const zoomed = schema.nodes.image.create({ src: 'a.png', alt: 'x', width: '300', ...zoomAttrs('50%') })
    expect(serializeMarkdown(p(zoomed), meta, serOpts)).toBe('<img src="a.png" alt="x" style="zoom:50%;" />')
    const reset = schema.nodes.image.create({ ...zoomed.attrs, ...zoomAttrs('100%') })
    expect(imageSyntax(reset)).toBe('markdown')
    expect(serializeMarkdown(p(reset), meta, serOpts)).toBe('![x](a.png)')
  })

  it('原文是 <img> 的图片转 Markdown 前后写法', () => {
    const html = schema.nodes.image.create({ src: 'a.png', alt: 'x', html: true })
    expect(imageSyntax(html)).toBe('html')
    expect(serializeMarkdown(p(html), meta, serOpts)).toBe('<img src="a.png" alt="x" />')
  })
})

describe('文内查找', () => {
  const doc = parseMarkdown('apple Apple\n\napple pie\n', parseOpts).doc
  const opts = { query: 'apple', caseSensitive: false, wholeWord: false, regex: false }

  it('默认不区分大小写;区分时只命中小写', () => {
    expect(findMatches(doc, opts).matches).toHaveLength(3)
    expect(findMatches(doc, { ...opts, caseSensitive: true }).matches).toHaveLength(2)
  })

  it('正则写错时报错而不是抛异常', () => {
    const r = findMatches(doc, { ...opts, query: '(', regex: true })
    expect(r.matches).toEqual([])
    expect(r.error).toBeTruthy()
  })

  it('限「选中部分」:只保留完全落在范围内的匹配', () => {
    const first = doc.firstChild!
    const scope = { from: 1, to: 1 + first.content.size }
    const r = findMatches(doc, opts, scope)
    expect(r.matches).toHaveLength(2)
    expect(r.matches.every((m) => m.to <= scope.to)).toBe(true)
  })
})

describe('编辑菜单', () => {
  it('转换大小写', () => {
    expect(transformCase('hello World', 'upper')).toBe('HELLO WORLD')
    expect(transformCase('Hello WORLD', 'lower')).toBe('hello world')
    expect(transformCase("hELLO wORLD it's 中文", 'capitalize')).toBe("Hello World It's 中文")
  })

  it('复制内容并简化格式:去掉颜色等内联样式,保留语义标签', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p class="x"><strong>粗</strong><span style="color: red" data-tz-color="">红</span></p>'
    simplifyHtml(root)
    expect(root.innerHTML).toBe('<p><strong>粗</strong><span>红</span></p>')
  })

  it('粘贴为纯文本:每行一段,Markdown 符号按字面保留', () => {
    const slice = plainTextSlice('**粗**\r\n# 不是标题')
    const texts: string[] = []
    slice.content.forEach((n) => texts.push(`${n.type.name}:${n.textContent}`))
    expect(texts).toEqual(['paragraph:**粗**', 'paragraph:# 不是标题'])
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create())
    const state = EditorState.create({ doc })
    const next = state.apply(state.tr.replaceSelection(slice))
    expect(serializeMarkdown(next.doc, parseMarkdown('', parseOpts).meta, serOpts)).toBe('\\*\\*粗\\*\\*\n\n\\# 不是标题')
  })
})

describe('解析时转化 Unicode 标点(默认关)', () => {
  afterEach(() => setUnicodePunctuation(false))

  it('行首全角标记等长换成半角,围栏代码里不动', () => {
    const src = '》引用\n＃ 标题\n－ 列表\n１． 有序\n```\n》代码\n```'
    const out = normalizeUnicodeMarkers(src)
    expect(out).toBe('>引用\n# 标题\n- 列表\n1. 有序\n```\n》代码\n```')
    expect(out.length).toBe(src.length)
  })

  it('关闭时照常按文字解析;开启后识别为引用、标题,未编辑时原文不变', () => {
    const md = '》引用\n\n＃\u3000标题\n'
    expect(find(parseMarkdown(md, parseOpts).doc, 'blockquote')).toHaveLength(0)
    setUnicodePunctuation(true)
    const { doc, meta } = parseMarkdown(md, parseOpts)
    expect(find(doc, 'blockquote')[0]?.textContent).toBe('引用')
    expect(find(doc, 'heading')[0]?.textContent).toBe('标题')
    expect(serializeMarkdown(doc, meta, serOpts)).toBe(md)
  })
})

describe('HTML 里的 style、meta 只显示源码', () => {
  it('换成 <code> 显示原文,其余 HTML 不动', () => {
    const out = showStyleAndMetaAsSource('<style>.x{color:red}</style><p>正文</p><meta name="a" content="b">')
    const box = document.createElement('div')
    box.innerHTML = out
    const raw = Array.from(box.querySelectorAll('code.tz-html-raw')).map((c) => c.textContent)
    expect(raw).toEqual(['<style>.x{color:red}</style>', '<meta name="a" content="b">'])
    expect(box.querySelector('p')?.textContent).toBe('正文')
    expect(box.querySelector('style')).toBeNull()
  })
})

describe('页面图标与封面(front matter)', () => {
  it('新增、修改、删除键,保留其它键', () => {
    expect(updateFrontMatterText('', 'icon', '📘')).toBe('icon: 📘')
    expect(updateFrontMatterText('title: 文档\nicon: 📘', 'icon', '🚀')).toBe('title: 文档\nicon: 🚀')
    expect(updateFrontMatterText('title: 文档\ncover: assets/c.png', 'cover', null)).toBe('title: 文档')
  })
})
