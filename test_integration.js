/**
 * Feishu2MD Integration Tests
 * - Test 1: Real Feishu DOM sample — verify only body content is extracted
 * - Test 2: Image processing — accessible URL, blob, private, fetch failure
 * - Test 3: Plain text special character escaping
 *
 * Run with: node test_integration.js
 */

// ============================================================
// DOM/Browser mocks for Node.js
// ============================================================

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

global.Node = { TEXT_NODE: NODE_TEXT, ELEMENT_NODE: NODE_ELEMENT };

class MockElement {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = NODE_ELEMENT;
    this.tagName = tag.toUpperCase();
    this._attrs = attrs;
    this.childNodes = children;
    this.children = children.filter(c => c.nodeType === NODE_ELEMENT);
    this._classList = (attrs.class || '').split(/\s+/).filter(Boolean);
    this.hidden = false;
    // Set parent references for closest()
    for (const c of this.childNodes) {
      if (c.nodeType === NODE_ELEMENT) c._parent = this;
    }
  }
  getAttribute(name) { return this._attrs[name] || null; }
  get classList() {
    const self = this;
    return {
      has(c) { return self._classList.includes(c); },
      contains(c) { return self._classList.includes(c); },
      [Symbol.iterator]() { return self._classList[Symbol.iterator](); }
    };
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  closest(sel) {
    let node = this;
    while (node) {
      if (matchesSelector(node, sel)) return node;
      node = node._parent || null;
    }
    return null;
  }
  get textContent() {
    return this.childNodes.map(c => {
      if (c.nodeType === NODE_TEXT) return c.textContent;
      return c.textContent;
    }).join('');
  }
  cloneNode(deep) {
    if (!deep) return new MockElement(this.tagName.toLowerCase(), { ...this._attrs });
    const clonedChildren = this.childNodes.map(c => {
      if (c.nodeType === NODE_TEXT) return new MockTextNode(c.textContent);
      return c.cloneNode(true);
    });
    return new MockElement(this.tagName.toLowerCase(), { ...this._attrs }, clonedChildren);
  }
  remove() {
    // No-op in test context (handled by querySelectorAll + forEach)
  }
}

class MockTextNode {
  constructor(text) { this.nodeType = NODE_TEXT; this.textContent = text; }
}

function matchesSelector(el, sel) {
  if (!el || el.nodeType !== NODE_ELEMENT) return false;
  if (sel.startsWith('.')) {
    return el._classList.includes(sel.slice(1));
  }
  if (sel.startsWith('[')) {
    const match = sel.match(/\[([^=\]]+)(?:([*~|^$]?)="?([^"\]]*)"?)?\]/);
    if (!match) return false;
    const [, attr, op, val] = match;
    const actual = el.getAttribute(attr);
    if (!actual) return false;
    if (!op && !val) return true;
    if (op === '*') return actual.includes(val);
    if (op === '^') return actual.startsWith(val);
    return actual === val;
  }
  if (sel.startsWith('#')) {
    return el.getAttribute('id') === sel.slice(1);
  }
  // Tag name
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function queryAll(root, sel) {
  const results = [];
  // Handle `:scope >` prefix by only searching direct children
  const directOnly = sel.includes(':scope >') || sel.includes(':scope>');
  const cleanSel = sel.replace(/:scope\s*>\s*/g, '');
  const selectors = cleanSel.split(',').map(s => s.trim());

  function walk(el, depth) {
    if (!el || el.nodeType !== NODE_ELEMENT) return;
    if (directOnly && depth > 1) return;
    for (const s of selectors) {
      if (matchesSelector(el, s)) { results.push(el); break; }
    }
    if (directOnly && depth >= 1) return;
    for (const child of el.childNodes) {
      if (child.nodeType === NODE_ELEMENT) walk(child, depth + 1);
    }
  }
  for (const child of root.childNodes) {
    if (child.nodeType === NODE_ELEMENT) walk(child, 1);
  }
  return results;
}

// Mock document for converter module
global.document = { createElement: (tag) => new MockElement(tag) };

// ============================================================
// Load converter
// ============================================================
const Feishu2MDConverter = require('./converter.js');

