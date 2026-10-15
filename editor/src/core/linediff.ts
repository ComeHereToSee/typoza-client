// 行级差分:冲突副本并排对比用。先去掉首尾相同的行,中间段做 LCS;中间段过大时返回 null(调用方不标注差异)。

export interface DiffRow {
  /** 左侧(原文件)这一行;null 表示左侧此处无对应行 */
  left: string | null
  right: string | null
  kind: 'same' | 'changed'
}

const MAX_CELLS = 4_000_000

export function diffRows(leftText: string, rightText: string): DiffRow[] | null {
  const a = leftText.split('\n')
  const b = rightText.split('\n')
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const am = a.slice(pre, a.length - suf)
  const bm = b.slice(pre, b.length - suf)
  const n = am.length
  const m = bm.length
  if ((n + 1) * (m + 1) > MAX_CELLS) return null

  // lcs[i][j] = am[i..] 与 bm[j..] 的最长公共子序列长度
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }

  const rows: DiffRow[] = a.slice(0, pre).map((line) => ({ left: line, right: line, kind: 'same' }))
  // 相邻的删除与新增配成同一行,方便左右对照
  let dels: string[] = []
  let adds: string[] = []
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null, kind: 'changed' })
    dels = []
    adds = []
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      flush()
      rows.push({ left: am[i], right: bm[j], kind: 'same' })
      i++
      j++
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      dels.push(am[i++])
    } else {
      adds.push(bm[j++])
    }
  }
  flush()
  for (const line of a.slice(a.length - suf)) rows.push({ left: line, right: line, kind: 'same' })
  return rows
}
