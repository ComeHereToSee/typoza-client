// Typora 扩展行内语法:==高亮==、^上标^、~下标~。
// 在 micromark 分词层实现(仿 GFM 删除线的「定界符 + resolveAll 配对」),而不是在 mdast 上做文本替换:
// 只有分词层能区分转义的 `\==` 与真正的定界符,文本替换会把转义字符在一次保存往返后变成格式。
import type { ConstructRecord, Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types'
import type { CompileContext, Extension as FromMarkdownExtension, Token as MdToken } from 'mdast-util-from-markdown'
import type { ConstructName, Handle, Options as ToMarkdownExtension, Unsafe } from 'mdast-util-to-markdown'
import type { Parent, PhrasingContent } from 'mdast'
import { splice } from 'micromark-util-chunked'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'

export interface Mark extends Parent {
  type: 'mark'
  children: PhrasingContent[]
}
export interface Superscript extends Parent {
  type: 'superscript'
  children: PhrasingContent[]
}
export interface Subscript extends Parent {
  type: 'subscript'
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    mark: Mark
    superscript: Superscript
    subscript: Subscript
  }
  interface RootContentMap {
    mark: Mark
    superscript: Superscript
    subscript: Subscript
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    tzMark: 'tzMark'
    tzMarkSequence: 'tzMarkSequence'
    tzMarkSequenceTemporary: 'tzMarkSequenceTemporary'
    tzMarkText: 'tzMarkText'
    tzSup: 'tzSup'
    tzSupSequence: 'tzSupSequence'
    tzSupSequenceTemporary: 'tzSupSequenceTemporary'
    tzSupText: 'tzSupText'
    tzSub: 'tzSub'
    tzSubSequence: 'tzSubSequence'
    tzSubSequenceTemporary: 'tzSubSequenceTemporary'
    tzSubText: 'tzSubText'
  }
  interface Token {
    _tzOpen?: boolean
    _tzClose?: boolean
  }
}

declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    tzMark: 'tzMark'
    tzSup: 'tzSup'
    tzSub: 'tzSub'
  }
}

interface DelimiterSpec {
  /** 分词名前缀,如 tzMark */
  name: 'tzMark' | 'tzSup' | 'tzSub'
  /** 定界字符的码点 */
  code: number
  /** 定界序列长度(== 是 2,^ 与 ~ 是 1) */
  size: number
  /** 内容里是否允许空白;上下标按 Pandoc 规则不允许 */
  allowWhitespace: boolean
}

const EQUALS = 61
const CARET = 94
const TILDE = 126

const SPECS: DelimiterSpec[] = [
  { name: 'tzMark', code: EQUALS, size: 2, allowWhitespace: true },
  { name: 'tzSup', code: CARET, size: 1, allowWhitespace: false },
  { name: 'tzSub', code: TILDE, size: 1, allowWhitespace: false },
]

function delimiterConstruct(spec: DelimiterSpec) {
  const temporary = `${spec.name}SequenceTemporary` as const
  const sequence = `${spec.name}Sequence` as const
  const textType = `${spec.name}Text` as const

  const resolveAllDelimiter: Resolver = function (events, context) {
    let index = -1
    while (++index < events.length) {
      const closer = events[index]
      if (closer[0] !== 'enter' || closer[1].type !== temporary || !closer[1]._tzClose) continue
      let open = index
      while (open--) {
        const opener = events[open]
        if (opener[0] !== 'exit' || opener[1].type !== temporary || !opener[1]._tzOpen) continue
        if (!spec.allowWhitespace) {
          const inner = context.sliceSerialize({ start: opener[1].end, end: closer[1].start })
          if (/\s/.test(inner) || inner.length === 0) continue
        }
        closer[1].type = sequence
        opener[1].type = sequence
        const whole: Token = {
          type: spec.name,
          start: Object.assign({}, opener[1].start),
          end: Object.assign({}, closer[1].end),
        }
        const text: Token = {
          type: textType,
          start: Object.assign({}, opener[1].end),
          end: Object.assign({}, closer[1].start),
        }
        const next: Event[] = [
          ['enter', whole, context],
          ['enter', opener[1], context],
          ['exit', opener[1], context],
          ['enter', text, context],
        ]
        const insideSpan = context.parser.constructs.insideSpan.null
        if (insideSpan) {
          splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context))
        }
        splice(next, next.length, 0, [
          ['exit', text, context],
          ['enter', closer[1], context],
          ['exit', closer[1], context],
          ['exit', whole, context],
        ])
        splice(events, open - 1, index - open + 3, next)
        index = open + next.length - 2
        break
      }
    }
    for (const event of events) {
      if (event[1].type === temporary) event[1].type = 'data'
    }
    return events
  }

  const tokenize: Tokenizer = function (this: TokenizeContext, effects, ok, nok) {
    const previous = this.previous
    const events = this.events
    let size = 0

    const start: State = (code) => {
      // 前一个字符也是同一定界符(且不是转义出来的),说明序列从更前面开始,不在这里切
      if (previous === spec.code && events[events.length - 1][1].type !== 'characterEscape') {
        return nok(code)
      }
      effects.enter(temporary)
      return more(code)
    }

    const more: State = (code) => {
      const before = classifyCharacter(previous)
      if (code === spec.code) {
        // 序列超长(如 === 或 ~~,后者交给 GFM 删除线)不是本语法
        if (size >= spec.size) return nok(code)
        effects.consume(code)
        size++
        return more
      }
      if (size !== spec.size) return nok(code)
      const token = effects.exit(temporary)
      const after = classifyCharacter(code)
      token._tzOpen = !after || (after === 2 && Boolean(before))
      token._tzClose = !before || (before === 2 && Boolean(after))
      return ok(code)
    }

    return start
  }

  return { name: spec.name, tokenize, resolveAll: resolveAllDelimiter }
}

