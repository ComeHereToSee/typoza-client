// 构建期虚拟模块的类型(见 build/emoji-data.ts)。
declare module 'virtual:tz-emoji' {
  /** [字符, 英文名, 中文名, 关键词(小写、空格分隔), GitHub 短码, 分组] */
  const rows: [string, string, string, string, string[], number][]
  export default rows
}
