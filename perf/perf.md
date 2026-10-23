# 大文档性能剖析(Chromium,不压缩的生产构建)

## 规模与耗时

```json
[
  {
    "kb": 256,
    "blocks": 2792,
    "parseMs": 297,
    "openMs": 128,
    "loadedMs": 451,
    "closeMs": 7
  },
  {
    "kb": 512,
    "blocks": 5556,
    "parseMs": 393,
    "openMs": 101,
    "loadedMs": 653,
    "closeMs": 7
  },
  {
    "kb": 1024,
    "blocks": 11036,
    "parseMs": 726,
    "openMs": 95,
    "loadedMs": 1106,
    "closeMs": 12
  },
  {
    "kb": 2048,
    "blocks": 21998,
    "parseMs": 1481,
    "openMs": 98,
    "loadedMs": 1974,
    "closeMs": 20
  },
  {
    "kb": 5120,
    "blocks": 54678,
    "parseMs": 3635,
    "openMs": 121,
    "loadedMs": 5586,
    "closeMs": 44
  }
]
```

剖析文档 1048798 字节,11036 个顶层块

```json
{
  "parseMs": 749,
  "openMs": {
    "firstScreen": 108,
    "loaded": 1070
  },
  "input": {
    "total": {
      "p50": 0.5,
      "p95": 1.5,
      "max": 5.9
    },
    "dispatch": {
      "p50": 0.3,
      "p95": 1.2,
      "max": 5.7
    }
  },
  "switchBackMs": 42
}
```

## WebKit 规模与耗时

```json
[
  {
    "kb": 64,
    "blocks": 704,
    "parseMs": 120,
    "openMs": 1331,
    "loadedMs": 1332,
    "closeMs": 12
  },
  {
    "kb": 128,
    "blocks": 1402,
    "parseMs": 170,
    "openMs": 404,
    "loadedMs": 404,
    "closeMs": 17
  },
  {
    "kb": 256,
    "blocks": 2792,
    "parseMs": 323,
    "openMs": 171,
    "loadedMs": 776,
    "closeMs": 14
  },
  {
    "kb": 512,
    "blocks": 5556,
    "parseMs": 534,
    "openMs": 151,
    "loadedMs": 962,
    "closeMs": 23
  },
  {
    "kb": 1024,
    "blocks": 11036,
    "parseMs": 1080,
    "openMs": 165,
    "loadedMs": 1808,
    "closeMs": 31
  },
  {
    "kb": 2048,
    "blocks": 21998,
    "parseMs": 2157,
    "openMs": 167,
    "loadedMs": 3751,
    "closeMs": 46
  },
  {
    "kb": 5120,
    "blocks": 54678,
    "parseMs": 5432,
    "openMs": 194,
    "loadedMs": 10882,
    "closeMs": 103
  }
]
```

## 启动 · 不剖析的冷启动 7 次:中位 209 毫秒(203 / 208 / 209 / 211 / 213 / 204 / 212)

## 启动 · 到编辑器就绪 388 毫秒

| 脚本 | KB | 启动时执行过 KB |
|---|---|---|
| /assets/rolldown-runtime-DbVrKiKs.js | 2 | 1 |
| /assets/index-CGR6dumZ.js | 1947 | 773 |
| /assets/memory-B4oH3X9d.js | 22 | 6 |
| /assets/demo-DEtO0BR2.js | 2 | 2 |
| /assets/mhchem-k8Vdd0Me.js | 55 | 24 |
| /assets/katex-BEPN8FI0.js | 485 | 326 |

## 启动 · 加载了没执行的模块 Top

