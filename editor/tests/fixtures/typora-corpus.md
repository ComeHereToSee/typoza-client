---
title: 语料
icon: 📘
typora-root-url: ./
---

# 一级标题

[TOC]

普通段落,**加粗**、*斜体*、~~删除线~~、`行内代码`、==高亮==、x^2^、H~2~O、<u>下划线</u>、<span style="color: #D44C47">红字</span>。

带链接 [Typoza](https://example.com "标题") 与裸网址 https://example.com/path 以及 <https://example.org>。

引用式链接 [文档][doc] 与图片 ![图](./assets/a.png "说明")。

[doc]: https://example.com/doc "文档标题"

<img src="assets/b.png" alt="缩放图" style="zoom:50%;" />

行内公式 $E=mc^2$ 与脚注[^1]。

[^1]: 脚注内容。

$$
\int_0^1 x\,dx
$$

```js {1,3}
const a = 1
```

- 无序 1
- 无序 2
  - 嵌套

1. 有序
2. 有序

- [ ] 待办
- [x] 已完成

> 普通引用

> [!NOTE]
> 提示框内容

> [!WARNING] 自定义标题
> 警告内容

<details>
<summary>折叠标题</summary>

折叠内容

</details>

| 左 | 中 | 右 |
| :-- | :-: | --: |
| a<br>b | `c` | **d** |

<video src="assets/demo.mp4" controls></video>

<iframe src="https://www.youtube.com/embed/abc" width="100%" height="400" frameborder="0" allowfullscreen></iframe>

<a href="https://example.com" data-tz-type="bookmark">书签</a>

关联 [[另一篇|别名]] 与 [[笔记]]。

转义的 \==不是高亮== 与 \^不是上标^。

行尾两空格  
换行与反斜杠\
换行。

<!-- 注释 -->

---

<div align="center">任意 HTML</div>
