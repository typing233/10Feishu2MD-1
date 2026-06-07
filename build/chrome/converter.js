/**
 * Feishu2MD Converter Engine
 * Converts Feishu document DOM elements or API block data into Markdown.
 */
const Feishu2MDConverter = (() => {

  function escapeMarkdown(text) {
    return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
  }

  function trimLines(md) {
    return md.replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- Inline formatting extraction ---

  function extractInlineFormatting(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    if (tag === 'br') return '\n';
    if (tag === 'img') {
      const src = node.getAttribute('data-src') || node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (src) return `![${alt}](${src})`;
      return '';
    }

    let inner = '';
    for (const child of node.childNodes) {
      inner += extractInlineFormatting(child);
    }
    if (!inner) return '';

    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${inner}~~`;
    if (tag === 'code') return `\`${inner}\``;
    if (tag === 'u') return inner;
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      return href ? `[${inner}](${href})` : inner;
    }

    const style = node.getAttribute('style') || '';
    if (/font-weight:\s*(bold|[6-9]\d{2})/i.test(style)) return `**${inner}**`;
    if (/font-style:\s*italic/i.test(style)) return `*${inner}*`;
    if (/text-decoration[^:]*:\s*line-through/i.test(style)) return `~~${inner}~~`;

    return inner;
  }

  // --- DOM-based conversion ---

  function convertElement(el, indent = '', listCounters = {}) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = el.tagName.toLowerCase();
    const blockType = el.getAttribute('data-block-type') || el.getAttribute('data-type') || '';

    if (['script', 'style', 'noscript', 'svg', 'button', 'input', 'select', 'textarea'].includes(tag)) return '';
    if (el.classList.contains('docx-global-comment') ||
        el.classList.contains('bidirection-link-list') ||
        el.classList.contains('global-like-wrap') ||
        el.classList.contains('workspace-tree-view-node') ||
        el.getAttribute('data-testid')?.includes('comment') ||
        el.getAttribute('role') === 'toolbar') {
      return '';
    }

    if (tag === 'h1' || blockType === 'heading1') return `# ${getTextContent(el)}\n\n`;
    if (tag === 'h2' || blockType === 'heading2') return `## ${getTextContent(el)}\n\n`;
    if (tag === 'h3' || blockType === 'heading3') return `### ${getTextContent(el)}\n\n`;
    if (tag === 'h4' || blockType === 'heading4') return `#### ${getTextContent(el)}\n\n`;
    if (tag === 'h5' || blockType === 'heading5') return `##### ${getTextContent(el)}\n\n`;
    if (tag === 'h6' || blockType === 'heading6') return `###### ${getTextContent(el)}\n\n`;

    if (el.getAttribute('role') === 'heading') {
      const level = parseInt(el.getAttribute('aria-level') || '1', 10);
      const prefix = '#'.repeat(Math.min(level, 6));
      return `${prefix} ${getTextContent(el)}\n\n`;
    }

    if (tag === 'hr' || blockType === 'divider' || blockType === 'horizontal_rule') {
      return `---\n\n`;
    }

    if (tag === 'img') {
      const src = el.getAttribute('data-src') || el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      return src ? `![${alt}](${src})\n\n` : '';
    }

    if (tag === 'blockquote' || blockType === 'quote' || blockType === 'quote_container') {
      const inner = convertChildren(el, indent, listCounters);
      return inner.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
    }

    if (tag === 'pre' || blockType === 'code' || blockType === 'code_block') {
      const codeEl = el.querySelector('code') || el;
      const lang = codeEl.getAttribute('data-language') || codeEl.className.match(/language-(\w+)/)?.[1] || '';
      const code = codeEl.textContent || '';
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    if (tag === 'table' || blockType === 'table' || el.getAttribute('role') === 'table') {
      return convertTable(el) + '\n\n';
    }

    if (tag === 'ul') {
      return convertList(el, 'unordered', indent) + '\n';
    }
    if (tag === 'ol') {
      return convertList(el, 'ordered', indent) + '\n';
    }

    if (tag === 'li' || blockType === 'bullet' || blockType === 'ordered') {
      return convertListItem(el, blockType, indent, listCounters);
    }

    if (blockType === 'todo') {
      const checked = el.querySelector('[data-checked="true"], input:checked') !== null;
      const mark = checked ? '[x]' : '[ ]';
      return `${indent}- ${mark} ${getTextContent(el)}\n`;
    }

    if (blockType === 'callout') {
      const inner = convertChildren(el, indent, listCounters);
      return inner.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
    }

    if (tag === 'p' || blockType === 'text' || blockType === 'paragraph') {
      const text = getTextContent(el);
      return text ? `${text}\n\n` : '';
    }

    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') {
      if (tag === 'span') return getTextContent(el);
      return convertChildren(el, indent, listCounters);
    }

    return convertChildren(el, indent, listCounters);
  }

  function getTextContent(el) {
    let result = '';
    for (const child of el.childNodes) {
      result += extractInlineFormatting(child);
    }
    return result.trim();
  }

  function convertChildren(el, indent, listCounters) {
    let result = '';
    for (const child of el.children) {
      result += convertElement(child, indent, listCounters);
    }
    return result;
  }

  // --- List conversion ---

  function convertList(el, type, indent) {
    let result = '';
    let counter = 1;
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const prefix = type === 'ordered' ? `${counter}. ` : '- ';
      const text = getListItemText(li);
      result += `${indent}${prefix}${text}\n`;
      counter++;
      const nested = li.querySelector('ul, ol');
      if (nested) {
        const nestedType = nested.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered';
        result += convertList(nested, nestedType, indent + '    ');
      }
    }
    return result;
  }

  function getListItemText(li) {
    let text = '';
    for (const child of li.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') continue;
        text += extractInlineFormatting(child);
      } else {
        text += extractInlineFormatting(child);
      }
    }
    return text.trim();
  }

  function convertListItem(el, blockType, indent, listCounters) {
    const level = parseInt(el.getAttribute('data-level') || '0', 10);
    const currentIndent = indent + '    '.repeat(level);
    const prefix = blockType === 'ordered' ? '1. ' : '- ';
    const text = getTextContent(el);
    return `${currentIndent}${prefix}${text}\n`;
  }

  // --- Table conversion ---

  function convertTable(tableEl) {
    const rows = tableEl.querySelectorAll('tr, [role="row"]');
    if (rows.length === 0) return '';

    const matrix = [];
    let maxCols = 0;

    rows.forEach((row, rowIdx) => {
      if (!matrix[rowIdx]) matrix[rowIdx] = [];
      const cells = row.querySelectorAll('td, th, [role="cell"], [role="columnheader"], [role="rowheader"]');
      let colIdx = 0;

      cells.forEach(cell => {
        while (matrix[rowIdx][colIdx]) colIdx++;
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        const text = getTextContent(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ');

        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (!matrix[rowIdx + r]) matrix[rowIdx + r] = [];
            if (r === 0 && c === 0) {
              matrix[rowIdx + r][colIdx + c] = text;
            } else {
              matrix[rowIdx + r][colIdx + c] = '';
            }
          }
        }
        colIdx += colspan;
        if (colIdx > maxCols) maxCols = colIdx;
      });
    });

    if (matrix.length === 0 || maxCols === 0) return '';

    for (let r = 0; r < matrix.length; r++) {
      if (!matrix[r]) matrix[r] = [];
      for (let c = 0; c < maxCols; c++) {
        if (matrix[r][c] === undefined) matrix[r][c] = '';
      }
    }

    let md = '';
    md += '| ' + matrix[0].join(' | ') + ' |\n';
    md += '| ' + matrix[0].map(() => '---').join(' | ') + ' |\n';
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
    const type = block.block_type;
    const indent = '    '.repeat(depth);
    let result = '';

    switch (type) {
      case 1: // Page (root) - process children
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth);
          }
        }
        break;

      case 2: // Text/paragraph
        result = convertTextBlock(block) + '\n\n';
        break;

      case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11: {
        const level = type - 2;
        const prefix = '#'.repeat(Math.min(level, 6));
        result = `${prefix} ${convertTextBlock(block)}\n\n`;
        break;
      }

      case 12: // Bullet list
        result = `${indent}- ${convertTextBlock(block)}\n`;
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth + 1);
          }
        }
        break;

      case 13: // Ordered list
        result = `${indent}1. ${convertTextBlock(block)}\n`;
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth + 1);
          }
        }
        break;

      case 14: { // Code block
        const lang = block.code?.style?.language || '';
        const code = extractBlockText(block.code?.elements || block.text?.elements || []);
        result = `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        break;
      }

      case 15: // Quote
      case 34: // Quote container
        if (block.children) {
          let inner = '';
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) inner += convertBlock(child, blockMap, 0);
          }
          result = inner.split('\n').map(l => l ? `> ${l}` : '>').join('\n') + '\n\n';
        } else {
          result = `> ${convertTextBlock(block)}\n\n`;
        }
        break;

      case 17: { // Todo
        const checked = block.todo?.style?.done ? '[x]' : '[ ]';
        result = `${indent}- ${checked} ${convertTextBlock(block)}\n`;
        break;
      }

      case 19: { // Callout
        let inner = '';
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) inner += convertBlock(child, blockMap, 0);
          }
        } else {
          inner = convertTextBlock(block);
        }
        result = inner.split('\n').map(l => l ? `> ${l}` : '>').join('\n') + '\n\n';
        break;
      }

      case 22: // Divider
        result = '---\n\n';
        break;

      case 27: { // Image
        const token = block.image?.token || '';
        const src = block.image?.url || (token ? `https://internal-api-lark-file.feishu.cn/open-apis/drive/v1/medias/${token}/download` : '');
        result = `![](${src})\n\n`;
        break;
      }

      case 31: { // Table
        result = convertBlockTable(block, blockMap) + '\n\n';
        break;
      }

      default:
        if (block.children) {
          for (const childId of block.children) {
            const child = blockMap[childId];
            if (child) result += convertBlock(child, blockMap, depth);
          }
        }
        break;
    }
    return result;
  }

  function convertTextBlock(block) {
    const elements = block.text?.elements || block.heading?.elements || block.todo?.elements || block.bullet?.elements || block.ordered?.elements || [];
    return extractBlockText(elements);
  }

  function extractBlockText(elements) {
    let text = '';
    for (const el of elements) {
      if (el.text_run) {
        let content = el.text_run.content || '';
        const style = el.text_run.text_element_style || {};
        if (style.inline_code) content = `\`${content}\``;
        if (style.bold) content = `**${content}**`;
        if (style.italic) content = `*${content}*`;
        if (style.strikethrough) content = `~~${content}~~`;
        if (style.link?.url) {
          const url = decodeURIComponent(style.link.url);
          content = `[${content}](${url})`;
        }
        text += content;
      } else if (el.mention_doc) {
        const title = el.mention_doc.title || 'link';
        const url = el.mention_doc.url || '';
        text += `[${title}](${url})`;
      } else if (el.equation) {
        text += `$${el.equation.content || ''}$`;
      }
    }
    return text.trim();
  }

  function convertBlockTable(block, blockMap) {
    const rows = block.table?.property?.row_size || 0;
    const cols = block.table?.property?.column_size || 0;
    if (rows === 0 || cols === 0) return '';

    const mergeInfo = block.table?.property?.merge_info || [];
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(''));
    const filled = Array.from({ length: rows }, () => Array(cols).fill(false));

    const children = block.children || [];
    let cellIdx = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (filled[r][c]) continue;
        const childId = children[cellIdx];
        cellIdx++;
        if (!childId) continue;

        const cellBlock = blockMap[childId];
        let cellText = '';
        if (cellBlock && cellBlock.children) {
          for (const subId of cellBlock.children) {
            const sub = blockMap[subId];
            if (sub) cellText += convertTextBlock(sub) + ' ';
          }
        }
        cellText = cellText.trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');

        const merge = mergeInfo[cellIdx - 1];
        const rowSpan = merge?.row_span || 1;
        const colSpan = merge?.col_span || 1;

        for (let dr = 0; dr < rowSpan; dr++) {
          for (let dc = 0; dc < colSpan; dc++) {
            if (r + dr < rows && c + dc < cols) {
              filled[r + dr][c + dc] = true;
              if (dr === 0 && dc === 0) matrix[r][c] = cellText;
            }
          }
        }
      }
    }

    let md = '| ' + matrix[0].join(' | ') + ' |\n';
    md += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';
    for (let r = 1; r < rows; r++) {
      md += '| ' + matrix[r].join(' | ') + ' |\n';
    }
    return md;
  }

  // --- Public API ---

  return {
    convertFromDOM(rootEl) {
      if (!rootEl) return '';
      return trimLines(convertChildren(rootEl, '', {}));
    },

    convertFromBlocks(blocks) {
      const blockMap = {};
      for (const block of blocks) {
        blockMap[block.block_id] = block;
      }
      const rootBlocks = blocks.filter(b => b.block_type === 1);
      if (rootBlocks.length > 0) {
        return convertBlocks(rootBlocks, blockMap);
      }
      return convertBlocks(blocks, blockMap);
    },

    convertElement,
    extractInlineFormatting,
    trimLines
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Feishu2MDConverter;
}