/** 三种语法各自的识别开关(Typora 偏好 PM-08 ~ PM-10)。 */
export interface TyporaSyntaxFlags {
  highlight: boolean
  superscript: boolean
  subscript: boolean
}

const ALL_ON: TyporaSyntaxFlags = { highlight: true, superscript: true, subscript: true }

/** micromark 扩展:三种定界语法,只装开着的那几种(关掉的按普通文字解析)。 */
export function typoraInlineSyntax(flags: TyporaSyntaxFlags = ALL_ON): Extension {
  const enabled = SPECS.filter((s) => (s.name === 'tzMark' ? flags.highlight : s.name === 'tzSup' ? flags.superscript : flags.subscript))
  const constructs = enabled.map(delimiterConstruct)
  const text: ConstructRecord = {}
  enabled.forEach((spec, i) => {
    text[spec.code] = constructs[i]
  })
  return {
    text,
    insideSpan: { null: constructs },
    attentionMarkers: { null: enabled.map((s) => s.code) },
  }
}

const MDAST_TYPE = { tzMark: 'mark', tzSup: 'superscript', tzSub: 'subscript' } as const

/** mdast-util-from-markdown 扩展:分词 → mdast 节点。 */
export function typoraInlineFromMarkdown(): FromMarkdownExtension {
  const enter: Record<string, (this: CompileContext, token: MdToken) => undefined> = {}
  const exit: Record<string, (this: CompileContext, token: MdToken) => undefined> = {}
  for (const spec of SPECS) {
    const type = MDAST_TYPE[spec.name]
    enter[spec.name] = function (token) {
      this.enter({ type, children: [] } as Mark | Superscript | Subscript, token)
    }
    exit[spec.name] = function (token) {
      this.exit(token)
    }
  }
  return { canContainEols: ['mark'], enter, exit }
}

// 与 mdast-util-gfm-strikethrough 一致:这些语境里定界符没有格式含义,无需转义
const constructsWithoutAttention: ConstructName[] = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe',
]

function wrapHandle(sequence: string, construct: ConstructName): Handle {
  return (node: Parent, _parent, state, info) => {
    const tracker = state.createTracker(info)
    const exit = state.enter(construct)
    let value = tracker.move(sequence)
    value += state.containerPhrasing(node as Mark, {
      ...tracker.current(),
      before: value,
      after: sequence.charAt(0),
    })
    value += tracker.move(sequence)
    exit()
    return value
  }
}

/** mdast-util-to-markdown 扩展:mdast 节点 → 文本,并给字面量定界符加转义。 */
export function typoraInlineToMarkdown(): ToMarkdownExtension {
  const unsafe: Unsafe[] = [
    // 只转义成对的 ==;单个 = 在正文里很常见(a = b),不该被转义
    { character: '=', after: '=', inConstruct: 'phrasing', notInConstruct: constructsWithoutAttention },
    { character: '^', inConstruct: 'phrasing', notInConstruct: constructsWithoutAttention },
  ]
  return {
    handlers: {
      mark: wrapHandle('==', 'tzMark'),
      superscript: wrapHandle('^', 'tzSup'),
      subscript: wrapHandle('~', 'tzSub'),
    },
    unsafe,
  }
}