| 模块 | KB | 没执行 KB |
|---|---|---|
| katex | 540 | 189 |
| src/app | 244 | 172 |
| yaml | 198 | 164 |
| prosemirror-view | 177 | 116 |
| src/core | 163 | 104 |
| src/plugins | 142 | 99 |
| prosemirror-tables | 69 | 57 |
| src/views | 69 | 52 |
| micromark-core-commonmark | 91 | 51 |
| prosemirror-transform | 65 | 49 |
| dompurify | 84 | 42 |
| mdast-util-to-markdown | 77 | 41 |
| prosemirror-model | 96 | 40 |
| src/ui | 27 | 23 |
| prosemirror-commands | 22 | 16 |
| src/host | 18 | 14 |
| prosemirror-state | 29 | 11 |
| micromark-extension-gfm-autolink-literal | 15 | 10 |
| (未标记) | 13 | 9 |
| vfile | 23 | 9 |
| prosemirror-history | 12 | 8 |
| mdast-util-from-markdown | 25 | 8 |
| prosemirror-schema-list | 8 | 7 |
| micromark-extension-math | 11 | 7 |
| micromark-extension-gfm-footnote | 9 | 6 |
| unified | 34 | 6 |
| prosemirror-gapcursor | 6 | 5 |
| rope-sequence | 6 | 5 |
| micromark-extension-frontmatter | 11 | 5 |
| prosemirror-dropcursor | 5 | 4 |

## 热点源码 · subtokenize /assets/index-CGR6dumZ.js:27559

所属:node_modules/micromark-util-subtokenize/index.js

```js
*   Whether subtokens were found.
*/
function subtokenize(eventsArray) {
	/** @type {Record<string, number>} */
	const jumps = {};
	let index = -1;
	/** @type {Event} */
	let event;
	/** @type {number | undefined} */
	let lineIndex;
	/** @type {number} */
	let otherIndex;
	/** @type {Event} */
	let otherEvent;
	/** @type {Array<Event>} */
```

## 热点源码 · compile /assets/index-CGR6dumZ.js:34957

所属:node_modules/mdast-util-from-markdown/lib/index.js

```js
	*   mdast tree.
	*/
	function compile(events) {
		/** @type {Root} */
		let tree = {
			type: "root",
			children: [],
			position: void 0
		};
		/** @type {Omit<CompileContext, 'sliceSerialize'>} */
		const context = {
			stack: [tree],
			tokenStack: [],
			config,
			enter,
```

## 热点源码 · subcontent /assets/index-CGR6dumZ.js:27633

所属:node_modules/micromark-util-subtokenize/index.js

```js
*   Gaps.
*/
function subcontent(events, eventIndex) {
	const token = events.get(eventIndex)[1];
	const context = events.get(eventIndex)[2];
	let startPosition = eventIndex - 1;
	/** @type {Array<number>} */
	const startPositions = [];
	let tokenizer = token._tokenizer;
	if (!tokenizer) {
		tokenizer = context.parser[token.contentType](token.start);
		if (token._contentTypeTextTrailing) tokenizer._contentTypeTextTrailing = true;
	}
	const childEvents = tokenizer.events;
	/** @type {Array<[number, number]>} */
```

## 热点源码 · start /assets/index-CGR6dumZ.js:34391

所属:node_modules/micromark/lib/create-tokenizer.js

```js
				return start;
				/** @type {State} */
				function start(code) {
					info = store();
					currentConstruct = construct;
					if (!construct.partial) context.currentConstruct = construct;
					if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) return nok(code);
					return construct.tokenize.call(fields ? Object.assign(Object.create(context), fields) : context, effects, ok, nok)(code);
				}
			}
			/** @type {State} */
			function ok(code) {
				onreturn(currentConstruct, info);
				return returnState;
			}
```

## 启动 · 自耗时 Top

