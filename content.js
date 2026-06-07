/**
 * Feishu2MD Content Script
 * Extracts document content from Feishu pages via API or DOM fallback.
 * Handles image base64 conversion for private/blob images.
 */
(() => {
  const SELECTORS = {
    // Content root selectors in priority order (most specific first)
    contentRoot: [
      '.docx-container .page-block',
      '.page-main-item.editor .page-block',
      '.page-main-item.editor',
      '#mainBox .bear-web-x-container .page-block',
      '#mainBox .bear-web-x-container',
      '.editor-container .page-block',
      '.editor-container',
      '.page-block.root-block',
      '[data-page-id] .page-block',
      '.docx-container'
    ],
    scrollContainer: [
      '.bear-web-x-container',
      '.page-main',
      '#mainBox',
      'main'
    ],
    // Comprehensive exclusion selectors for non-content elements
    excludeSelectors: [
      // Comments
      '.docx-global-comment',
      '.doc-comment-container',
      '.doc-comment-wrapper',
      '.comment-badge',
      '[data-testid*="comment"]',
      '[class*="comment-highlight"]',
      // Sidebar & navigation
      '.bidirection-link-list',
      '.workspace-tree-view-node',
      '.wiki-sidebar',
      '.space-sidebar',
      '.doc-sidebar',
      '.catalog-container',
      '.slide-catalogue-container',
      '.table-of-contents',
      '.doc-toc',
      '[role="navigation"]',
      '[role="complementary"]',
      // Toolbar & header
      '[role="toolbar"]',
      '.suite-header',
      '.docs-toolbar',
      '.toolbar-container',
      '.doc-header-operation',
      '.page-header',
      '[role="banner"]',
      // Footer & meta
      '.lark-docs-reader-footer',
      '.doc-reader-footer',
      '.footer-container',
      '.doc-meta-info',
      // Social & reactions
      '.global-like-wrap',
      '.like-wrap',
      '.reaction-container',
      '.share-btn',
      // AI & popover widgets
      '.docx-ai-widget',
      '.mention-card',
      '.at-user-popover',
      '[class*="tooltip"]',
      '[class*="popover"]',
      // Loading states
      '.loading-container',
      '.skeleton-container',
      // Feishu catalog/outline panel
      '[data-testid="catalog"]',
      '[data-testid="outline"]',
      '.outline-container',
      // Print/export utilities
      '.print-only',
      '.export-btn'
    ],
    // Title selectors
    title: [
      '.docx-title-editor [data-block-type] span',
      '.docx-title span[data-string="true"]',
      '.doc-title-editor .title-content',
      '.page-block [data-block-type="heading1"]:first-child',
      'h1[data-block-type]',
      '.docx-title span',
      '[data-block-type="page"] [data-block-type="heading1"]',
      'h1'
    ]
  };

  function getDocToken() {
    const url = window.location.href;
    const match = url.match(/\/(docx|docs|wiki|space)\/([a-zA-Z0-9_-]+)/);
    return match ? match[2] : null;
  }

  function getDocTitle() {
    for (const sel of SELECTORS.title) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && text.length > 0 && text.length < 200) return text;
      }
    }
    const titleEl = document.querySelector('title');
    if (titleEl) {
      let title = titleEl.textContent
        .replace(/\s*[-–—|·].*?(飞书|Lark|Feishu).*$/i, '')
        .replace(/\s*-\s*Docs$/i, '')
        .trim();
      if (title) return title;
    }
    return 'feishu-document';
  }

  // --- API-based extraction ---

  async function fetchViaAPI(token) {
    const host = window.location.origin;
    const url = `${host}/space/api/docx/pages/client_vars?id=${token}&mode=7&limit=239`;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.code !== 0 || !data.data) return null;

      let allBlocks = extractBlocksFromResponse(data.data);
      if (allBlocks.length === 0) return null;

      // Handle pagination
      const totalPages = data.data.total_pages || 1;
      for (let page = 2; page <= totalPages && page <= 20; page++) {
        await new Promise(r => setTimeout(r, 400));
        const pageUrl = `${host}/space/api/docx/pages/client_vars?id=${token}&mode=7&limit=239&page=${page}`;
        try {
          const pageResp = await fetch(pageUrl, { credentials: 'include' });
          if (pageResp.ok) {
            const pageData = await pageResp.json();
            if (pageData.code === 0 && pageData.data) {
              const pageBlocks = extractBlocksFromResponse(pageData.data);
              allBlocks = allBlocks.concat(pageBlocks);
            }
          }
        } catch (e) { /* continue to next page */ }
      }

      if (allBlocks.length > 0) {
        return Feishu2MDConverter.convertFromBlocks(allBlocks);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function extractBlocksFromResponse(data) {
    // Feishu API returns blocks in various formats depending on version
    const raw = data.blocks || data.client_vars?.blocks || data.block_list || [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object' && raw !== null) return Object.values(raw);
    return [];
  }

  // --- Block tree extraction (from window.PageMain) ---

  function tryBlockTreeExtraction() {
    try {
      // Content scripts run in isolated world; use page script injection to access page globals
      const script = document.createElement('script');
      script.textContent = `
        try {
          const pm = window.PageMain;
          if (pm && pm.blockManager && pm.blockManager.rootBlockModel) {
            const data = JSON.stringify(pm.blockManager.rootBlockModel);
            document.dispatchEvent(new CustomEvent('__feishu2md_blocks__', { detail: data }));
          }
        } catch(e) {}
      `;
      let blockData = null;
      const handler = (e) => { blockData = e.detail; };
      document.addEventListener('__feishu2md_blocks__', handler);
      document.head.appendChild(script);
      script.remove();
      document.removeEventListener('__feishu2md_blocks__', handler);

      if (blockData) {
        const model = JSON.parse(blockData);
        const blocks = flattenBlockModel(model);
        if (blocks.length > 0) {
          return Feishu2MDConverter.convertFromBlocks(blocks);
        }
      }
    } catch (e) { /* fallback to DOM */ }
    return null;
  }

  function flattenBlockModel(model, result = []) {
    if (!model) return result;
    const block = {
      block_id: model.id || model.blockId || `b_${result.length}`,
      block_type: model.type || model.blockType || 2
    };
    if (model.data) Object.assign(block, model.data);
    if (model.text) block.text = model.text;
    if (model.code) block.code = model.code;
    if (model.image) block.image = model.image;
    if (model.table) block.table = model.table;
    if (model.heading) block.heading = model.heading;
    if (model.bullet) block.bullet = model.bullet;
    if (model.ordered) block.ordered = model.ordered;
    if (model.todo) block.todo = model.todo;
    if (model.quote) block.quote = model.quote;

    if (model.children && model.children.length > 0) {
      block.children = [];
      for (const child of model.children) {
        const before = result.length;
        flattenBlockModel(child, result);
        if (result.length > before) {
          block.children.push(result[before].block_id);
        }
      }
    }
    result.push(block);
    return result;
  }

  // --- DOM-based extraction ---

  async function scrollToLoadAll() {
    let scroller = null;
    for (const sel of SELECTORS.scrollContainer) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 100) {
        scroller = el;
        break;
      }
    }
    if (!scroller) return;

    const originalScroll = scroller.scrollTop;
    let lastHeight = scroller.scrollHeight;
    let stableCount = 0;

    while (stableCount < 4) {
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.7, 500);
      await new Promise(r => setTimeout(r, 400));
      if (scroller.scrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = scroller.scrollHeight;
      }
      // Safety limit
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 10) {
        stableCount = 10;
      }
    }
    // Restore scroll position
    scroller.scrollTop = originalScroll;
  }

  function extractFromDOM() {
    let root = null;
    for (const sel of SELECTORS.contentRoot) {
      root = document.querySelector(sel);
      if (root) break;
    }
    if (!root) {
      root = document.querySelector('.page-main') || document.querySelector('main') || document.body;
    }

    // Clone to avoid modifying the live DOM
    const clone = root.cloneNode(true);

    // Remove all non-content elements
    for (const sel of SELECTORS.excludeSelectors) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }
    // Remove scripts, styles, hidden elements
    clone.querySelectorAll('script, style, noscript, template, [hidden]').forEach(el => el.remove());
    // Remove elements with display:none
    clone.querySelectorAll('[style*="display: none"], [style*="display:none"]').forEach(el => el.remove());

    return Feishu2MDConverter.convertFromDOM(clone);
  }

  // --- Image processing: convert private/blob images to base64 ---

  async function processImages(markdown) {
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
  }

  async function processImageSrc(src) {
    if (!src) return src;

    // blob: URLs must always be converted
    if (src.startsWith('blob:')) {
      return await convertBlobToBase64(src);
    }

    // data: URLs are already fine
    if (src.startsWith('data:')) return src;

    // Check if it's a known private feishu image URL
    const isPrivateUrl = (
      src.includes('feishu.cn') ||
      src.includes('larksuite.com') ||
      src.includes('lark-file') ||
      src.includes('bytedance.net') ||
      src.includes('byteimg.com')
    );

    if (!isPrivateUrl) {
      // External images - keep the URL as-is (assumed publicly accessible)
      return src;
    }

    // Private feishu image: try to convert to base64 using the existing session
    return await convertAuthenticatedImageToBase64(src);
  }

  async function convertBlobToBase64(blobUrl) {
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      return await blobToDataUrl(blob);
    } catch (e) {
      return blobUrl; // Return original if fails
    }
  }

  async function convertAuthenticatedImageToBase64(src) {
    try {
      // Fetch with credentials (session cookie) to access private images
      const resp = await fetch(src, { credentials: 'include' });
      if (!resp.ok) return src;
      const blob = await resp.blob();
      if (blob.size === 0) return src;
      return await blobToDataUrl(blob);
    } catch (e) {
      // Try canvas approach as fallback
      return await convertViaCanvas(src);
    }
  }

  function convertViaCanvas(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => resolve(src), 8000);
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          if (canvas.width === 0 || canvas.height === 0) { resolve(src); return; }
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(src); // Canvas tainted
        }
      };
      img.onerror = () => { clearTimeout(timeout); resolve(src); };
      img.src = src;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // --- Main extraction orchestration ---

  async function extractDocument(options = {}) {
    const token = getDocToken();
    const title = getDocTitle();
    const processImgs = options.processImages !== false;

    let markdown = null;

    // Strategy 1: Internal API (most reliable, structured data)
    if (token) {
      markdown = await fetchViaAPI(token);
    }

    // Strategy 2: window.PageMain block tree
    if (!markdown) {
      markdown = tryBlockTreeExtraction();
    }

    // Strategy 3: DOM parsing (fallback)
    if (!markdown) {
      await scrollToLoadAll();
      markdown = extractFromDOM();
    }

    if (!markdown || markdown.trim().length === 0) {
      throw new Error('无法提取文档内容。请确保：\n1. 页面已完全加载\n2. 您有该文档的访问权限\n3. 页面是飞书文档页面');
    }

    // Ensure title is at the top
    if (!markdown.startsWith('# ')) {
      markdown = `# ${title}\n\n${markdown}`;
    }

    // Process images: convert private/blob to base64
    if (processImgs) {
      markdown = await processImages(markdown);
    }

    return { title, markdown };
  }

  // --- Message listener ---

  const browser = (typeof chrome !== 'undefined') ? chrome : (typeof browser !== 'undefined' ? browser : null);
  const runtime = browser?.runtime;

  if (runtime?.onMessage) {
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'extract') {
        extractDocument(msg.options || {})
          .then(result => sendResponse({ success: true, ...result }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open for async response
      }
      if (msg.action === 'ping') {
        sendResponse({ ready: true });
        return false;
      }
    });
  }
})();
