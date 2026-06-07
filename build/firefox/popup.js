(() => {
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');
  const statusEl = document.getElementById('status');
  const charCount = document.getElementById('char-count');

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = 'status ' + type;
  }

  function clearStatus() {
    statusEl.className = 'status';
    statusEl.textContent = '';
  }

  function setLoading(loading) {
    btnCopy.disabled = loading;
    btnDownload.disabled = loading;
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 100);
  }

  async function ensureContentScript(tabId) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (resp?.ready) return true;
    } catch (e) { /* not injected yet */ }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['converter.js', 'content.js']
      });
      await new Promise(r => setTimeout(r, 200));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function extract() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('无法获取当前标签页');
    }

    const url = tab.url || '';
    if (!url.match(/feishu\.cn|larksuite\.com/)) {
      throw new Error('请在飞书文档页面使用此插件');
    }

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      throw new Error('无法注入内容脚本，请刷新页面后重试');
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'extract' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('通信失败，请刷新页面后重试'));
          return;
        }
        if (!response) {
          reject(new Error('未收到响应，请刷新页面后重试'));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error || '提取失败'));
          return;
        }
        resolve(response);
      });
    });
  }

  btnCopy.addEventListener('click', async () => {
    clearStatus();
    setLoading(true);
    setStatus('正在提取文档内容...', 'info');

    try {
      const { markdown } = await extract();
      await navigator.clipboard.writeText(markdown);
      charCount.textContent = `共 ${markdown.length} 字符`;
      setStatus('已复制到剪贴板 ✓', 'success');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      setLoading(false);
    }
  });

  btnDownload.addEventListener('click', async () => {
    clearStatus();
    setLoading(true);
    setStatus('正在提取文档内容...', 'info');

    try {
      const { title, markdown } = await extract();
      const filename = sanitizeFilename(title) + '.md';
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      charCount.textContent = `共 ${markdown.length} 字符`;
      setStatus(`已下载 ${filename} ✓`, 'success');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      setLoading(false);
    }
  });
})();