| 毫秒 | 函数 |
|---|---|
| 111.5 | (idle) :0 |
| 107 | (program) :0 |
| 50.1 | (匿名) /assets/index-CGR6dumZ.js:1 |
| 27.1 | setDocument /assets/index-CGR6dumZ.js:63868 |
| 6.8 | (garbage collector) :0 |
| 4.3 | (匿名) /assets/memory-B4oH3X9d.js:507 |
| 1.6 | h /assets/index-CGR6dumZ.js:40883 |
| 1.5 | query :5816 |
| 1.4 | start /assets/index-CGR6dumZ.js:34391 |
| 1.4 | resourceURL /assets/memory-B4oH3X9d.js:449 |
| 1.3 | buildPlugins /assets/index-CGR6dumZ.js:51100 |
| 1.1 | compile /assets/index-CGR6dumZ.js:34957 |
| 1.1 | countWords /assets/index-CGR6dumZ.js:44547 |
| 1.1 | updatePluginViews /assets/index-CGR6dumZ.js:10326 |
| 1.1 | InjectedScript :6969 |
| 1 | init /assets/index-CGR6dumZ.js:63719 |
| 1 | (匿名) :2 |
| 0.9 | evaluate :364 |
| 0.8 | subcontent /assets/index-CGR6dumZ.js:27633 |
| 0.8 | (匿名) /assets/mhchem-k8Vdd0Me.js:1 |
| 0.8 | (匿名) /assets/katex-BEPN8FI0.js:1 |
| 0.8 | get root /assets/index-CGR6dumZ.js:10396 |
| 0.6 | applyTransaction /assets/index-CGR6dumZ.js:5694 |
| 0.6 | resolveAll /assets/index-CGR6dumZ.js:25649 |
| 0.6 | splice /assets/index-CGR6dumZ.js:24814 |
| 0.6 | visit /assets/index-CGR6dumZ.js:19387 |
| 0.6 | createElement :0 |
| 0.6 | resolveTable /assets/index-CGR6dumZ.js:32507 |
| 0.5 | appendChild :0 |
| 0.5 | fromSchema /assets/index-CGR6dumZ.js:2478 |
| 0.5 | svgIcon /assets/index-CGR6dumZ.js:40898 |
| 0.5 | open /assets/index-CGR6dumZ.js:35163 |
| 0.5 | boot /assets/index-CGR6dumZ.js:65317 |
| 0.5 | scrollStack /assets/index-CGR6dumZ.js:6133 |
| 0.5 | blockSelectionPlugin /assets/index-CGR6dumZ.js:43924 |
| 0.5 | buildKeymaps /assets/index-CGR6dumZ.js:51010 |
| 0.5 | renderTex /assets/index-CGR6dumZ.js:49146 |
| 0.5 | image /assets/index-CGR6dumZ.js:51159 |
| 0.5 | update /assets/index-CGR6dumZ.js:48023 |
| 0.5 | FindPanel /assets/index-CGR6dumZ.js:44360 |

## 启动 · 含子调用 Top

| 毫秒 | 函数 |
|---|---|
| 378.2 | (root) :0 |
| 111.5 | (idle) :0 |
| 107 | (program) :0 |
| 55.2 | (匿名) /assets/index-CGR6dumZ.js:1 |
| 40.9 | openFile /assets/index-CGR6dumZ.js:63936 |
| 35.5 | setDocument /assets/index-CGR6dumZ.js:63868 |
| 18.5 | init /assets/index-CGR6dumZ.js:63719 |
| 17.2 | loadProgressive /assets/index-CGR6dumZ.js:58043 |
| 16.9 | nextBlocks /assets/index-CGR6dumZ.js:39038 |
| 13.6 | parse /assets/index-CGR6dumZ.js:37787 |
| 13.4 | createEditorView /assets/index-CGR6dumZ.js:51145 |
| 13.4 | newView /assets/index-CGR6dumZ.js:63851 |
| 13.1 | EditorView /assets/index-CGR6dumZ.js:10145 |
| 12.6 | fromMarkdown /assets/index-CGR6dumZ.js:34825 |
| 12.6 | parser /assets/index-CGR6dumZ.js:35832 |
| 8.3 | docViewDesc /assets/index-CGR6dumZ.js:7110 |
| 7.9 | write /assets/index-CGR6dumZ.js:34190 |
| 7.8 | updateChildren /assets/index-CGR6dumZ.js:7007 |
| 7.6 | go /assets/index-CGR6dumZ.js:34251 |
| 7.6 | main /assets/index-CGR6dumZ.js:34233 |
| 7.5 | iterDeco /assets/index-CGR6dumZ.js:7591 |
| 7.3 | replaceView /assets/index-CGR6dumZ.js:63862 |
| 7.2 | (匿名) :1 |
| 7 | (匿名) /assets/index-CGR6dumZ.js:7019 |
| 6.8 | (garbage collector) :0 |