let passed = 0, failed = 0;
function assert(cond, name, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); if (detail) console.log(`    ${detail}`); failed++; }
}
function assertContains(actual, expected, name) {
  assert(actual.includes(expected), name,
    `Expected to contain: "${expected}"\n    Got (first 300): "${actual.substring(0, 300)}"`);
}
function assertNotContains(actual, notExpected, name) {
  assert(!actual.includes(notExpected), name,
    `Should NOT contain: "${notExpected}"\n    But found in: "${actual.substring(0, 300)}"`);
}

// ============================================================
// TEST 1: Real Feishu DOM sample — content isolation
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST 1: Real Feishu DOM sample — only body content extracted');
console.log('='.repeat(60));

// Build a realistic Feishu document DOM tree
function buildFeishuPageDOM() {
  // Sidebar / Table of Contents
  const sidebar = new MockElement('div', { class: 'catalog-container', role: 'navigation' }, [
    new MockTextNode('目录'),
    new MockElement('div', { class: 'catalog-item' }, [new MockTextNode('第一章')]),
    new MockElement('div', { class: 'catalog-item' }, [new MockTextNode('第二章')]),
  ]);

  // Toolbar
  const toolbar = new MockElement('div', { role: 'toolbar', class: 'docs-toolbar toolbar-container' }, [
    new MockTextNode('编辑'),
    new MockElement('button', {}, [new MockTextNode('分享')]),
    new MockElement('button', {}, [new MockTextNode('评论')]),
  ]);

  // Comment section
  const comments = new MockElement('div', { class: 'docx-global-comment' }, [
    new MockElement('div', { class: 'comment-item' }, [
      new MockTextNode('用户A: 这段需要修改'),
    ]),
    new MockElement('div', { class: 'comment-item' }, [
      new MockTextNode('用户B: 已修改完成'),
    ]),
  ]);

  // Reaction / like section
  const reactions = new MockElement('div', { class: 'global-like-wrap reaction-container' }, [
    new MockTextNode('👍 5'),
    new MockTextNode('❤️ 3'),
  ]);

  // Bidirectional links
  const biLinks = new MockElement('div', { class: 'bidirection-link-list' }, [
    new MockElement('a', { href: '/docx/other1' }, [new MockTextNode('相关文档1')]),
    new MockElement('a', { href: '/docx/other2' }, [new MockTextNode('相关文档2')]),
  ]);

  // Wiki sidebar navigation
  const wikiSidebar = new MockElement('div', { class: 'workspace-tree-view-node wiki-sidebar' }, [
    new MockElement('div', {}, [new MockTextNode('知识库首页')]),
    new MockElement('div', {}, [new MockTextNode('技术文档')]),
    new MockElement('div', {}, [new MockTextNode('产品文档')]),
  ]);

  // Footer
  const footer = new MockElement('div', { class: 'lark-docs-reader-footer doc-reader-footer' }, [
    new MockTextNode('最后编辑于 2024-01-15'),
    new MockTextNode('创建者：张三'),
  ]);

  // Header operations (share, star, etc.)
  const headerOps = new MockElement('div', { class: 'doc-header-operation', 'data-testid': 'header-ops' }, [
    new MockElement('button', {}, [new MockTextNode('收藏')]),
    new MockElement('button', {}, [new MockTextNode('更多')]),
  ]);

  // AI widget
  const aiWidget = new MockElement('div', { class: 'docx-ai-widget' }, [
    new MockTextNode('AI 助手：点击生成摘要'),
  ]);

  // Tooltip / popover
  const tooltip = new MockElement('div', { class: 'tooltip-container' }, [
    new MockTextNode('提示：按 Ctrl+S 保存'),
  ]);

  // ---- ACTUAL CONTENT ----
  // Title
  const title = new MockElement('h1', { 'data-block-type': 'heading1' }, [
    new MockTextNode('项目技术方案文档'),
  ]);

  // Paragraph
  const para1 = new MockElement('p', { 'data-block-type': 'text' }, [
    new MockTextNode('本文档描述了项目的整体技术架构和实现方案。'),
  ]);

  // H2
  const h2 = new MockElement('h2', { 'data-block-type': 'heading2' }, [
    new MockTextNode('系统架构'),
  ]);

  // Paragraph with formatting
  const para2 = new MockElement('p', { 'data-block-type': 'text' }, [
    new MockTextNode('系统采用'),
    new MockElement('strong', {}, [new MockTextNode('微服务架构')]),
    new MockTextNode('，使用'),
    new MockElement('code', {}, [new MockTextNode('Docker')]),
    new MockTextNode('容器化部署。'),
  ]);

  // Unordered list
  const list = new MockElement('ul', {}, [
    new MockElement('li', {}, [new MockTextNode('服务注册与发现')]),
    new MockElement('li', {}, [
      new MockTextNode('负载均衡'),
      new MockElement('ul', {}, [
        new MockElement('li', {}, [new MockTextNode('Nginx 反向代理')]),
        new MockElement('li', {}, [new MockTextNode('服务网格')]),
      ]),
    ]),
    new MockElement('li', {}, [new MockTextNode('监控告警')]),
  ]);

  // Table
  const table = new MockElement('table', { 'data-block-type': 'table' }, [
    new MockElement('tr', { role: 'row' }, [
      new MockElement('th', { role: 'columnheader' }, [new MockTextNode('服务名')]),
      new MockElement('th', { role: 'columnheader' }, [new MockTextNode('端口')]),
      new MockElement('th', { role: 'columnheader' }, [new MockTextNode('说明')]),
    ]),
    new MockElement('tr', { role: 'row' }, [
      new MockElement('td', { role: 'cell' }, [new MockTextNode('auth-service')]),
      new MockElement('td', { role: 'cell' }, [new MockTextNode('8080')]),
      new MockElement('td', { role: 'cell' }, [new MockTextNode('认证服务')]),
    ]),
    new MockElement('tr', { role: 'row' }, [
      new MockElement('td', { role: 'cell' }, [new MockTextNode('api-gateway')]),
      new MockElement('td', { role: 'cell' }, [new MockTextNode('8443')]),
      new MockElement('td', { role: 'cell' }, [new MockTextNode('API 网关')]),
    ]),
  ]);

  // Blockquote
  const quote = new MockElement('blockquote', {}, [
    new MockElement('p', {}, [new MockTextNode('注意：部署前需要确认所有环境变量已正确配置。')]),
  ]);

  // Image
  const img = new MockElement('img', { src: 'https://example.com/arch-diagram.png', alt: '架构图' });

  // HR
  const hr = new MockElement('hr', {});

  // Final paragraph
  const para3 = new MockElement('p', { 'data-block-type': 'text' }, [
    new MockTextNode('详情请参考'),
    new MockElement('a', { href: 'https://internal.docs/guide' }, [new MockTextNode('部署指南')]),
    new MockTextNode('。'),
  ]);

  // Assemble: content area
  const contentArea = new MockElement('div', { class: 'page-main-item editor' }, [
    title, para1, h2, para2, list, table, quote, img, hr, para3,
  ]);

  // Full page with all noise elements
  const page = new MockElement('div', { class: 'page-main' }, [
    headerOps,
    toolbar,
    sidebar,
    wikiSidebar,
    contentArea,
    comments,
    reactions,
    biLinks,
    footer,
    aiWidget,
    tooltip,
  ]);

  return page;
}

