import { describe, expect, it } from 'vitest'
import { flowToMermaid, sequenceToMermaid } from '../../src/views/diagram-syntax'
import { toMermaid } from '../../src/views/diagram'
import { PHYSICS_MACROS, equationLabels, numberDisplayTex, resolveRefs, stripLabels, syncPhysicsMacros } from '../../src/views/math-tex'

describe('sequence 图转 Mermaid(对照表 X-42)', () => {
  it('参与者、四种箭头、备注与标题', () => {
    const out = sequenceToMermaid(
      ['Title: 登录', 'participant 浏览器', 'Note left of 浏览器: 用户打开', '浏览器->服务端: 请求', '服务端-->浏览器: 页面', '浏览器->>服务端: 异步', '服务端-->>浏览器: 回调', 'Note over 浏览器,服务端: 结束'].join('\n'),
    )
    expect(out).toBe(
      [
        '---',
        'title: "登录"',
        '---',
        'sequenceDiagram',
        '  participant P1 as 浏览器',
        '  participant P2 as 服务端',
        '  Note left of P1: 用户打开',
        '  P1->>P2: 请求',
        '  P2-->>P1: 页面',
        '  P1-)P2: 异步',
        '  P2--)P1: 回调',
        '  Note over P1,P2: 结束',
        '',
      ].join('\n'),
    )
  })

  it('participant 名字 as 别名:连线用别名', () => {
    expect(sequenceToMermaid('participant "长名字" as A\nA->B: 你好')).toBe('sequenceDiagram\n  participant P1 as 长名字\n  participant P2 as B\n  P1->>P2: 你好\n')
  })

  it('\\n 换行、分号与 # 转义;无法识别的行报错', () => {
    expect(sequenceToMermaid('A->B: 第一行\\n第二行;#1')).toContain('P1->>P2: 第一行<br/>第二行#59;#35;1')
    expect(() => sequenceToMermaid('这不是语法')).toThrow('第 1 行无法识别')
  })
})

describe('flow 图转 Mermaid', () => {
  it('节点形状、判断分支标签、链接与状态去掉', () => {
    const out = flowToMermaid(
      ['st=>start: 开始:>http://example.com[blank]', 'op=>operation: 处理|past', 'cond=>condition: 通过?', 'e=>end: 结束', '', 'st->op->cond', 'cond(yes)->e', 'cond(no, right)->op'].join('\n'),
    )
    expect(out).toBe(
      [
        'flowchart TD',
        '  n1(["开始"])',
        '  n2["处理"]',
        '  n3{"通过?"}',
        '  n4(["结束"])',
        '  n1 --> n2',
        '  n2 --> n3',
        '  n3 -->|yes| n4',
        '  n3 -->|no| n2',
        '',
      ].join('\n'),
    )
  })

  it('未定义的节点按名字显示;未知类型报错', () => {
    expect(flowToMermaid('a->b')).toContain('n1["a"]')
    expect(() => flowToMermaid('x=>circle: 圆')).toThrow('节点类型无法识别')
  })

  it('mermaid 原样渲染,sequence / flow 先转换', () => {
    expect(toMermaid('mermaid', 'graph TD; A-->B')).toBe('graph TD; A-->B')
    expect(toMermaid('SEQUENCE', 'A->B: x')).toContain('sequenceDiagram')
  })
})

describe('公式选项(PRD 3.7,对照表 PM-20~PM-22)', () => {
  it('不编号:只认手写 \\tag', () => {
    const labels = equationLabels(['a \\tag{★} \\label{s}', '\\begin{equation} b \\label{e} \\end{equation}'], 'none')
    expect(labels.get('s')).toBe('★')
    expect(labels.has('e')).toBe(false)
  })

  it('AMS:编号环境按行编号,\\notag 与带星号的不编号', () => {
    const labels = equationLabels(
      ['x = 1', '\\begin{align} a \\label{a1} \\\\ b \\notag \\\\ c \\label{a3} \\end{align}', '\\begin{equation*} d \\end{equation*}', '\\begin{equation} e \\label{e} \\end{equation}'],
      'ams',
    )
    expect(labels.get('a1')).toBe('1')
    expect(labels.get('a3')).toBe('2')
    expect(labels.get('e')).toBe('3')
  })

  it('全部编号:每个块公式各编一个号,并包进 equation 环境', () => {
    const labels = equationLabels(['x \\label{x}', 'y \\label{y}'], 'all')
    expect([labels.get('x'), labels.get('y')]).toEqual(['1', '2'])
    expect(numberDisplayTex('x', 'all')).toBe('\\begin{equation}x\\end{equation}')
    expect(numberDisplayTex('a \\\\ b', 'all')).toBe('\\begin{equation}\\begin{gathered}a \\\\ b\\end{gathered}\\end{equation}')
    expect(numberDisplayTex('x \\tag{1}', 'all')).toBe('x \\tag{1}')
    expect(numberDisplayTex('\\newcommand{\\R}{\\mathbb{R}}', 'all')).toBe('\\newcommand{\\R}{\\mathbb{R}}')
    expect(numberDisplayTex('x', 'ams')).toBe('x')
  })

  it('\\ref 与 \\eqref 换成编号,找不到显示 ??;\\label 去掉', () => {
    const labels = new Map([['e', '3']])
    expect(resolveRefs('见 \\ref{e} 与 \\eqref{e},\\ref{无}', labels)).toBe('见 \\text{3} 与 \\text{(3)},\\text{??}')
    expect(stripLabels('a \\label{x} b')).toBe('a  b')
  })

  it('physics 宏按开关加入或移除,不动用户同名定义', () => {
    const macros: Record<string, string> = { '\\abs': '用户定义' }
    syncPhysicsMacros(macros, true)
    expect(macros['\\abs']).toBe('用户定义')
    expect(macros['\\dv']).toBe(PHYSICS_MACROS['\\dv'])
    syncPhysicsMacros(macros, false)
    expect(macros['\\dv']).toBeUndefined()
    expect(macros['\\abs']).toBe('用户定义')
  })
})
