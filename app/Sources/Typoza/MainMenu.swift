import AppKit

/// 菜单栏(结构对照 Typora,快捷键按 docs/prd/notion-input.md 第五节定稿)。
/// 绝大多数菜单项把命令 ID 发给当前窗口的网页(编辑器命令注册表同名);少数由原生直接处理(native.*)。
enum MainMenu {
    private static func key(_ scalar: Int) -> String {
        String(Character(UnicodeScalar(UInt16(scalar))!))
    }

    static let up = key(NSUpArrowFunctionKey)
    static let down = key(NSDownArrowFunctionKey)
    static let f8 = key(NSF8FunctionKey)
    static let f9 = key(NSF9FunctionKey)

    /// 发给网页的命令项。key 为空表示没有快捷键。
    static func cmd(_ title: String, _ id: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(AppDelegate.menuCommand(_:)), keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        item.representedObject = id
        return item
    }

    /// 走 AppKit 标准动作的项(撤销、剪切、拷贝……交给 WKWebView 自己处理)。
    static func std(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        return item
    }

    static func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        for i in items { menu.addItem(i) }
        item.submenu = menu
        return item
    }

    static var sep: NSMenuItem { .separator() }

    static func build(recentMenu: NSMenu, windowMenu: NSMenu, helpMenu: NSMenu) -> NSMenu {
        let main = NSMenu(title: "主菜单")

        let appMenu = submenu("Typoza", [
            std("关于 Typoza", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            sep,
            cmd("偏好设置…", "app.preferences", ","),
            cmd("云同步…", "app.syncPreferences"),
            sep,
            std("隐藏 Typoza", #selector(NSApplication.hide(_:)), "h"),
            std("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            std("全部显示", #selector(NSApplication.unhideAllApplications(_:))),
            sep,
            std("退出 Typoza", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recent = NSMenuItem(title: "打开最近使用", action: nil, keyEquivalent: "")
        recent.submenu = recentMenu
        let exportMenu = submenu("导出", [
            cmd("PDF", "file.export.pdf"),
            cmd("HTML", "file.export.html"),
            cmd("HTML(无样式)", "file.export.html-plain"),
            cmd("图像", "file.export.image"),
            sep,
            cmd("Word(.docx)", "file.export.docx"),
            cmd("OpenOffice(.odt)", "file.export.odt"),
            cmd("RTF", "file.export.rtf"),
            cmd("Epub", "file.export.epub"),
            cmd("LaTeX", "file.export.latex"),
            cmd("Media Wiki", "file.export.mediawiki"),
            cmd("reStructuredText", "file.export.rst"),
            cmd("Textile", "file.export.textile"),
            cmd("OPML", "file.export.opml"),
        ])
        let file = submenu("文件", [
            cmd("新建", "native.newWindow", "n"),
            cmd("新建标签页", "native.newTab", "t"),
            cmd("新建窗口", "native.newWindow", "n", [.command, .shift]),
            sep,
            cmd("打开…", "native.open", "o"),
            cmd("打开文件夹…", "file.openFolder"),
            cmd("快速打开…", "file.quickOpen", "p"),
            recent,
            cmd("重新打开关闭的文件", "native.reopenClosed", "t", [.command, .shift]),
            sep,
            cmd("保存", "file.save", "s"),
            cmd("另存为…", "file.saveAs", "s", [.command, .option, .shift]),
            cmd("全部保存", "native.saveAll", "s", [.command, .option]),
            cmd("浏览所有版本…", "file.history"),
            cmd("从磁盘重新载入", "file.reload"),
            cmd("以其它编码重新打开…", "file.reopenWithEncoding"),
            sep,
            cmd("复制当前文档路径", "file.copyPath", "l"),
            cmd("在 Finder 中显示", "file.revealInFinder"),
            sep,
            cmd("导入…", "native.import"),
            exportMenu,
            cmd("打印…", "file.print", "p", [.command, .shift]),
            sep,
            std("关闭", #selector(NSWindow.performClose(_:)), "w"),
        ])

        let edit = submenu("编辑", [
            std("撤销", Selector(("undo:")), "z"),
            std("重做", Selector(("redo:")), "z", [.command, .shift]),
            sep,
            std("剪切", #selector(NSText.cut(_:)), "x"),
            std("拷贝", #selector(NSText.copy(_:)), "c"),
            std("粘贴", #selector(NSText.paste(_:)), "v"),
            std("粘贴为纯文本", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .shift]),
            submenu("复制 / 粘贴为", [
                cmd("复制为 Markdown", "edit.copyMarkdown", "c", [.command, .shift]),
                cmd("复制为 HTML 代码", "edit.copyHtml"),
                cmd("复制为纯文本", "edit.copyPlain"),
            ]),
            std("删除", #selector(NSText.delete(_:))),
            std("全选", #selector(NSText.selectAll(_:)), "a"),
            sep,
            submenu("选择", [
                cmd("选中当前块", "block.select", "p", [.command, .option]),
                cmd("选中当前行或句", "select.line", "l", [.control, .command]),
                cmd("选中当前格式文本", "select.format", "e", [.control, .command]),
                cmd("选中当前词", "select.word", "w", [.control, .command]),
            ]),
            submenu("删除", [
                cmd("删除当前块", "block.delete", "p", [.command, .option, .shift]),
                cmd("删除当前行或句", "delete.line", "l", [.command, .option, .shift]),
                cmd("删除当前格式文本", "delete.format", "e", [.command, .option, .shift]),
                cmd("删除当前词", "delete.word", "d", [.command, .shift]),
            ]),
            cmd("跳转到所选内容", "edit.jumpToSelection", "j"),
            sep,
            submenu("查找", [
                cmd("查找…", "find.open", "f"),
                cmd("查找下一个", "find.next", "g"),
                cmd("查找上一个", "find.prev", "g", [.command, .shift]),
                cmd("查找和替换…", "find.replace", "f", [.command, .option]),
                cmd("替换下一个", "find.replaceNext", "e", [.command, .option]),
                sep,
                cmd("在文件夹中搜索…", "view.search", "f", [.command, .shift]),
            ]),
            submenu("拼写和语法", [
                std("显示拼写和语法", #selector(NSText.showGuessPanel(_:)), ":"),
                std("立即检查文稿", #selector(NSText.checkSpelling(_:)), ";"),
                std("键入时检查拼写", #selector(NSTextView.toggleContinuousSpellChecking(_:))),
            ]),
            std("表情与符号", #selector(NSApplication.orderFrontCharacterPalette(_:)), " ", [.control, .command]),
            submenu("语音", [
                std("开始朗读", #selector(NSTextView.startSpeaking(_:))),
                std("停止朗读", #selector(NSTextView.stopSpeaking(_:))),
            ]),
        ])

        let paragraph = submenu("段落", [
            cmd("正文", "block.paragraph", "0"),
            cmd("一级标题", "block.h1", "1"),
            cmd("二级标题", "block.h2", "2"),
            cmd("三级标题", "block.h3", "3"),
            cmd("四级标题", "block.h4", "4"),
            cmd("五级标题", "block.h5", "5"),
            cmd("六级标题", "block.h6", "6"),
            cmd("提升标题级别", "block.headingUp", "=", [.control, .command]),
            cmd("降低标题级别", "block.headingDown", "-", [.control, .command]),
            sep,
            submenu("表格", [
                cmd("插入表格", "insert.table", "t", [.command, .option, .shift]),
                sep,
                cmd("上方插入行", "table.rowAbove"),
                cmd("下方插入行", "table.rowBelow"),
                cmd("左侧插入列", "table.colLeft"),
                cmd("右侧插入列", "table.colRight"),
                sep,
                cmd("上移该行", "table.moveRowUp"),
                cmd("下移该行", "table.moveRowDown"),
                cmd("左移该列", "table.moveColLeft"),
                cmd("右移该列", "table.moveColRight"),
                sep,
                cmd("删除行", "table.deleteRow"),
                cmd("删除列", "table.deleteCol"),
                sep,
                cmd("调整行列数", "table.resize"),
                cmd("复制表格", "table.copy"),
                cmd("格式化表格源码", "table.formatSource"),
                cmd("删除表格", "table.delete"),
            ]),
            cmd("代码块", "block.code", "c", [.command, .option]),
            submenu("代码工具", [
                cmd("为选中内容调整缩进", "code.indentSelection"),
                cmd("为整个代码块调整缩进", "code.indentBlock"),
            ]),
            cmd("公式块", "block.math", "b", [.command, .option]),
            cmd("引用", "block.quote", "q", [.command, .option]),
            cmd("标注块", "insert.callout"),
            submenu("警告框", [
                cmd("提醒内容", "insert.callout.note"),
                cmd("建议内容", "insert.callout.tip"),
                cmd("重要内容", "insert.callout.important"),
                cmd("警告内容", "insert.callout.warning"),
                cmd("注意内容", "insert.callout.caution"),
            ]),
            cmd("折叠块", "block.toggle", "7", [.command, .option]),
            sep,
            cmd("有序列表", "block.numbered", "o", [.command, .option]),
            cmd("无序列表", "block.bullet", "u", [.command, .option]),
            cmd("任务列表", "block.todo", "x", [.command, .option]),
            cmd("切换任务状态", "block.toggleCheck"),
            cmd("增加缩进", "block.indent"),
            cmd("减少缩进", "block.outdent"),
            sep,
            cmd("在上方插入段落", "block.paragraphBefore"),
            cmd("在下方插入段落", "block.paragraphAfter"),
            sep,
            cmd("链接引用", "insert.linkReference", "l", [.command, .option]),
            cmd("脚注", "insert.footnote", "r", [.command, .option]),
            cmd("水平分割线", "insert.divider", "-", [.command, .option]),
            cmd("内容目录", "insert.toc"),
            cmd("YAML Front Matter", "insert.frontMatter"),
            sep,
            cmd("转换为…", "block.turnIntoMenu", "/"),
            cmd("创建块副本", "block.duplicate", "d"),
            cmd("上移块", "block.moveUpSelected", up, [.command, .shift]),
            cmd("下移块", "block.moveDownSelected", down, [.command, .shift]),
            cmd("全部展开 / 收起折叠块", "block.toggleAllFolds", "t", [.command, .option]),
            cmd("把当前块转为新文档", "block.toDocument", "9", [.command, .option]),
        ])

        let format = submenu("格式", [
            cmd("加粗", "format.bold", "b"),
            cmd("斜体", "format.italic", "i"),
            cmd("下划线", "format.underline", "u"),
            cmd("删除线", "format.strike", "s", [.command, .shift]),
            cmd("行内代码", "format.code", "e"),
            cmd("行内公式", "format.inlineMath", "e", [.command, .shift]),
            cmd("高亮", "format.highlight", "h", [.control, .command]),
            cmd("上标", "format.superscript"),
            cmd("下标", "format.subscript"),
            cmd("注释", "insert.comment", "-", [.control]),
            sep,
            cmd("超链接", "format.link", "k"),
            cmd("插入图片…", "insert.image", "i", [.control, .command]),
            sep,
            cmd("应用上次使用的颜色", "format.lastColor", "h", [.command, .shift]),
            cmd("清除样式", "format.clear", "\\"),
        ])

        let view = submenu("视图", [
            cmd("源代码模式", "view.sourceMode", "/", [.control, .command]),
            sep,
            cmd("显示 / 隐藏侧边栏", "view.toggleSidebar", "s", [.control, .command]),
            cmd("大纲", "view.outline", "1", [.control, .command]),
            cmd("文档列表", "view.docList", "2", [.control, .command]),
            cmd("文件树", "view.fileTree", "3", [.control, .command]),
            sep,
            cmd("专注模式", "view.focusMode", f8, []),
            cmd("打字机模式", "view.typewriterMode", f9, []),
            cmd("显示状态栏", "view.statusBar"),
            cmd("字数统计", "view.wordCount"),
            cmd("切换页面宽度", "view.pageWidth"),
            sep,
            cmd("实际大小", "view.zoomReset", "0", [.command, .shift]),
            cmd("放大", "view.zoomIn", "="),
            cmd("缩小", "view.zoomOut", "-"),
            sep,
            cmd("切换浅色 / 深色", "view.toggleDark", "l", [.command, .shift]),
            std("切换全屏", #selector(NSWindow.toggleFullScreen(_:)), "f", [.control, .command]),
            cmd("保持窗口在最前端", "native.alwaysOnTop"),
        ])

        let theme = submenu("主题", [
            cmd("Typoza", "theme.typoza"),
            cmd("GitHub", "theme.github"),
            cmd("Newsprint", "theme.newsprint"),
            cmd("Night", "theme.night"),
            cmd("Whitey", "theme.whitey"),
        ])

        let window = NSMenuItem(title: "窗口", action: nil, keyEquivalent: "")
        windowMenu.addItem(std("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"))
        windowMenu.addItem(std("缩放", #selector(NSWindow.performZoom(_:))))
        windowMenu.addItem(sep)
        windowMenu.addItem(std("前置全部窗口", #selector(NSApplication.arrangeInFront(_:))))
        window.submenu = windowMenu

        let help = NSMenuItem(title: "帮助", action: nil, keyEquivalent: "")
        helpMenu.addItem(cmd("快速上手", "native.welcome", "?"))
        help.submenu = helpMenu

        for item in [appMenu, file, edit, paragraph, format, view, theme, window, help] { main.addItem(item) }
        return main
    }
}
