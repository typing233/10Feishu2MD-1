# Feishu2MD - 飞书文档转 Markdown 浏览器插件

一键将飞书文档转换为 Markdown 格式，支持下载 `.md` 文件和复制到剪贴板。

## 功能特性

- **一键复制**: 将文档内容转为 Markdown 并复制到剪贴板
- **一键下载**: 自动以文档标题为文件名生成 `.md` 文件下载
- **完整格式支持**:
  - 标题 H1-H6
  - 有序/无序列表（含多级嵌套）
  - 表格（含合并单元格）
  - 图片（保留原始链接）
  - 粗体、斜体、删除线、行内代码
  - 超链接
  - 分隔线
  - 引用块
  - 代码块（含语言标识）
- **智能提取**: 自动剔除侧边栏、评论区等非正文干扰元素
- **多策略提取**: API 优先 → 内存块树 → DOM 解析，确保可靠性
- **三平台兼容**: Chrome、Edge、Firefox

## 安装方式

### Chrome / Edge（开发者模式加载）

1. 打开浏览器，访问 `chrome://extensions`（Chrome）或 `edge://extensions`（Edge）
2. 打开右上角「开发者模式」开关
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录（包含 `manifest.json` 的文件夹）

### Firefox（临时加载）

1. 访问 `about:debugging#/runtime/this-firefox`
2. 点击「载入临时附加组件」
3. 选择 `manifest_firefox.json` 文件（或将其重命名为 `manifest.json`）

### 打包安装

运行构建脚本生成 zip 包：

```bash
chmod +x build.sh
./build.sh
```

生成文件：
- `build/chrome/` — Chrome/Edge 可直接加载的目录
- `build/firefox/` — Firefox 可直接加载的目录
- `build/feishu2md-chrome.zip` — Chrome 网上应用店上传包
- `build/feishu2md-firefox.zip` — Firefox 附加组件上传包

## 使用方法

1. 在浏览器中打开任意飞书文档页面（`feishu.cn/docx/`、`/docs/`、`/wiki/`）
2. 点击浏览器工具栏中的 Feishu2MD 图标
3. 选择「复制 Markdown」或「下载 .md 文件」

## 支持的飞书 URL 格式

- `https://*.feishu.cn/docx/*` — 新版文档
- `https://*.feishu.cn/docs/*` — 旧版文档
- `https://*.feishu.cn/wiki/*` — 知识库文档
- `https://*.larksuite.com/*` — Lark 国际版

## 技术架构

```
popup.html/js  →  content.js  →  converter.js
     ↕                ↕
  用户交互       提取策略:
                 1. 飞书内部 API (最可靠)
                 2. window.PageMain 块树
                 3. DOM 解析 (兜底)
```

## 项目结构

```
├── manifest.json          # Chrome/Edge 清单 (Manifest V3)
├── manifest_firefox.json  # Firefox 清单 (含 gecko ID)
├── converter.js           # Markdown 转换引擎
├── content.js             # 内容提取脚本
├── background.js          # Service Worker
├── popup.html/css/js      # 弹窗 UI
├── icons/                 # 扩展图标
├── build.sh               # 打包脚本
└── README.md
```

## 许可证

MIT
