/**
 * Feishu2MD Content Script
 * Extracts document content from Feishu pages via API or DOM fallback.
 */
(() => {
  const SELECTORS = {
    contentRoot: [
      '.page-main-item.editor',
      '#mainBox .bear-web-x-container',
      '.editor-container',
      '.page-block.root-block',
      '.docx-container',
      '[data-page-id]'
    ],
    scrollContainer: [
      '.bear-web-x-container',
      '[class*="scroll"]',
      '.page-main'
    ],
    excludeSelectors: [
      '.docx-global-comment',
      '.bidirection-link-list',
      '.global-like-wrap',
      '.workspace-tree-view-node',
      '[data-testid*="comment"]',
      '[role="toolbar"]',
      '.catalog-container',
      '.slide-catalogue-container',
      '.doc-sidebar',
      '.suite-header',
      '.lark-docs-reader-footer'
    ],
    title: [
      '.docx-title-editor [data-block-type] span',
      '.doc-title-editor .title-content',
      '.page-block [data-block-type="heading1"]',
      'h1[data-block-type]',
      '.docx-title span',
      'h1'
    ]
  };

  function getDocToken() {
    const url = window.location.href;
    const match = url.match(/\/(docx|docs|wiki|space)\/([a-zA-Z0-9]+)/);
    return match ? match[2] : null;
  }

  function getDocTitle() {
    for (const sel of SELECTORS.title) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    const titleEl = document.querySelector('title');
    if (titleEl) {
      let title = titleEl.textContent.replace(/\s*[-–—|].*飞书.*$/i, '').trim();
      if (title) return title;
    }
    return 'feishu-document';
  }

  async function fetchViaAPI(token) {
    const host = window.location.origin;
    const url = `${host}/space/api/docx/pages/client_vars?id=${token}&mode=7&limit=239`;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.code !== 0 || !data.data) return null;

      let allBlocks = [];
      const blocks = data.data.blocks || data.data.client_vars?.blocks || [];
      if (Array.isArray(blocks)) {
        allBlocks = blocks;
      } else if (typeof blocks === 'object') {
        allBlocks = Object.values(blocks);
      }

      const totalPages = data.data.total_pages || 1;
      for (let page = 2; page <= totalPages && page <= 20; page++) {
        await new Promise(r => setTimeout(r, 300));
        const pageUrl = `${host}/space/api/docx/pages/client_vars?id=${token}&mode=7&limit=239&page=${page}`;
        try {
          const pageResp = await fetch(pageUrl, { credentials: 'include' });
          if (pageResp.ok) {
            const pageData = await pageResp.json();
            if (pageData.code === 0 && pageData.data) {
              const pageBlocks = pageData.data.blocks || pageData.data.client_vars?.blocks || [];
              if (Array.isArray(pageBlocks)) {
                allBlocks = allBlocks.concat(pageBlocks);
              } else if (typeof pageBlocks === 'object') {
                allBlocks = allBlocks.concat(Object.values(pageBlocks));
              }
            }
          }
        } catch (e) { /* continue */ }
      }

      if (allBlocks.length > 0) {
        return Feishu2MDConverter.convertFromBlocks(allBlocks);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function scrollToLoadAll() {
    let scroller = null;
    for (const sel of SELECTORS.scrollContainer) {
      scroller = document.querySelector(sel);
      if (scroller && scroller.scrollHeight > scroller.clientHeight) break;
    }
    if (!scroller) return;

    const maxScrolls = 50;
    let scrollCount = 0;
    let lastHeight = scroller.scrollHeight;

    while (scrollCount < maxScrolls) {
      scroller.scrollTop = scroller.scrollTop + Math.max(scroller.clientHeight * 0.8, 600);
      await new Promise(r => setTimeout(r, 300));
      if (scroller.scrollHeight === lastHeight) {
        scrollCount++;
        if (scrollCount > 3) break;
      } else {
        scrollCount = 0;
        lastHeight = scroller.scrollHeight;
      }
    }

    scroller.scrollTop = 0;
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

    const clone = root.cloneNode(true);

    for (const sel of SELECTORS.excludeSelectors) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());

    return Feishu2MDConverter.convertFromDOM(clone);
  }

  function tryBlockTreeExtraction() {
    try {
      const pageMain = window.wrappedJSObject?.PageMain || window.PageMain;
      if (pageMain?.blockManager?.rootBlockModel) {
        const rootModel = pageMain.blockManager.rootBlockModel;
        const blocks = serializeBlockTree(rootModel);
        if (blocks.length > 0) {
          return Feishu2MDConverter.convertFromBlocks(blocks);
        }
      }
    } catch (e) { /* not available */ }
    return null;
  }

  function serializeBlockTree(model, result = []) {
    if (!model) return result;
    const block = {
      block_id: model.id || model.blockId || String(result.length),
      block_type: model.type || model.blockType || 2,
      children: []
    };
    if (model.data) {
      Object.assign(block, model.data);
    }
    if (model.text) block.text = model.text;
    if (model.children && model.children.length > 0) {
      block.children = [];
      for (const child of model.children) {
        const childBlock = serializeBlockTree(child, result);
        block.children.push(childBlock[childBlock.length - 1]?.block_id);
      }
    }
    result.push(block);
    return result;
  }

  async function extractDocument() {
    const token = getDocToken();
    const title = getDocTitle();

    let markdown = null;

    if (token) {
      markdown = await fetchViaAPI(token);
    }

    if (!markdown) {
      markdown = tryBlockTreeExtraction();
    }

    if (!markdown) {
      await scrollToLoadAll();
      markdown = extractFromDOM();
    }

    if (!markdown || markdown.trim().length === 0) {
      throw new Error('无法提取文档内容，请确保页面已完全加载');
    }

    if (!markdown.startsWith('# ')) {
      markdown = `# ${title}\n\n${markdown}`;
    }

    return { title, markdown };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'extract') {
      extractDocument()
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'ping') {
      sendResponse({ ready: true });
      return false;
    }
  });
})();