## 解析 · 自耗时 Top

| 毫秒 | 函数 |
|---|---|
| 487.2 | (program) :0 |
| 119.9 | subtokenize /assets/index-CGR6dumZ.js:27559 |
| 113.3 | compile /assets/index-CGR6dumZ.js:34957 |
| 105.9 | (garbage collector) :0 |
| 49.6 | subcontent /assets/index-CGR6dumZ.js:27633 |
| 38.1 | start /assets/index-CGR6dumZ.js:34391 |
| 18.1 | writeToChild /assets/index-CGR6dumZ.js:33709 |
| 17.1 | set webkitSpeechRecognitionEvent :0 |
| 16.1 | start /assets/index-CGR6dumZ.js:34360 |
| 15.2 | data /assets/index-CGR6dumZ.js:33874 |
| 12.9 | splice /assets/index-CGR6dumZ.js:27430 |
| 12.8 | fromMarkdown /assets/index-CGR6dumZ.js:34825 |
| 9.8 | splice /assets/index-CGR6dumZ.js:24814 |
| 9.7 | headRowData /assets/index-CGR6dumZ.js:32212 |
| 8.6 | onexitdata /assets/index-CGR6dumZ.js:35375 |
| 7.7 | slice /assets/index-CGR6dumZ.js:27403 |
| 7.5 | sliceChunks /assets/index-CGR6dumZ.js:34480 |
| 7.5 | onsuccessfulconstruct /assets/index-CGR6dumZ.js:34305 |
| 6.4 | flowContinue /assets/index-CGR6dumZ.js:33684 |
| 6.4 | write /assets/index-CGR6dumZ.js:34190 |
| 5.5 | resolveAllText /assets/index-CGR6dumZ.js:33909 |
| 5.4 | prefix /assets/index-CGR6dumZ.js:26131 |
| 5.4 | transformFlow /assets/index-CGR6dumZ.js:38595 |
| 5.4 | check /assets/index-CGR6dumZ.js:19086 |
| 5.3 | inlines /assets/index-CGR6dumZ.js:39301 |
| 5.3 | data /assets/index-CGR6dumZ.js:33540 |
| 5.3 | enter /assets/index-CGR6dumZ.js:35180 |
| 4.3 | onenterdata /assets/index-CGR6dumZ.js:35357 |
| 4.3 | type /assets/index-CGR6dumZ.js:19070 |
| 4.3 | nextBlocks /assets/index-CGR6dumZ.js:39038 |
| 4.3 | tokenizeAttention /assets/index-CGR6dumZ.js:25806 |
| 3.3 | createTokenizer /assets/index-CGR6dumZ.js:34134 |
| 3.2 | documentContinue /assets/index-CGR6dumZ.js:33607 |
| 3.2 | chunkInside /assets/index-CGR6dumZ.js:27770 |
| 3.2 | endOfPrefix /assets/index-CGR6dumZ.js:30976 |
| 3.2 | splitMarkdown /assets/index-CGR6dumZ.js:38527 |
| 3.2 | collectDefinitions /assets/index-CGR6dumZ.js:39191 |
| 2.3 | flushCell /assets/index-CGR6dumZ.js:32655 |
| 2.2 | hook /assets/index-CGR6dumZ.js:34339 |
| 2.2 | after /assets/index-CGR6dumZ.js:26241 |

