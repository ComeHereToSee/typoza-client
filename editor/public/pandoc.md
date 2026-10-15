# 安装与使用 Pandoc

PDF、HTML、图片三种格式 Typoza 自己就能导出。导出 Word(.docx)、OpenOffice(.odt)、RTF、Epub、LaTeX、Media Wiki、reStructuredText、Textile、OPML,以及「文件 → 导入…」,需要先在这台 Mac 上安装 Pandoc。Typoza 只调用你装好的 Pandoc,不自带、不联网下载。

## 安装

任选一种:

- 用 Homebrew:在「终端」里运行 `brew install pandoc`
- 用官方安装包:到 Pandoc 官网的安装页面(https://pandoc.org/installing.html)下载 macOS 安装包,双击安装

装好后在「终端」里运行 `pandoc --version`,能看到版本号就说明装好了。

## 让 Typoza 找到 Pandoc

Typoza 会自动在常见位置查找(如 `/opt/homebrew/bin/pandoc`、`/usr/local/bin/pandoc`)。装在别处时,打开「偏好设置 → 导出」,在「Pandoc 路径」里填写完整路径。

## 使用

- 导出:「文件 → 导出」里选格式,选好保存位置即可
- 导入:「文件 → 导入…」选择 Word、HTML、Epub 等文件,Typoza 用 Pandoc 转成 Markdown,存在原文件旁边并打开;文件里的图片放进同一文件夹的 `assets`
