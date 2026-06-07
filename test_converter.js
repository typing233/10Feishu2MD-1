/**
 * Test suite for Feishu2MD converter.
 * Run with: node test_converter.js
 */

// Minimal DOM simulation for Node.js testing
class MockNode {
  constructor(type, tag = '', attrs = {}, children = []) {
    this.nodeType = type;
    this.tagName = tag.toUpperCase();
    this.attributes = attrs;
    this.childNodes = children;
    this.children = children.filter(c => c.nodeType === 1);
    this.classList = new MockClassList(attrs.class || '');
    this.hidden = false;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  querySelector(sel) { return null; }
  querySelectorAll(sel) { return []; }
  get textContent() {
    return this.childNodes.map(c => c.textContent || c.text || '').join('');
  }
  closest() { return null; }
}
class MockClassList {
  constructor(cls) { this._classes = cls ? cls.split(/\s+/) : []; }
  has(c) { return this._classes.includes(c); }
  contains(c) { return this._classes.includes(c); }
  [Symbol.iterator]() { return this._classes[Symbol.iterator](); }
}
class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.text = text; }
}

// Globals needed by converter
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
global.document = { createElement: () => ({}) };

const Feishu2MDConverter = require('./converter.js');

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.log(`  ✗ ${testName}`);
    if (detail) console.log(`    ${detail}`);
    failed++;
  }
}

function assertContains(actual, expected, testName) {
  assert(actual.includes(expected), testName, `Expected to contain: "${expected}"\n    Got: "${actual.substring(0, 200)}"`);
}

function assertEqual(actual, expected, testName) {
  assert(actual === expected, testName, `Expected: "${expected}"\n    Got: "${actual}"`);
}

// ============================================================
// TEST 1: Markdown special character escaping
// ============================================================
console.log('\n=== Test: Special character escaping ===');

{
  const result = Feishu2MDConverter.escapeTableCell('cell with | pipe and\nnewline');
  assertEqual(result, 'cell with \\| pipe and newline', 'Table cell escapes pipe and newline');
}
{
  const result = Feishu2MDConverter.escapeLinkText('text [with] brackets');
  assertEqual(result, 'text \\[with\\] brackets', 'Link text escapes brackets');
}
{
  const result = Feishu2MDConverter.escapeLinkUrl('https://example.com/path (1)/file');
  assertEqual(result, 'https://example.com/path%20(1%29/file', 'URL escapes spaces and closing paren for Markdown safety');
}
{
  const result = Feishu2MDConverter.escapeCodeContent('code with `backtick`');
  assert(result.includes('``'), 'Code content with backtick uses double backtick wrapper');
  assert(!result.startsWith('`c'), 'Code with backtick does NOT use single wrapper');
}
{
  const result = Feishu2MDConverter.escapeCodeContent('normal code');
  assertEqual(result, '`normal code`', 'Normal code uses single backtick');
}

// ============================================================
// TEST 2: API block-based table with merged cells
// ============================================================
console.log('\n=== Test: Merged cell table (API blocks) ===');