## 解析 · 含子调用 Top

| 毫秒 | 函数 |
|---|---|
| 1239 | (root) :0 |
| 644.7 | (匿名) :1 |
| 644.7 | evaluate :364 |
| 643.6 | parseMarkdown /assets/index-CGR6dumZ.js:39105 |
| 638.3 | nextBlocks /assets/index-CGR6dumZ.js:39038 |
| 611.5 | fromMarkdown /assets/index-CGR6dumZ.js:34825 |
| 611.5 | parser /assets/index-CGR6dumZ.js:35832 |
| 611.5 | parse /assets/index-CGR6dumZ.js:37787 |
| 487.2 | (program) :0 |
| 288.6 | subtokenize /assets/index-CGR6dumZ.js:27559 |
| 260.7 | postprocess /assets/index-CGR6dumZ.js:34599 |
| 168.8 | compile /assets/index-CGR6dumZ.js:34957 |
| 168.2 | write /assets/index-CGR6dumZ.js:34190 |
| 151.4 | subcontent /assets/index-CGR6dumZ.js:27633 |
| 105.9 | (garbage collector) :0 |
| 82 | writeToChild /assets/index-CGR6dumZ.js:33709 |
| 52 | start /assets/index-CGR6dumZ.js:34391 |
| 47.4 | flowContinue /assets/index-CGR6dumZ.js:33684 |
| 42.2 | thereIsNoNewContainer /assets/index-CGR6dumZ.js:33651 |
| 39.8 | onsuccessfulconstruct /assets/index-CGR6dumZ.js:34305 |
| 34.2 | contentEnd /assets/index-CGR6dumZ.js:27781 |
| 32.5 | data /assets/index-CGR6dumZ.js:33874 |
| 29 | resolveContent /assets/index-CGR6dumZ.js:27732 |
| 27.8 | start /assets/index-CGR6dumZ.js:34360 |
| 25.8 | documentContinue /assets/index-CGR6dumZ.js:33607 |

## 打开并渲染 · 自耗时 Top

| 毫秒 | 函数 |
|---|---|
| 513 | (program) :0 |
| 137.5 | subtokenize /assets/index-CGR6dumZ.js:27559 |
| 113.3 | (garbage collector) :0 |
| 106.5 | compile /assets/index-CGR6dumZ.js:34957 |
| 53.3 | subcontent /assets/index-CGR6dumZ.js:27633 |
| 52.3 | rebuildHeights /assets/index-CGR6dumZ.js:48216 |
| 23.4 | setDocument /assets/index-CGR6dumZ.js:63868 |
| 21.5 | appendHeights /assets/index-CGR6dumZ.js:48225 |
| 21.3 | splice /assets/index-CGR6dumZ.js:27430 |
| 20.3 | start /assets/index-CGR6dumZ.js:34391 |
| 19.1 | writeToChild /assets/index-CGR6dumZ.js:33709 |
| 17 | onexitdata /assets/index-CGR6dumZ.js:35375 |
| 17 | countWords /assets/index-CGR6dumZ.js:44547 |
| 15.9 | fromMarkdown /assets/index-CGR6dumZ.js:34825 |
| 14.9 | set webkitSpeechRecognitionEvent :0 |
| 12.8 | createTextNode :0 |
| 12.8 | write /assets/index-CGR6dumZ.js:34190 |
| 10.7 | nodesBetween /assets/index-CGR6dumZ.js:207 |
| 9.6 | renderDescs /assets/index-CGR6dumZ.js:7217 |
| 8.6 | headRowData /assets/index-CGR6dumZ.js:32212 |
| 7.9 | h /assets/index-CGR6dumZ.js:40883 |
| 7.5 | splice /assets/index-CGR6dumZ.js:24814 |
| 7.5 | get nextSibling :0 |
| 7.5 | chunkInside /assets/index-CGR6dumZ.js:27770 |
| 7.4 | flowContinue /assets/index-CGR6dumZ.js:33684 |
| 6.4 | inlines /assets/index-CGR6dumZ.js:39301 |
| 6.4 | insertBefore :0 |
| 6.4 | createElement :0 |
| 6.4 | transformFlow /assets/index-CGR6dumZ.js:38595 |
| 5.3 | start /assets/index-CGR6dumZ.js:34360 |
| 5.3 | suspiciousAttributes /assets/index-CGR6dumZ.js:3036 |
| 5.3 | create /assets/index-CGR6dumZ.js:6949 |
| 4.3 | rescan /assets/index-CGR6dumZ.js:44109 |
| 4.3 | renderSpec /assets/index-CGR6dumZ.js:3056 |
| 4.3 | resolveAllLineSuffixes /assets/index-CGR6dumZ.js:33940 |
| 4.3 | addNode /assets/index-CGR6dumZ.js:7460 |
| 4.3 | collectDefinitions /assets/index-CGR6dumZ.js:39191 |
| 4.3 | documentContinue /assets/index-CGR6dumZ.js:33607 |
| 4.3 | refresh /assets/index-CGR6dumZ.js:48272 |
| 4.3 | resolveAllText /assets/index-CGR6dumZ.js:33909 |