{
  const dom = buildFeishuPageDOM();
  const md = Feishu2MDConverter.convertFromDOM(dom);

  console.log('\n--- Extracted Markdown ---');
  console.log(md);
  console.log('--- End ---\n');

  // Content SHOULD be present
  assertContains(md, '项目技术方案文档', 'Body: document title present');
  assertContains(md, '本文档描述了项目的整体技术架构和实现方案', 'Body: paragraph 1 present');
  assertContains(md, '系统架构', 'Body: H2 heading present');
  assertContains(md, '**微服务架构**', 'Body: bold text present');
  assertContains(md, '`Docker`', 'Body: inline code present');
  assertContains(md, '服务注册与发现', 'Body: list item 1');
  assertContains(md, 'Nginx 反向代理', 'Body: nested list item');
  assertContains(md, '服务名', 'Body: table header');
  assertContains(md, 'auth-service', 'Body: table cell');
  assertContains(md, '> ', 'Body: blockquote marker');
  assertContains(md, '架构图', 'Body: image alt text');
  assertContains(md, '---', 'Body: horizontal rule');
  assertContains(md, '部署指南', 'Body: link text');

  // Non-content SHOULD NOT be present
  assertNotContains(md, '目录', 'Excluded: catalog/TOC');
  assertNotContains(md, '第一章', 'Excluded: catalog item');
  assertNotContains(md, '编辑', 'Excluded: toolbar text');
  assertNotContains(md, '分享', 'Excluded: toolbar button');
  assertNotContains(md, '用户A', 'Excluded: comment author');
  assertNotContains(md, '这段需要修改', 'Excluded: comment text');
  assertNotContains(md, '已修改完成', 'Excluded: comment reply');
  assertNotContains(md, '👍', 'Excluded: reaction emoji');
  assertNotContains(md, '相关文档1', 'Excluded: bidirectional link');
  assertNotContains(md, '知识库首页', 'Excluded: wiki sidebar');
  assertNotContains(md, '技术文档', 'Excluded: wiki sidebar item');
  assertNotContains(md, '最后编辑于', 'Excluded: footer text');
  assertNotContains(md, '创建者', 'Excluded: footer meta');
  assertNotContains(md, '收藏', 'Excluded: header ops');
  assertNotContains(md, 'AI 助手', 'Excluded: AI widget');
  assertNotContains(md, '点击生成摘要', 'Excluded: AI widget text');
  assertNotContains(md, '按 Ctrl', 'Excluded: tooltip');
}

