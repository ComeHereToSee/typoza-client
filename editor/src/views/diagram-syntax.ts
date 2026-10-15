// Typora 的 ```sequence(js-sequence-diagrams 写法)与 ```flow(flowchart.js 写法)转成 Mermaid,
// 由已有的 Mermaid 渲染,不再引两个旧库(对照表 X-42、PRD 3.7「图表」)。只转换显示,文件里仍是原写法。
// 无法识别的行直接报错(显示为「语法错误」并保留源码)。

/** Mermaid 文字里会被当作语法的字符改成实体;js-sequence 的「\n」是换行。 */
function mermaidText(s: string): string {
  return s
    .trim()
    .replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;'))
    .replace(/\\n/g, '<br/>')
}

function unquote(s: string): string {
  const t = s.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
}

const SEQUENCE_ARROWS: Record<string, string> = {
  // 实线实心箭头 / 虚线实心箭头 / 实线空心箭头 / 虚线空心箭头
  '->': '->>',
  '-->': '-->>',
  '->>': '-)',
  '-->>': '--)',
}

export function sequenceToMermaid(code: string): string {
  const ids = new Map<string, string>()
  const declared: string[] = []
  const body: string[] = []
  let title: string | null = null
  const declare = (key: string, display: string): string => {
    let id = ids.get(key)
    if (!id) {
      id = `P${ids.size + 1}`
      ids.set(key, id)
      declared.push(`  participant ${id} as ${mermaidText(display)}`)
    }
    return id
  }
  const actor = (name: string) => declare(unquote(name), unquote(name))
  for (const [i, raw] of code.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let m: RegExpExecArray | null
    if ((m = /^title\s*:\s*(.*)$/i.exec(line))) {
      title = m[1].trim()
    } else if ((m = /^participant\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line))) {
      // participant 名字 as 别名:连线里用别名,图上显示名字
      const display = unquote(m[1])
      declare(m[2] ? unquote(m[2]) : display, display)
    } else if ((m = /^note\s+(left of|right of)\s+([^:]+?)\s*:\s*(.*)$/i.exec(line))) {
      body.push(`  Note ${m[1].toLowerCase()} ${actor(m[2])}: ${mermaidText(m[3])}`)
    } else if ((m = /^note\s+over\s+([^:]+?)\s*:\s*(.*)$/i.exec(line))) {
      body.push(`  Note over ${m[1].split(',').map(actor).join(',')}: ${mermaidText(m[2])}`)
    } else if ((m = /^([^-:>]+?)\s*(-->>|->>|-->|->)\s*([^:]+?)\s*(?::\s*(.*))?$/.exec(line))) {
      body.push(`  ${actor(m[1])}${SEQUENCE_ARROWS[m[2]]}${actor(m[3])}: ${mermaidText(m[4] ?? '')}`)
    } else {
      throw new Error(`第 ${i + 1} 行无法识别:${line}`)
    }
  }
  const head = title !== null ? `---\ntitle: ${JSON.stringify(title)}\n---\n` : ''
  return `${head}sequenceDiagram\n${[...declared, ...body].join('\n')}\n`
}

/** flowchart.js 节点类型 → Mermaid 形状的左右括号。 */
const FLOW_SHAPES: Record<string, [string, string]> = {
  start: ['([', '])'],
  end: ['([', '])'],
  operation: ['[', ']'],
  subroutine: ['[[', ']]'],
  condition: ['{', '}'],
  inputoutput: ['[/', '/]'],
  parallel: ['[', ']'],
}

function quoted(text: string): string {
  return `"${text.replace(/"/g, '#quot;')}"`
}

export function flowToMermaid(code: string): string {
  const ids = new Map<string, string>()
  const types = new Map<string, string>()
  const nodes: string[] = []
  const edges: string[] = []
  // flowchart.js 的节点名可能是 Mermaid 保留字(如 end),一律换成 n1、n2……
  const idOf = (name: string): string => {
    let id = ids.get(name)
    if (!id) {
      id = `n${ids.size + 1}`
      ids.set(name, id)
    }
    return id
  }
  for (const [i, raw] of code.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line) continue
    const def = /^([^=\s]+)\s*=>\s*(\w+)\s*:\s*(.*)$/.exec(line)
    if (def) {
      const [, name, type, rest] = def
      const shape = FLOW_SHAPES[type]
      if (!shape) throw new Error(`第 ${i + 1} 行节点类型无法识别:${type}`)
      // 去掉链接「:>网址[blank]」与状态「|past」
      const text = rest.replace(/:>.*$/, '').replace(/\|\w+$/, '').trim()
      types.set(name, type)
      nodes.push(`  ${idOf(name)}${shape[0]}${quoted(text)}${shape[1]}`)
      continue
    }
    if (line.includes('->')) {
      const steps = line.split('->').map((s) => {
        const m = /^([^(\s]+)\s*(?:\(([^)]*)\))?$/.exec(s.trim())
        if (!m) throw new Error(`第 ${i + 1} 行连线无法识别:${line}`)
        return { name: m[1], args: (m[2] ?? '').split(',').map((a) => a.trim()).filter(Boolean) }
      })
      for (let k = 0; k + 1 < steps.length; k++) {
        const from = steps[k]
        const to = steps[k + 1]
        // 判断框的出边标 yes / no;方向参数(left、right、bottom、top)只影响布局,忽略
        const label = types.get(from.name) === 'condition' && from.args[0] && !/^(left|right|top|bottom)$/.test(from.args[0]) ? from.args[0] : null
        edges.push(`  ${idOf(from.name)} -->${label ? `|${mermaidText(label)}|` : ''} ${idOf(to.name)}`)
      }
      continue
    }
    throw new Error(`第 ${i + 1} 行无法识别:${line}`)
  }
  // 连线里用到但没定义的节点:按名字显示
  for (const [name, id] of ids) if (!types.has(name)) nodes.push(`  ${id}[${quoted(name)}]`)
  return `flowchart TD\n${[...nodes, ...edges].join('\n')}\n`
}