## 打开并渲染 · 含子调用 Top

| 毫秒 | 函数 |
|---|---|
| 1511 | (root) :0 |
| 796.8 | step /assets/index-CGR6dumZ.js:63904 |
| 619.2 | nextBlocks /assets/index-CGR6dumZ.js:39038 |
| 592.5 | fromMarkdown /assets/index-CGR6dumZ.js:34825 |
| 592.5 | parser /assets/index-CGR6dumZ.js:35832 |
| 592.5 | parse /assets/index-CGR6dumZ.js:37787 |
| 513 | (program) :0 |
| 281.4 | subtokenize /assets/index-CGR6dumZ.js:27559 |
| 253.7 | postprocess /assets/index-CGR6dumZ.js:34599 |
| 193.5 | dispatchTransaction /assets/index-CGR6dumZ.js:51171 |
| 193.5 | EditorView.dispatch /assets/index-CGR6dumZ.js:10564 |
| 182.8 | updateStateInner /assets/index-CGR6dumZ.js:10259 |
| 182.8 | updateState /assets/index-CGR6dumZ.js:10256 |
| 163 | compile /assets/index-CGR6dumZ.js:34957 |
| 159.9 | write /assets/index-CGR6dumZ.js:34190 |
| 136.5 | subcontent /assets/index-CGR6dumZ.js:27633 |
| 113.3 | (garbage collector) :0 |
| 102 | updateChildren /assets/index-CGR6dumZ.js:7007 |
| 94 | updateInner /assets/index-CGR6dumZ.js:7076 |
| 94 | update /assets/index-CGR6dumZ.js:7071 |
| 87.7 | updatePluginViews /assets/index-CGR6dumZ.js:10326 |
| 85.9 | iterDeco /assets/index-CGR6dumZ.js:7591 |
| 85.6 | update /assets/index-CGR6dumZ.js:48128 |
| 84.8 | (匿名) /assets/index-CGR6dumZ.js:7019 |
| 83.7 | addNode /assets/index-CGR6dumZ.js:7460 |

## 连续输入 · 自耗时 Top

