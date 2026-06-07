/**
 * Feishu2MD Converter Engine
 * Converts Feishu document DOM elements or API block data into Markdown.
 */
const Feishu2MDConverter = (() => {

  // --- Text escaping utilities ---

  function escapeInlineText(text) {
    // Only escape characters that would break inline markdown rendering.
    // Do NOT escape inside code spans or already-formatted segments.
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/~/g, '\\~')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeLinkText(text) {
    return text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  }

  function escapeLinkUrl(url) {
    return url.replace(/\)/g, '%29').replace(/ /g, '%20');
  }

  function escapeTableCell(text) {
    return text
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  function escapeCodeContent(text) {
    // Handle backticks inside inline code: use more backticks for the wrapper
    if (!text.includes('`')) return `\`${text}\``;
    if (!text.includes('``')) return `\`\` ${text} \`\``;
    return `\`\`\` ${text} \`\`\``;
  }

  function trimLines(md) {
    return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // --- Image processing ---

  async function processImageSrc(src) {
    if (!src) return null;
    // blob: URLs must be converted
    if (src.startsWith('blob:')) {
      return await convertBlobToBase64(src);
    }
    // data: URLs are already base64
    if (src.startsWith('data:')) return src;
    // Test if URL is publicly accessible
    if (await isImageAccessible(src)) return src;
    // Private image - try to convert via canvas
    return await convertImageToBase64ViaCanvas(src);
  }

  async function isImageAccessible(src) {
    try {
      const resp = await fetch(src, { method: 'HEAD', mode: 'no-cors' });
      // no-cors always gives opaque response, so we try with cors
      const corsResp = await fetch(src, { method: 'HEAD', mode: 'cors' });
      return corsResp.ok;
    } catch (e) {
      // If CORS blocks it, it's likely a private feishu image
      // Heuristic: feishu internal image URLs
      if (src.includes('feishu.cn') || src.includes('larksuite.com') ||
          src.includes('lark-file') || src.includes('bytedance')) {
        return false;
      }
      // External URLs that fail CORS might still be accessible in img tags
      return true;
    }
  }

  async function convertBlobToBase64(blobUrl) {
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      return await blobToDataUrl(blob);
    } catch (e) {
      return null;
    }
  }

  async function convertImageToBase64ViaCanvas(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          // Canvas tainted by CORS
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
      setTimeout(() => resolve(src), 5000);
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

  // --- Inline formatting extraction ---

  function extractInlineFormatting(node, insideCode = false) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Don't escape text inside code elements
      if (insideCode) return text;
      return text;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    // Skip non-content elements
    if (['script', 'style', 'noscript', 'svg', 'button', 'input', 'select', 'textarea'].includes(tag)) return '';
    if (tag === 'br') return '\n';

    if (tag === 'img') {
      const src = node.getAttribute('data-src') || node.getAttribute('src') || '';
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      if (src) return `![${alt}](${escapeLinkUrl(src)})`;
      return '';
    }

    let inner = '';
    for (const child of node.childNodes) {
      inner += extractInlineFormatting(child, insideCode || tag === 'code');
    }

    // Don't wrap if inner is empty or just whitespace
    const trimmed = inner.trim();
    if (!trimmed && !['br'].includes(tag)) return inner; // preserve spaces

    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${inner}~~`;
    if (tag === 'code') return escapeCodeContent(inner);
    if (tag === 'u') return inner; // Markdown has no underline - preserve text
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (!href) return inner;
      return `[${escapeLinkText(inner)}](${escapeLinkUrl(href)})`;
    }
    if (tag === 'mark') return inner;

    // Check inline styles (Feishu often uses inline styles rather than semantic tags)
    const style = node.getAttribute('style') || '';
    let result = inner;
    if (/font-weight:\s*(bold|[6-9]\d{2}|1000)/i.test(style)) result = `**${result}**`;
    if (/font-style:\s*italic/i.test(style)) result = `*${result}*`;
    if (/text-decoration[^:]*:\s*line-through/i.test(style)) result = `~~${result}~~`;

    return result;
  }

  // --- DOM-based conversion ---

  // Full list of non-content selectors to skip during DOM traversal
  const SKIP_CLASSES = new Set([
    'docx-global-comment', 'bidirection-link-list', 'global-like-wrap',
    'workspace-tree-view-node', 'catalog-container', 'slide-catalogue-container',
    'doc-sidebar', 'suite-header', 'lark-docs-reader-footer',
    'doc-comment-container', 'doc-comment-wrapper', 'comment-badge',
    'docx-comment-highlight', 'reaction-container', 'like-wrap',
    'toolbar-container', 'docs-toolbar', 'doc-toc', 'table-of-contents',
    'share-btn', 'doc-meta-info', 'doc-header-operation', 'page-header',
    'sidebar', 'navigation-tree', 'wiki-sidebar', 'space-sidebar',
    'doc-reader-footer', 'footer-container', 'docx-ai-widget',
    'mention-card', 'at-user-popover', 'tooltip', 'popover',
    'loading-container', 'skeleton-container'
  ]);

  const SKIP_TEST_IDS = ['comment', 'toolbar', 'sidebar', 'toc', 'footer', 'header-ops', 'share', 'reaction'];

  function shouldSkipElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    // Check role
    const role = el.getAttribute('role');
    if (role === 'toolbar' || role === 'navigation' || role === 'complementary' || role === 'banner') return true;
    // Check classes
    for (const cls of el.classList) {
      if (SKIP_CLASSES.has(cls)) return true;
      // Partial match patterns
      if (cls.includes('comment') && !cls.includes('container-block')) return true;
      if (cls.includes('toolbar')) return true;
      if (cls.includes('sidebar')) return true;
      if (cls.includes('popover')) return true;
      if (cls.includes('tooltip')) return true;
    }
    // Check data-testid
    const testId = el.getAttribute('data-testid') || '';
    for (const skip of SKIP_TEST_IDS) {
      if (testId.includes(skip)) return true;
    }
    // Hidden elements
    const style = el.getAttribute('style') || '';
    if (/display:\s*none/i.test(style) || /visibility:\s*hidden/i.test(style)) return true;
    if (el.hidden) return true;
    // aria-hidden (but not aria-hidden on decorative elements within content)
    if (el.getAttribute('aria-hidden') === 'true' && !el.closest('[data-block-type]')) return true;

    return false;
  }

  function convertElement(el, indent = '', listContext = null) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (shouldSkipElement(el)) return '';

    const tag = el.tagName.toLowerCase();
    const blockType = el.getAttribute('data-block-type') || el.getAttribute('data-type') ||
                      el.getAttribute('data-node-type') || '';

    // --- Headings ---
    const headingMatch = tag.match(/^h([1-6])$/) || blockType.match(/^heading([1-9])$/);
    if (headingMatch) {
      const level = Math.min(parseInt(headingMatch[1], 10), 6);
      const prefix = '#'.repeat(level);
      return `${prefix} ${getTextContent(el)}\n\n`;
    }
    if (el.getAttribute('role') === 'heading') {
      const level = Math.min(parseInt(el.getAttribute('aria-level') || '1', 10), 6);
      const prefix = '#'.repeat(level);
      return `${prefix} ${getTextContent(el)}\n\n`;
    }

    // --- Divider ---
    if (tag === 'hr' || blockType === 'divider' || blockType === 'horizontal_rule') {
      return '---\n\n';
    }

    // --- Images (return placeholder; actual src processing is async and done in content.js) ---
    if (tag === 'img') {
      const src = el.getAttribute('data-src') || el.getAttribute('src') || '';
      const alt = (el.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      return src ? `![${alt}](${escapeLinkUrl(src)})\n\n` : '';
    }

    // --- Blockquote ---
    if (tag === 'blockquote' || blockType === 'quote' || blockType === 'quote_container') {
      const inner = convertChildren(el, '', null);
      const lines = inner.replace(/\n$/, '').split('\n');
      return lines.map(line => `> ${line}`).join('\n') + '\n\n';
    }

    // --- Code block ---
    if (tag === 'pre' || blockType === 'code' || blockType === 'code_block') {
      const codeEl = el.querySelector('code') || el;
      const lang = codeEl.getAttribute('data-language') ||
                   (codeEl.className.match(/language-(\w+)/) || [])[1] || '';
      // Preserve raw text content without inline formatting
      const code = codeEl.textContent || '';
      // Handle ``` inside code blocks by using more backticks
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${lang}\n${code}\n${fence}\n\n`;
    }

    // --- Table ---
    if (tag === 'table' || blockType === 'table' || el.getAttribute('role') === 'table') {
      return convertTable(el) + '\n';
    }

    // --- Lists (standard HTML) ---
    if (tag === 'ul') return convertList(el, 'unordered', indent) + '\n';
    if (tag === 'ol') return convertList(el, 'ordered', indent) + '\n';

    // --- Feishu block-level list items ---
    if (blockType === 'bullet' || blockType === 'unordered_list') {
      return convertFeishuListBlock(el, '-', indent);
    }
    if (blockType === 'ordered' || blockType === 'ordered_list') {
      return convertFeishuListBlock(el, '1.', indent);
    }
    if (blockType === 'todo' || blockType === 'todoList') {
      const checked = el.querySelector('[data-checked="true"], input:checked, [aria-checked="true"]') !== null;
      const mark = checked ? '[x]' : '[ ]';
      return `${indent}- ${mark} ${getTextContent(el)}\n`;
    }

    // --- Callout ---
    if (blockType === 'callout') {
      const inner = convertChildren(el, '', null);
      const lines = inner.replace(/\n$/, '').split('\n');
      return lines.map(line => `> ${line}`).join('\n') + '\n\n';
    }

    // --- Paragraph ---
    if (tag === 'p' || blockType === 'text' || blockType === 'paragraph') {
      const text = getTextContent(el);
      return text ? `${text}\n\n` : '';
    }

    // --- Generic containers ---
    if (tag === 'li') {
      // Handled by convertList; if we hit this standalone, treat as paragraph
      const text = getListItemText(el);
      return text ? `- ${text}\n` : '';
    }
    if (['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'].includes(tag)) {
      return convertChildren(el, indent, listContext);
    }
    if (tag === 'span') return extractInlineFormatting(el);

    return convertChildren(el, indent, listContext);
  }

  function getTextContent(el) {
    let result = '';
    for (const child of el.childNodes) {
      result += extractInlineFormatting(child);
    }
    return result.trim();
  }

  function convertChildren(el, indent, listContext) {
    let result = '';
    for (const child of el.children) {
      result += convertElement(child, indent, listContext);
    }
    return result;
  }

  // --- Feishu block-level list items with nesting ---

  function convertFeishuListBlock(el, prefix, indent) {
    const level = parseInt(el.getAttribute('data-level') || el.getAttribute('data-indent') || '0', 10);
    const currentIndent = indent + '    '.repeat(level);
    const text = getTextContent(el);
    let result = `${currentIndent}${prefix} ${text}\n`;
    // Check for nested child blocks
    const childBlocks = el.querySelectorAll(':scope > [data-block-type]');
    for (const child of childBlocks) {
      const childType = child.getAttribute('data-block-type') || '';
      if (childType === 'bullet' || childType === 'ordered' || childType === 'todo') {
        result += convertElement(child, currentIndent + '    ', null);
      }
    }
    return result;
  }

  // --- List conversion ---

  function convertList(el, type, indent) {
    let result = '';
    let counter = 1;
    for (const child of el.children) {
      const childTag = child.tagName?.toLowerCase();
      if (childTag !== 'li') continue;
      const prefix = type === 'ordered' ? `${counter}.` : '-';
      const text = getListItemText(child);
      result += `${indent}${prefix} ${text}\n`;
      counter++;
      // Recursively handle nested lists
      for (const subChild of child.children) {
        const subTag = subChild.tagName?.toLowerCase();
        if (subTag === 'ul') {
          result += convertList(subChild, 'unordered', indent + '    ');
        } else if (subTag === 'ol') {
          result += convertList(subChild, 'ordered', indent + '    ');
        }
      }
    }
    return result;
  }

  function getListItemText(li) {
    let text = '';
    for (const child of li.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') continue; // Skip nested lists
        text += extractInlineFormatting(child);
      } else {
        text += extractInlineFormatting(child);
      }
    }
    return text.trim();
  }

  // --- Table conversion (robust merged cell handling) ---

  function convertTable(tableEl) {
    // Collect all rows - handle both direct tr and nested tbody/thead
    const rows = [];
    const directRows = tableEl.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr');
    if (directRows.length > 0) {
      directRows.forEach(r => rows.push(r));
    } else {
      // Feishu might use role-based tables
      tableEl.querySelectorAll('[role="row"]').forEach(r => rows.push(r));
    }
    if (rows.length === 0) return '';

    // First pass: determine grid dimensions and build cell map
    const matrix = [];
    const occupied = []; // Track which cells are already filled by rowspan/colspan

    rows.forEach((row, rowIdx) => {
      if (!matrix[rowIdx]) matrix[rowIdx] = [];
      if (!occupied[rowIdx]) occupied[rowIdx] = [];

      const cells = row.querySelectorAll(':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="columnheader"], :scope > [role="rowheader"]');
      let colIdx = 0;

      cells.forEach(cell => {
        // Skip over columns already occupied by a previous rowspan/colspan
        while (occupied[rowIdx] && occupied[rowIdx][colIdx]) colIdx++;

        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10));
        const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10));
        const cellContent = escapeTableCell(getTextContent(cell));

        // Fill the matrix
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            const r = rowIdx + dr;
            const c = colIdx + dc;
            if (!matrix[r]) matrix[r] = [];
            if (!occupied[r]) occupied[r] = [];
            occupied[r][c] = true;
            if (dr === 0 && dc === 0) {
              // Primary cell - put content here
              matrix[r][c] = cellContent;
            } else {
              // Spanned cell - repeat content for merged cells so no data is lost
              // Use empty string for visual clarity but add content for cells that span rows
              matrix[r][c] = (dr > 0 && dc === 0) ? cellContent : '';
            }
          }
        }
        colIdx += colspan;
      });
    });

    if (matrix.length === 0) return '';

    // Determine max columns
    let maxCols = 0;
    for (const row of matrix) {
      if (row && row.length > maxCols) maxCols = row.length;
    }
    if (maxCols === 0) return '';

    // Fill gaps
    for (let r = 0; r < matrix.length; r++) {
      if (!matrix[r]) matrix[r] = [];
      for (let c = 0; c < maxCols; c++) {
        if (matrix[r][c] === undefined || matrix[r][c] === null) {
          matrix[r][c] = '';
        }
      }
    }

    // Build markdown table
    let md = '| ' + matrix[0].join(' | ') + ' |\n';
    md += '|' + matrix[0].map(() => ' --- ').join('|') + '|\n';
    for (let r = 1; r < matrix.length; r++) {
      md += '| ' + matrix[r].join(' | ') + ' |\n';
    }
    return md;
  }

  // --- API block-based conversion ---

  function convertBlocks(blocks, blockMap) {
    let md = '';
    for (const block of blocks) {
      md += convertBlock(block, blockMap, 0);
    }
    return trimLines(md);
  }

  function convertBlock(block, blockMap, depth) {
    if (!block) return '';
    const type = block.block_type;
    const indent = '    '.repeat(depth);
    let result = '';

    switch (type) {
      case 1: { // Page (root)
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth);
          }
        }
        break;
      }

      case 2: { // Text/paragraph
        const text = convertTextBlock(block);
        result = text ? text + '\n\n' : '\n';
        break;
      }

      case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11: {
        const level = Math.min(type - 2, 6);
        const prefix = '#'.repeat(level);
        result = `${prefix} ${convertTextBlock(block)}\n\n`;
        break;
      }

      case 12: { // Bullet list
        result = `${indent}- ${convertTextBlock(block)}\n`;
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth + 1);
          }
        }
        break;
      }

      case 13: { // Ordered list
        result = `${indent}1. ${convertTextBlock(block)}\n`;
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth + 1);
          }
        }
        break;
      }

      case 14: { // Code block
        const langMap = { 0: '', 1: 'python', 2: 'javascript', 3: 'java', 4: 'go', 5: 'c', 6: 'cpp',
          7: 'csharp', 8: 'ruby', 9: 'rust', 10: 'swift', 11: 'kotlin', 12: 'typescript',
          13: 'php', 14: 'shell', 15: 'sql', 16: 'json', 17: 'xml', 18: 'yaml', 19: 'html', 20: 'css' };
        const langCode = block.code?.style?.language;
        const lang = (typeof langCode === 'number' ? langMap[langCode] : langCode) || '';
        const elements = block.code?.elements || block.text?.elements || [];
        const code = extractBlockTextRaw(elements);
        const fence = code.includes('```') ? '````' : '```';
        result = `${fence}${lang}\n${code}\n${fence}\n\n`;
        break;
      }

      case 15: // Quote
      case 34: { // Quote container
        let inner = '';
        if (block.children && block.children.length > 0) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) inner += convertBlock(child, blockMap, 0);
          }
        } else {
          inner = convertTextBlock(block) + '\n';
        }
        const lines = inner.replace(/\n$/, '').split('\n');
        result = lines.map(l => `> ${l}`).join('\n') + '\n\n';
        break;
      }

      case 17: { // Todo
        const checked = block.todo?.style?.done ? '[x]' : '[ ]';
        result = `${indent}- ${checked} ${convertTextBlock(block)}\n`;
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth + 1);
          }
        }
        break;
      }

      case 19: { // Callout
        let inner = '';
        if (block.children && block.children.length > 0) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) inner += convertBlock(child, blockMap, 0);
          }
        } else {
          inner = convertTextBlock(block) + '\n';
        }
        const lines = inner.replace(/\n$/, '').split('\n');
        result = lines.map(l => `> ${l}`).join('\n') + '\n\n';
        break;
      }

      case 22: // Divider
        result = '---\n\n';
        break;

      case 27: { // Image
        const token = block.image?.token || '';
        const src = block.image?.url || (token ? `https://internal-api-lark-file.feishu.cn/open-apis/drive/v1/medias/${token}/download` : '');
        if (src) result = `![](${escapeLinkUrl(src)})\n\n`;
        break;
      }

      case 31: { // Table
        result = convertBlockTable(block, blockMap) + '\n';
        break;
      }

      case 32: // Table cell - handled within table conversion
        break;

      default: {
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth);
          }
        }
        break;
      }
    }
    return result;
  }

  function convertTextBlock(block) {
    const elements = block.text?.elements || block.heading?.elements ||
                     block.todo?.elements || block.bullet?.elements ||
                     block.ordered?.elements || block.quote?.elements || [];
    return extractBlockText(elements);
  }

  function extractBlockText(elements) {
    let text = '';
    for (const el of elements) {
      if (el.text_run) {
        let content = el.text_run.content || '';
        if (content === '\n' && elements.length === 1) return ''; // Empty block
        const style = el.text_run.text_element_style || {};

        // Apply formatting in correct order: innermost first
        if (style.inline_code) {
          content = escapeCodeContent(content);
        } else {
          // Only apply other formatting if not code
          if (style.bold && style.italic) {
            content = `***${content}***`;
          } else if (style.bold) {
            content = `**${content}**`;
          } else if (style.italic) {
            content = `*${content}*`;
          }
          if (style.strikethrough) {
            content = `~~${content}~~`;
          }
        }
        if (style.link?.url) {
          const url = decodeURIComponent(style.link.url);
          content = `[${escapeLinkText(content)}](${escapeLinkUrl(url)})`;
        }
        text += content;
      } else if (el.mention_doc) {
        const title = el.mention_doc.title || 'link';
        const url = el.mention_doc.url || '';
        text += `[${escapeLinkText(title)}](${escapeLinkUrl(url)})`;
      } else if (el.equation) {
        text += `$${el.equation.content || ''}$`;
      }
    }
    return text.trim();
  }

  function extractBlockTextRaw(elements) {
    // For code blocks: just concatenate text without any formatting
    let text = '';
    for (const el of elements) {
      if (el.text_run) {
        text += el.text_run.content || '';
      }
    }
    // Remove trailing newline that Feishu sometimes adds
    return text.replace(/\n$/, '');
  }

  // --- Block-based table conversion (improved merged cell handling) ---

  function convertBlockTable(block, blockMap) {
    const property = block.table?.property || {};
    const rows = property.row_size || 0;
    const cols = property.column_size || 0;
    if (rows === 0 || cols === 0) return '';

    const mergeInfo = property.merge_info || [];
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(''));
    const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));

    const children = block.children || [];

    // In Feishu's API, table cells are listed row by row, left to right,
    // skipping cells that are covered by merges from above/left.
    let childIdx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;

        if (childIdx >= children.length) break;
        const childId = children[childIdx];
        childIdx++;

        const cellBlock = blockMap[childId];
        let cellText = '';
        if (cellBlock) {
          if (cellBlock.children && cellBlock.children.length > 0) {
            const parts = [];
            for (const subId of cellBlock.children) {
              const sub = blockMap[subId];
              if (sub) {
                const t = convertTextBlock(sub);
                if (t) parts.push(t);
              }
            }
            cellText = parts.join(' / ');
          } else {
            cellText = convertTextBlock(cellBlock);
          }
        }
        cellText = escapeTableCell(cellText);

        // Check merge info for this cell
        const merge = mergeInfo.length > 0 ? mergeInfo[childIdx - 1] : null;
        const rowSpan = merge?.row_span || 1;
        const colSpan = merge?.col_span || 1;

        // Mark occupied cells
        for (let dr = 0; dr < rowSpan; dr++) {
          for (let dc = 0; dc < colSpan; dc++) {
            const mr = r + dr;
            const mc = c + dc;
            if (mr < rows && mc < cols) {
              occupied[mr][mc] = true;
              if (dr === 0 && dc === 0) {
                matrix[mr][mc] = cellText;
              } else if (dc === 0) {
                // Row-spanned cells: repeat content so nothing is lost
                matrix[mr][mc] = cellText;
              }
              // Column-spanned cells beyond first: leave empty
            }
          }
        }
      }
    }

    // Build markdown
    let md = '| ' + matrix[0].join(' | ') + ' |\n';
    md += '|' + Array(cols).fill(' --- ').join('|') + '|\n';
    for (let r = 1; r < rows; r++) {
      md += '| ' + matrix[r].join(' | ') + ' |\n';
    }
    return md;
  }

  // --- Public API ---

  return {
    convertFromDOM(rootEl) {
      if (!rootEl) return '';
      return trimLines(convertChildren(rootEl, '', null));
    },

    convertFromBlocks(blocks) {
      if (!blocks || blocks.length === 0) return '';
      const blockMap = {};
      for (const block of blocks) {
        if (block && block.block_id) {
          blockMap[block.block_id] = block;
        }
      }
      const rootBlocks = blocks.filter(b => b.block_type === 1);
      if (rootBlocks.length > 0) {
        return convertBlocks(rootBlocks, blockMap);
      }
      return convertBlocks(blocks, blockMap);
    },

    // Exposed for image processing in content.js
    processImageSrc,
    convertElement,
    extractInlineFormatting,
    escapeTableCell,
    escapeCodeContent,
    escapeLinkText,
    escapeLinkUrl,
    trimLines
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Feishu2MDConverter;
}