{
  // Simulate a 3x3 table where top-left 2x2 cells are merged
  const blocks = [
    { block_id: 'table1', block_type: 31, table: { property: { row_size: 3, column_size: 3, merge_info: [
      { row_span: 2, col_span: 2 }, // first cell spans 2x2
      null, // (0,2)
      null, // (1,2) - because (1,0) and (1,1) are occupied
      null, // (2,0)
      null, // (2,1)
      null  // (2,2)
    ]}}, children: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] },
    // Cell blocks (each cell has a text child)
    { block_id: 'c1', block_type: 32, children: ['t1'] },
    { block_id: 'c2', block_type: 32, children: ['t2'] },
    { block_id: 'c3', block_type: 32, children: ['t3'] },
    { block_id: 'c4', block_type: 32, children: ['t4'] },
    { block_id: 'c5', block_type: 32, children: ['t5'] },
    { block_id: 'c6', block_type: 32, children: ['t6'] },
    // Text blocks inside cells
    { block_id: 't1', block_type: 2, text: { elements: [{ text_run: { content: 'Merged 2x2' } }] } },
    { block_id: 't2', block_type: 2, text: { elements: [{ text_run: { content: 'Col 3 Row 1' } }] } },
    { block_id: 't3', block_type: 2, text: { elements: [{ text_run: { content: 'Col 3 Row 2' } }] } },
    { block_id: 't4', block_type: 2, text: { elements: [{ text_run: { content: 'Row 3 Col 1' } }] } },
    { block_id: 't5', block_type: 2, text: { elements: [{ text_run: { content: 'Row 3 Col 2' } }] } },
    { block_id: 't6', block_type: 2, text: { elements: [{ text_run: { content: 'Row 3 Col 3' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, 'Merged 2x2', 'Merged cell content appears in output');
  assertContains(md, 'Col 3 Row 1', 'Non-merged cell Row 1 Col 3 preserved');
  assertContains(md, 'Col 3 Row 2', 'Non-merged cell Row 2 Col 3 preserved');
  assertContains(md, 'Row 3 Col 1', 'Row 3 Col 1 preserved');
  assertContains(md, 'Row 3 Col 2', 'Row 3 Col 2 preserved');
  assertContains(md, 'Row 3 Col 3', 'Row 3 Col 3 preserved');
  assertContains(md, '| ---', 'Table has separator row');
  // Merged cell content repeated in row 2
  const lines = md.split('\n').filter(l => l.startsWith('|'));
  assert(lines.length >= 4, 'Table has at least 4 lines (header + sep + 2 body rows)');
  console.log('    Generated table:');
  lines.forEach(l => console.log('      ' + l));
}

// ============================================================
// TEST 3: Inline formatting in API blocks
// ============================================================
console.log('\n=== Test: Inline formatting (API blocks) ===');

{
  const blocks = [
    { block_id: 'b1', block_type: 1, children: ['b2', 'b3', 'b4'] },
    { block_id: 'b2', block_type: 2, text: { elements: [
      { text_run: { content: 'Bold text', text_element_style: { bold: true } } },
      { text_run: { content: ' and ' } },
      { text_run: { content: 'italic', text_element_style: { italic: true } } },
      { text_run: { content: ' and ' } },
      { text_run: { content: 'code()', text_element_style: { inline_code: true } } }
    ]}},
    { block_id: 'b3', block_type: 2, text: { elements: [
      { text_run: { content: 'Link text', text_element_style: { link: { url: 'https%3A%2F%2Fexample.com%2Fpath' } } } }
    ]}},
    { block_id: 'b4', block_type: 2, text: { elements: [
      { text_run: { content: 'bold+italic', text_element_style: { bold: true, italic: true } } }
    ]}}
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '**Bold text**', 'Bold formatting');
  assertContains(md, '*italic*', 'Italic formatting');
  assertContains(md, '`code()`', 'Inline code');
  assertContains(md, '[Link text](https://example.com/path)', 'Link with decoded URL');
  assertContains(md, '***bold+italic***', 'Bold+italic combo');
}

// ============================================================
// TEST 4: Code block with backticks in content
// ============================================================
console.log('\n=== Test: Code block with backticks ===');

{
  const blocks = [
    { block_id: 'b1', block_type: 14, code: { style: { language: 'javascript' }, elements: [
      { text_run: { content: 'const x = `template ${var}`;\nconst y = 42;' } }
    ]}}
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '```javascript', 'Code block has language');
  assertContains(md, 'const x = `template ${var}`', 'Backticks preserved inside code block');
  assertContains(md, 'const y = 42;', 'Multi-line code preserved');
}

{
  // Code block that contains triple backticks
  const blocks = [
    { block_id: 'b1', block_type: 14, code: { style: { language: 'markdown' }, elements: [
      { text_run: { content: '# Title\n```js\nconsole.log("hi")\n```' } }
    ]}}
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '````markdown', 'Uses 4 backticks when content has triple backticks');
}

// ============================================================
// TEST 5: Nested lists
// ============================================================
console.log('\n=== Test: Nested lists ===');

{
  const blocks = [
    { block_id: 'b1', block_type: 1, children: ['l1', 'l2', 'l3'] },
    { block_id: 'l1', block_type: 12, bullet: { elements: [{ text_run: { content: 'Item 1' } }] }, children: ['l1a'] },
    { block_id: 'l1a', block_type: 12, bullet: { elements: [{ text_run: { content: 'Sub-item 1a' } }] } },
    { block_id: 'l2', block_type: 12, bullet: { elements: [{ text_run: { content: 'Item 2' } }] } },
    { block_id: 'l3', block_type: 13, ordered: { elements: [{ text_run: { content: 'Ordered item' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '- Item 1', 'Top-level bullet');
  assertContains(md, '    - Sub-item 1a', 'Nested bullet indented');
  assertContains(md, '- Item 2', 'Second bullet');
  assertContains(md, '1. Ordered item', 'Ordered list item');
}

// ============================================================
// TEST 6: Table with pipe characters in content
// ============================================================
console.log('\n=== Test: Table cells with special characters ===');

{
  const blocks = [
    { block_id: 'table1', block_type: 31, table: { property: { row_size: 2, column_size: 2 }}, children: ['c1', 'c2', 'c3', 'c4'] },
    { block_id: 'c1', block_type: 32, children: ['t1'] },
    { block_id: 'c2', block_type: 32, children: ['t2'] },
    { block_id: 'c3', block_type: 32, children: ['t3'] },
    { block_id: 'c4', block_type: 32, children: ['t4'] },
    { block_id: 't1', block_type: 2, text: { elements: [{ text_run: { content: 'A | B' } }] } },
    { block_id: 't2', block_type: 2, text: { elements: [{ text_run: { content: 'Header 2' } }] } },
    { block_id: 't3', block_type: 2, text: { elements: [{ text_run: { content: 'Line1\nLine2' } }] } },
    { block_id: 't4', block_type: 2, text: { elements: [{ text_run: { content: 'Normal' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, 'A \\| B', 'Pipe in table cell is escaped');
  assert(!md.includes('| A | B |'), 'Unescaped pipe does NOT break table structure');
  assertContains(md, 'Line1 Line2', 'Newline in cell replaced with space');
}

// ============================================================
// TEST 7: Complex merged table - row span + col span mixed
// ============================================================
console.log('\n=== Test: Complex merged table ===');

{
  // 4x4 table:
  // Row 0: [A (rowspan=3, colspan=1)] [B] [C (colspan=2)]
  // Row 1: [---A continues---]        [D] [E]  [F]
  // Row 2: [---A continues---]        [G] [H]  [I]
  // Row 3: [J]                         [K] [L]  [M]
  const blocks = [
    { block_id: 'table1', block_type: 31, table: { property: { row_size: 4, column_size: 4, merge_info: [
      { row_span: 3, col_span: 1 }, // A: 3 rows, 1 col
      null,                          // B
      { row_span: 1, col_span: 2 }, // C: 1 row, 2 cols
      // Row 1: skip col 0 (occupied by A)
      null, null, null,             // D, E, F
      // Row 2: skip col 0 (occupied by A)
      null, null, null,             // G, H, I
      // Row 3:
      null, null, null, null        // J, K, L, M
    ]}}, children: ['c_a', 'c_b', 'c_c', 'c_d', 'c_e', 'c_f', 'c_g', 'c_h', 'c_i', 'c_j', 'c_k', 'c_l', 'c_m'] },
    { block_id: 'c_a', block_type: 32, children: ['t_a'] },
    { block_id: 'c_b', block_type: 32, children: ['t_b'] },
    { block_id: 'c_c', block_type: 32, children: ['t_c'] },
    { block_id: 'c_d', block_type: 32, children: ['t_d'] },
    { block_id: 'c_e', block_type: 32, children: ['t_e'] },
    { block_id: 'c_f', block_type: 32, children: ['t_f'] },
    { block_id: 'c_g', block_type: 32, children: ['t_g'] },
    { block_id: 'c_h', block_type: 32, children: ['t_h'] },
    { block_id: 'c_i', block_type: 32, children: ['t_i'] },
    { block_id: 'c_j', block_type: 32, children: ['t_j'] },
    { block_id: 'c_k', block_type: 32, children: ['t_k'] },
    { block_id: 'c_l', block_type: 32, children: ['t_l'] },
    { block_id: 'c_m', block_type: 32, children: ['t_m'] },
    { block_id: 't_a', block_type: 2, text: { elements: [{ text_run: { content: 'CellA' } }] } },
    { block_id: 't_b', block_type: 2, text: { elements: [{ text_run: { content: 'CellB' } }] } },
    { block_id: 't_c', block_type: 2, text: { elements: [{ text_run: { content: 'CellC' } }] } },
    { block_id: 't_d', block_type: 2, text: { elements: [{ text_run: { content: 'CellD' } }] } },
    { block_id: 't_e', block_type: 2, text: { elements: [{ text_run: { content: 'CellE' } }] } },
    { block_id: 't_f', block_type: 2, text: { elements: [{ text_run: { content: 'CellF' } }] } },
    { block_id: 't_g', block_type: 2, text: { elements: [{ text_run: { content: 'CellG' } }] } },
    { block_id: 't_h', block_type: 2, text: { elements: [{ text_run: { content: 'CellH' } }] } },
    { block_id: 't_i', block_type: 2, text: { elements: [{ text_run: { content: 'CellI' } }] } },
    { block_id: 't_j', block_type: 2, text: { elements: [{ text_run: { content: 'CellJ' } }] } },
    { block_id: 't_k', block_type: 2, text: { elements: [{ text_run: { content: 'CellK' } }] } },
    { block_id: 't_l', block_type: 2, text: { elements: [{ text_run: { content: 'CellL' } }] } },
    { block_id: 't_m', block_type: 2, text: { elements: [{ text_run: { content: 'CellM' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  // All cells must appear in output
  for (const cell of ['CellA', 'CellB', 'CellC', 'CellD', 'CellE', 'CellF', 'CellG', 'CellH', 'CellI', 'CellJ', 'CellK', 'CellL', 'CellM']) {
    assertContains(md, cell, `Complex table contains ${cell}`);
  }
  // CellA should appear in rows 0, 1, 2 (row-span duplication)
  const tableLines = md.split('\n').filter(l => l.startsWith('|'));
  const cellARows = tableLines.filter(l => l.includes('CellA'));
  assert(cellARows.length >= 2, 'Row-spanned CellA appears in multiple rows', `Found in ${cellARows.length} rows`);
  console.log('    Generated complex table:');
  tableLines.forEach(l => console.log('      ' + l));
}

// ============================================================
// TEST 8: Headings and dividers
// ============================================================
console.log('\n=== Test: Headings and dividers ===');

{
  const blocks = [
    { block_id: 'root', block_type: 1, children: ['h1', 'h2', 'h3', 'div', 'p1'] },
    { block_id: 'h1', block_type: 3, heading: { elements: [{ text_run: { content: 'Title Level 1' } }] } },
    { block_id: 'h2', block_type: 4, heading: { elements: [{ text_run: { content: 'Title Level 2' } }] } },
    { block_id: 'h3', block_type: 5, heading: { elements: [{ text_run: { content: 'Title Level 3' } }] } },
    { block_id: 'div', block_type: 22 },
    { block_id: 'p1', block_type: 2, text: { elements: [{ text_run: { content: 'Body text.' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '# Title Level 1', 'H1');
  assertContains(md, '## Title Level 2', 'H2');
  assertContains(md, '### Title Level 3', 'H3');
  assertContains(md, '---', 'Divider');
  assertContains(md, 'Body text.', 'Paragraph after divider');
}

// ============================================================
// TEST 9: Blockquote and callout
// ============================================================
console.log('\n=== Test: Blockquote and callout ===');

{
  const blocks = [
    { block_id: 'root', block_type: 1, children: ['q1', 'co1'] },
    { block_id: 'q1', block_type: 34, children: ['qp1', 'qp2'] },
    { block_id: 'qp1', block_type: 2, text: { elements: [{ text_run: { content: 'Quote line 1' } }] } },
    { block_id: 'qp2', block_type: 2, text: { elements: [{ text_run: { content: 'Quote line 2' } }] } },
    { block_id: 'co1', block_type: 19, children: ['cop1'] },
    { block_id: 'cop1', block_type: 2, text: { elements: [{ text_run: { content: 'Callout text' } }] } },
  ];

  const md = Feishu2MDConverter.convertFromBlocks(blocks);
  assertContains(md, '> Quote line 1', 'Blockquote line 1');
  assertContains(md, '> Quote line 2', 'Blockquote line 2');
  assertContains(md, '> Callout text', 'Callout as blockquote');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