| 毫秒 | 函数 |
|---|---|
| 508.6 | (program) :0 |
| 18.2 | countWords /assets/index-CGR6dumZ.js:44547 |
| 9.9 | tzFastBlockUpdate /assets/index-CGR6dumZ.js:7505 |
| 7.5 | nodesBetween /assets/index-CGR6dumZ.js:207 |
| 4.7 | (garbage collector) :0 |
| 4.4 | slugify /assets/index-CGR6dumZ.js:13714 |
| 3.4 | getBoundingClientRect :0 |
| 3.2 | get nodeSize /assets/index-CGR6dumZ.js:1136 |
| 2.8 | updateInner /assets/index-CGR6dumZ.js:7076 |
| 2.1 | (匿名) /assets/index-CGR6dumZ.js:13694 |
| 1.1 | replaceChildren :0 |
| 1.1 | child /assets/index-CGR6dumZ.js:340 |
| 1.1 | (匿名) :1 |
| 1.1 | evaluate :364 |
| 1.1 | stat :14 |
| 1.1 | updateWindowState /assets/index-CGR6dumZ.js:64196 |
| 1 | changedDescendants /assets/index-CGR6dumZ.js:11545 |
| 0.5 | findIndex /assets/index-CGR6dumZ.js:383 |
| 0.4 | get childCount /assets/index-CGR6dumZ.js:1142 |
| 0.3 | updateChildren /assets/index-CGR6dumZ.js:7007 |
| 0.2 | renderDescs /assets/index-CGR6dumZ.js:7217 |
| 0.2 | canReplace /assets/index-CGR6dumZ.js:1430 |
| 0.2 | applyTransaction /assets/index-CGR6dumZ.js:14409 |
| 0.1 | from /assets/index-CGR6dumZ.js:445 |
| 0.1 | append /assets/index-CGR6dumZ.js:245 |
| 0.1 | hide /assets/index-CGR6dumZ.js:48043 |
| 0 | preMatch /assets/index-CGR6dumZ.js:7555 |
| 0 | validContent /assets/index-CGR6dumZ.js:2114 |
| 0 | findNodeMatch /assets/index-CGR6dumZ.js:7382 |
| 0 | matchFragment /assets/index-CGR6dumZ.js:1600 |
| 0 | updateNextNode /assets/index-CGR6dumZ.js:7419 |
| 0 | matchesNode /assets/index-CGR6dumZ.js:6998 |

## 连续输入 · 含子调用 Top

| 毫秒 | 函数 |
|---|---|
| 574.2 | (root) :0 |
| 508.6 | (program) :0 |
| 33.3 | (匿名) /assets/index-CGR6dumZ.js:64291 |
| 27.6 | (匿名) :1 |
| 27.6 | evaluate :364 |
| 23.5 | renderStatus /assets/index-CGR6dumZ.js:64313 |
| 20.1 | dispatchTransaction /assets/index-CGR6dumZ.js:51171 |
| 20.1 | EditorView.dispatch /assets/index-CGR6dumZ.js:10564 |
| 18.2 | countWords /assets/index-CGR6dumZ.js:44547 |
| 16.5 | updateStateInner /assets/index-CGR6dumZ.js:10259 |
| 16.5 | updateState /assets/index-CGR6dumZ.js:10256 |
| 16.5 | updateChildren /assets/index-CGR6dumZ.js:7007 |
| 16.5 | updateInner /assets/index-CGR6dumZ.js:7076 |
| 16.5 | update /assets/index-CGR6dumZ.js:7071 |
| 16 | tzFastBlockUpdate /assets/index-CGR6dumZ.js:7505 |
| 14.1 | nodesBetween /assets/index-CGR6dumZ.js:207 |
| 9.8 | nodesBetween /assets/index-CGR6dumZ.js:1176 |
| 9.8 | descendants /assets/index-CGR6dumZ.js:1183 |
| 9.8 | collectHeadings /assets/index-CGR6dumZ.js:13691 |
| 6.6 | (匿名) /assets/index-CGR6dumZ.js:13694 |
| 4.7 | (garbage collector) :0 |
| 4.4 | slugify /assets/index-CGR6dumZ.js:13714 |
| 4.3 | textBetween /assets/index-CGR6dumZ.js:1200 |
| 3.4 | getBoundingClientRect :0 |
| 3.2 | get nodeSize /assets/index-CGR6dumZ.js:1136 |

