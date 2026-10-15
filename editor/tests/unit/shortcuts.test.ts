// 快捷键表与自定义(PRD 3.13 快捷键页;notion-input 一「键位总则」)。
import { describe, expect, it } from 'vitest'
import {
  MENU_KEYS,
  appKeyTable,
  assignKey,
  clearCommandKeys,
  commandLabel,
  commandRows,
  displayKey,
  editorKeybindings,
  effectiveKeyTable,
  keyOwner,
  keysOf,
  menuKeyOverrides,
  normalizeKey,
} from '../../src/app/shortcuts'
import { DEFAULT_KEYS } from '../../src/core/keymap'

describe('键名', () => {
  it('统一修饰键顺序与大小写', () => {
    expect(normalizeKey('Shift-Mod-S')).toBe('Mod-Shift-s')
    expect(normalizeKey('Alt-Ctrl-Cmd-x')).toBe('Ctrl-Mod-Alt-x')
    expect(normalizeKey('Mod--')).toBe('Mod--')
    expect(normalizeKey(' ')).toBe('Space')
    expect(() => normalizeKey('Hyper-x')).toThrow('无法识别的修饰键')
  })

  it('显示成菜单写法(⌃⌥⇧⌘)', () => {
    expect(displayKey('Mod-Shift-s')).toBe('⇧⌘S')
    expect(displayKey('Ctrl-Mod-ArrowUp')).toBe('⌃⌘↑')
    expect(displayKey('Mod-Alt-Shift-t')).toBe('⌥⇧⌘T')
    expect(displayKey('F8')).toBe('F8')
    expect(displayKey('Mod--')).toBe('⌘-')
  })

  it('编辑区键位与菜单键位同一个键指向同一个命令', () => {
    for (const [key, id] of Object.entries(MENU_KEYS)) {
      const editor = Object.entries(DEFAULT_KEYS).find(([k]) => normalizeKey(k) === normalizeKey(key))
      if (editor) expect(editor[1], key).toBe(id)
    }
  })
})

describe('自定义键位', () => {
  it('冲突就地提示占用者;系统保留键不能用', () => {
    const table = effectiveKeyTable({})
    expect(table.get('Mod-b')).toBe('format.bold')
    expect(keyOwner(table, 'Mod-b', 'format.italic')).toEqual({ label: '加粗', reserved: false })
    expect(keyOwner(table, 'Mod-b', 'format.bold')).toBeNull()
    expect(keyOwner(table, 'Mod-q', 'format.bold')).toEqual({ label: '退出 Typoza', reserved: true })
    expect(keyOwner(table, 'Mod-Alt-z', 'format.bold')).toBeNull()
  })

  it('录制新键位:原有键位取消,占用该键的命令改为无键位', () => {
    const custom = assignKey({}, 'format.bold', 'Mod-i')
    expect(custom).toEqual({ 'Mod-b': '', 'Mod-i': 'format.bold' })
    const table = effectiveKeyTable(custom)
    expect(keysOf(table, 'format.bold')).toEqual(['Mod-i'])
    expect(keysOf(table, 'format.italic')).toEqual([])
  })

  it('再次录制:去掉上次自定义的键;清除键位', () => {
    const once = assignKey({}, 'format.bold', 'Mod-Alt-z')
    const twice = assignKey(once, 'format.bold', 'Ctrl-Mod-b')
    expect(twice).toEqual({ 'Mod-b': '', 'Ctrl-Mod-b': 'format.bold' })
    expect(clearCommandKeys(twice, 'format.bold')).toEqual({ 'Mod-b': '' })
  })

  it('原生菜单只收到与出厂不同的命令', () => {
    expect(menuKeyOverrides({})).toEqual([])
    const overrides = menuKeyOverrides(assignKey({}, 'format.bold', 'Mod-i')).sort((a, b) => a.id.localeCompare(b.id))
    expect(overrides).toEqual([
      { id: 'format.bold', key: 'Mod-i' },
      { id: 'format.italic', key: '' },
    ])
  })

  it('浏览器里的应用级键位跟着自定义走;native.* 不交给编辑器键位表', () => {
    expect(appKeyTable({}).get('Mod-s')).toBe('file.save')
    const moved = appKeyTable({ 'Mod-s': '', 'Mod-Alt-k': 'file.save' })
    expect(moved.get('Mod-s')).toBeUndefined()
    expect(moved.get('Mod-Alt-k')).toBe('file.save')
    // 键位改给了编辑区命令:由编辑器键位表处理
    expect(appKeyTable({ 'Mod-p': 'format.bold' }).get('Mod-p')).toBeUndefined()
    expect(editorKeybindings({ 'Mod-t': 'native.newTab', 'Mod-b': '', 'Mod-k': 'format.bold' })).toEqual({ 'Mod-b': '', 'Mod-k': 'format.bold' })
  })

  it('快捷键页列出全部命令,含只在外壳里的命令', () => {
    const rows = commandRows({})
    expect(rows.find((r) => r.id === 'native.newTab')).toEqual({ id: 'native.newTab', label: '新建标签页', keys: ['Mod-t'] })
    expect(rows.find((r) => r.id === 'format.bold')?.keys).toEqual(['Mod-b'])
    // 注册表里名字太简略的命令换成能看懂的名字
    expect(commandLabel('view.outline')).toBe('大纲')
  })
})