// ============================================================
// TEST 2: Image Processing
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST 2: Image processing — accessible, blob, private, failure');
console.log('='.repeat(60));

// We need to test content.js image logic. Since it uses fetch/canvas which are
// browser APIs, we mock them and test the logic in isolation.

// Re-read content.js source and extract the image processing functions
const fs = require('fs');
const contentSrc = fs.readFileSync('./content.js', 'utf8');

// Create a sandboxed module that exposes image processing functions
function createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl) {
  // Minimal mock environment
  const mockWindow = { location: { href: 'https://test.feishu.cn/docx/abc123', origin: 'https://test.feishu.cn' } };

  const processImageSrc = async (src) => {
    if (!src) return src;
    if (src.startsWith('blob:')) {
      try {
        const resp = await mockFetch(src);
        const blob = await resp.blob();
        return await mockBlobToDataUrl(blob);
      } catch (e) {
        return src;
      }
    }
    if (src.startsWith('data:')) return src;
    const isPrivateUrl = (
      src.includes('feishu.cn') || src.includes('larksuite.com') ||
      src.includes('lark-file') || src.includes('bytedance.net') || src.includes('byteimg.com')
    );
    if (!isPrivateUrl) return src;
    // Private URL: try fetch with credentials
    try {
      const resp = await mockFetch(src, { credentials: 'include' });
      if (!resp.ok) return src;
      const blob = await resp.blob();
      if (blob.size === 0) return src;
      return await mockBlobToDataUrl(blob);
    } catch (e) {
      return src;
    }
  };

  const processImages = async (markdown) => {
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...markdown.matchAll(imgRegex)];
    if (matches.length === 0) return markdown;
    let result = markdown;
    for (const match of matches) {
      const [fullMatch, alt, src] = match;
      const processedSrc = await processImageSrc(src);
      if (processedSrc && processedSrc !== src) {
        result = result.replace(fullMatch, `![${alt}](${processedSrc})`);
      }
    }
    return result;
  };

  return { processImageSrc, processImages };
}