## 切回小文档 · 自耗时 Top

| 毫秒 | 函数 |
|---|---|
| 516.5 | (program) :0 |
| 34 | countWords /assets/index-CGR6dumZ.js:44547 |
| 12.1 | nodesBetween /assets/index-CGR6dumZ.js:207 |
| 5.3 | removeChild :0 |
| 3.2 | destroy /assets/index-CGR6dumZ.js:6518 |
| 3 | slugify /assets/index-CGR6dumZ.js:13714 |
| 2.1 | (匿名) /assets/index-CGR6dumZ.js:13694 |
| 2.1 | (garbage collector) :0 |
| 1.1 | forEach /assets/index-CGR6dumZ.js:355 |
| 1.1 | (idle) :0 |
| 1.1 | setDocument /assets/index-CGR6dumZ.js:63868 |
| 1.1 | (匿名) :1 |
| 1.1 | track /assets/index-CGR6dumZ.js:23821 |
| 1.1 | create /assets/index-CGR6dumZ.js:2075 |
| 1.1 | (匿名) /assets/index-CGR6dumZ.js:39440 |
| 1.1 | nodesBetween /assets/index-CGR6dumZ.js:1176 |
| 1.1 | createTextNode :0 |
| 1.1 | serializeMarkdown /assets/index-CGR6dumZ.js:39432 |
| 1.1 | destroy /assets/index-CGR6dumZ.js:7206 |
| 0.8 | safeBound /assets/index-CGR6dumZ.js:24042 |
| 0.1 | visitParents /assets/index-CGR6dumZ.js:19365 |
| 0.1 | one /assets/index-CGR6dumZ.js:21448 |
| 0 | all /assets/index-CGR6dumZ.js:21469 |

## 切回小文档 · 含子调用 Top

| 毫秒 | 函数 |
|---|---|
| 591.2 | (root) :0 |
| 516.5 | (program) :0 |
| 43.6 | renderStatus /assets/index-CGR6dumZ.js:64313 |
| 34 | countWords /assets/index-CGR6dumZ.js:44547 |
| 31 | (匿名) /assets/index-CGR6dumZ.js:64291 |
| 27.7 | save /assets/index-CGR6dumZ.js:64043 |
| 17.2 | nodesBetween /assets/index-CGR6dumZ.js:207 |
| 16 | openFile /assets/index-CGR6dumZ.js:63936 |
| 10.7 | setDocument /assets/index-CGR6dumZ.js:63868 |
| 9.8 | nodesBetween /assets/index-CGR6dumZ.js:1176 |
| 9.8 | descendants /assets/index-CGR6dumZ.js:1183 |
| 9.8 | collectHeadings /assets/index-CGR6dumZ.js:13691 |
| 9.6 | destroy /assets/index-CGR6dumZ.js:10518 |
| 9.6 | replaceView /assets/index-CGR6dumZ.js:63862 |
| 8.5 | textBetween /assets/index-CGR6dumZ.js:1200 |
| 5.3 | serializeMarkdown /assets/index-CGR6dumZ.js:39432 |
| 5.3 | serialize /assets/index-CGR6dumZ.js:58097 |
| 5.3 | save /assets/index-CGR6dumZ.js:58108 |
| 5.3 | confirmLeave /assets/index-CGR6dumZ.js:63987 |
| 5.3 | removeChild :0 |
| 5.1 | (匿名) /assets/index-CGR6dumZ.js:13694 |
| 4.3 | destroy /assets/index-CGR6dumZ.js:6518 |
| 3.2 | (匿名) /assets/index-CGR6dumZ.js:39440 |
| 3 | slugify /assets/index-CGR6dumZ.js:13714 |
| 2.1 | (garbage collector) :0 |