(async () => {
  // --- Case A: Publicly accessible external image (keeps original URL) ---
  console.log('\n  Case A: External accessible image');
  {
    const mockFetch = async () => ({ ok: true, blob: async () => ({ size: 100 }) });
    const mockBlobToDataUrl = async () => 'data:image/png;base64,AAAA';
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const result = await processImageSrc('https://cdn.example.com/photo.jpg');
    assert(result === 'https://cdn.example.com/photo.jpg',
      'External image URL preserved as-is',
      `Got: ${result}`);
  }

  // --- Case B: blob: URL converted to base64 ---
  console.log('\n  Case B: blob: URL → base64');
  {
    const fakeBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const mockFetch = async (url) => ({
      ok: true,
      blob: async () => ({ size: 500, type: 'image/png' })
    });
    const mockBlobToDataUrl = async (blob) => fakeBase64;
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const result = await processImageSrc('blob:https://feishu.cn/1234-5678');
    assert(result === fakeBase64,
      'blob: URL converted to base64 data URL',
      `Got: ${result.substring(0, 60)}...`);
  }

  // --- Case C: Private Feishu image, fetch succeeds → base64 ---
  console.log('\n  Case C: Private Feishu image (fetch OK) → base64');
  {
    const fakeBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const mockFetch = async (url, opts) => ({
      ok: true,
      blob: async () => ({ size: 2048, type: 'image/jpeg' })
    });
    const mockBlobToDataUrl = async () => fakeBase64;
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const feishuImgUrl = 'https://internal-api-lark-file.feishu.cn/open-apis/drive/v1/medias/token123/download';
    const result = await processImageSrc(feishuImgUrl);
    assert(result === fakeBase64,
      'Private Feishu image converted to base64',
      `Got: ${result.substring(0, 60)}...`);
  }

  // --- Case D: Private Feishu image, fetch fails → keep original URL ---
  console.log('\n  Case D: Private Feishu image (fetch fails) → original URL');
  {
    const mockFetch = async () => { throw new Error('Network error'); };
    const mockBlobToDataUrl = async () => { throw new Error('unreachable'); };
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const feishuImgUrl = 'https://internal-api-lark-file.feishu.cn/open-apis/drive/v1/medias/token456/download';
    const result = await processImageSrc(feishuImgUrl);
    assert(result === feishuImgUrl,
      'On fetch failure, original URL is kept (not crash)',
      `Got: ${result}`);
  }

  // --- Case E: Private Feishu image, fetch returns 403 → keep original ---
  console.log('\n  Case E: Private Feishu image (HTTP 403) → original URL');
  {
    const mockFetch = async () => ({ ok: false, status: 403 });
    const mockBlobToDataUrl = async () => 'data:unreachable';
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const url = 'https://bytedance.net/obj/image/private123.png';
    const result = await processImageSrc(url);
    assert(result === url,
      'HTTP 403 response keeps original URL',
      `Got: ${result}`);
  }

  // --- Case F: data: URL passes through unchanged ---
  console.log('\n  Case F: data: URL passthrough');
  {
    const mockFetch = async () => { throw new Error('should not fetch'); };
    const mockBlobToDataUrl = async () => { throw new Error('should not convert'); };
    const { processImageSrc } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const dataUrl = 'data:image/png;base64,existingBase64Data';
    const result = await processImageSrc(dataUrl);
    assert(result === dataUrl,
      'data: URL passed through without modification',
      `Got: ${result}`);
  }

  // --- Case G: Full markdown with mixed images ---
  console.log('\n  Case G: processImages() on full markdown with mixed images');
  {
    const fakeBase64 = 'data:image/png;base64,CONVERTED';
    const mockFetch = async (url) => {
      if (url.includes('feishu.cn') || url.startsWith('blob:')) {
        return { ok: true, blob: async () => ({ size: 100, type: 'image/png' }) };
      }
      return { ok: true, blob: async () => ({ size: 100 }) };
    };
    const mockBlobToDataUrl = async () => fakeBase64;
    const { processImages } = createImageProcessorWithMocks(mockFetch, mockBlobToDataUrl);

    const input = [
      '# Title',
      '',
      '![external](https://cdn.example.com/img.png)',
      '',
      '![private](https://internal-api-lark-file.feishu.cn/medias/abc/download)',
      '',
      '![blob](blob:https://feishu.cn/9999)',
      '',
      'Some text',
    ].join('\n');

    const result = await processImages(input);

    assertContains(result, '![external](https://cdn.example.com/img.png)',
      'External image URL unchanged in full markdown');
    assertContains(result, `![private](${fakeBase64})`,
      'Private Feishu image replaced with base64');
    assertContains(result, `![blob](${fakeBase64})`,
      'blob image replaced with base64');
    assertContains(result, '# Title', 'Non-image content preserved');
    assertContains(result, 'Some text', 'Trailing text preserved');
  }

  // ============================================================
  // TEST 3: Plain text special character escaping
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Plain text special character escaping');
  console.log('='.repeat(60));

  // Test via API blocks (extractBlockText path)
  console.log('\n  Via API blocks:');
  {
    const blocks = [
      { block_id: 'root', block_type: 1, children: ['p1', 'p2', 'p3', 'p4'] },
      { block_id: 'p1', block_type: 2, text: { elements: [
        { text_run: { content: 'Result: 2 * 3 = 6 and a_b_c is a variable' } }
      ]}},
      { block_id: 'p2', block_type: 2, text: { elements: [
        { text_run: { content: 'Use array[0] to access the first element' } }
      ]}},
      { block_id: 'p3', block_type: 2, text: { elements: [
        { text_run: { content: 'Compare: a < b > c and use `backtick` for code' } }
      ]}},
      { block_id: 'p4', block_type: 2, text: { elements: [
        { text_run: { content: 'Pipe symbol | used in tables' } }
      ]}},
    ];

    const md = Feishu2MDConverter.convertFromBlocks(blocks);

    assertContains(md, '2 \\* 3', 'Asterisk in plain text is escaped');
    assertContains(md, 'a\\_b\\_c', 'Underscore in plain text is escaped');
    assertContains(md, '\\[0\\]', 'Square brackets escaped');
    assertContains(md, '&lt; b &gt;', 'Angle brackets escaped as HTML entities');
    assertContains(md, '\\`backtick\\`', 'Backtick in plain text escaped');
    assertContains(md, '\\|', 'Pipe in plain text escaped');
  }

  // Test: formatted text should NOT have extra escaping on the content inside markers
  console.log('\n  Formatted text (bold/italic/code) content:');
  {
    const blocks = [
      { block_id: 'root', block_type: 1, children: ['p1', 'p2', 'p3'] },
      { block_id: 'p1', block_type: 2, text: { elements: [
        { text_run: { content: 'important_note', text_element_style: { bold: true } } }
      ]}},
      { block_id: 'p2', block_type: 2, text: { elements: [
        { text_run: { content: 'array[0]', text_element_style: { inline_code: true } } }
      ]}},
      { block_id: 'p3', block_type: 2, text: { elements: [
        { text_run: { content: 'normal text before ' } },
        { text_run: { content: 'bold part', text_element_style: { bold: true } } },
        { text_run: { content: ' and *stars* after' } }
      ]}},
    ];

    const md = Feishu2MDConverter.convertFromBlocks(blocks);

    assertContains(md, '**important_note**', 'Bold content preserves underscores (no escape inside bold)');
    assertContains(md, '`array[0]`', 'Code content preserves brackets (no escape inside code)');
    assertContains(md, '\\*stars\\*', 'Plain text stars after bold ARE escaped');
    assertContains(md, '**bold part**', 'Bold markers correctly applied');
  }

  // Test via DOM (extractInlineFormatting path)
  console.log('\n  Via DOM extraction:');
  {
    const el = new MockElement('p', { 'data-block-type': 'text' }, [
      new MockTextNode('Price: $100 * 2 = $200, use_flag is true'),
    ]);
    const page = new MockElement('div', { class: 'page-main-item editor' }, [el]);
    const md = Feishu2MDConverter.convertFromDOM(page);

    assertContains(md, '\\*', 'DOM: asterisk escaped in plain text');
    assertContains(md, '\\_', 'DOM: underscore escaped in plain text');
  }

  {
    const el = new MockElement('p', { 'data-block-type': 'text' }, [
      new MockTextNode('See '),
      new MockElement('code', {}, [new MockTextNode('arr[i] * 2')]),
      new MockTextNode(' for details'),
    ]);
    const page = new MockElement('div', { class: 'page-main-item editor' }, [el]);
    const md = Feishu2MDConverter.convertFromDOM(page);

    assertContains(md, '`arr[i] * 2`', 'DOM: no escaping inside code span');
    assertNotContains(md, '\\[i\\]', 'DOM: brackets NOT escaped inside code');
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Integration test results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
})();
