document.addEventListener('DOMContentLoaded', () => {
  // 检查当前页面是否可用
  checkCurrentTab();

  // 截图可见区域
  document.getElementById('captureVisible').addEventListener('click', async () => {
    await captureAndEdit('visible');
  });

  // 选择区域截图
  document.getElementById('captureArea').addEventListener('click', async () => {
    await startAreaCapture();
  });

  // 整页截图
  document.getElementById('captureFull').addEventListener('click', async () => {
    await startFullPageCapture();
  });

  // 滚动截图
  const captureScrollBtn = document.getElementById('captureScroll');
  if (captureScrollBtn) {
    captureScrollBtn.addEventListener('click', async () => {
      await startScrollCapture();
    });
  }

  // 选择区域滚动
  const captureAreaScrollBtn = document.getElementById('captureAreaScroll');
  if (captureAreaScrollBtn) {
    captureAreaScrollBtn.addEventListener('click', async () => {
      await startAreaScrollCapture();
    });
  }
});

// 检查当前标签页是否可用
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 检查是否是受限页面
    if (isRestrictedUrl(tab.url)) {
      // 禁用需要 content script 的按钮
      document.getElementById('captureArea').disabled = true;
      document.getElementById('captureArea').style.opacity = '0.5';
      document.getElementById('captureArea').style.cursor = 'not-allowed';

      document.getElementById('captureFull').disabled = true;
      document.getElementById('captureFull').style.opacity = '0.5';
      document.getElementById('captureFull').style.cursor = 'not-allowed';

      const scrollBtn = document.getElementById('captureScroll');
      if (scrollBtn) {
        scrollBtn.disabled = true;
        scrollBtn.style.opacity = '0.5';
        scrollBtn.style.cursor = 'not-allowed';
      }

      const areaScrollBtn = document.getElementById('captureAreaScroll');
      if (areaScrollBtn) {
        areaScrollBtn.disabled = true;
        areaScrollBtn.style.opacity = '0.5';
        areaScrollBtn.style.cursor = 'not-allowed';
      }

      // 显示提示
      const hint = document.querySelector('.hint');
      if (hint) {
        hint.innerHTML = '⚠️ 当前页面不支持区域/整页/滚动截图<br>仅支持「截图可见区域」';
        hint.style.color = '#cf222e';
      }
    }
  } catch (err) {
    console.error('检查标签页失败:', err);
  }
}

// 检查 URL 是否受限
function isRestrictedUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('https://chrome.google.com/webstore') ||
         url.startsWith('https://chromewebstore.google.com') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('file://');
}

async function startAreaCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (isRestrictedUrl(tab.url)) {
      alert('无法在 chrome:// 页面或 Chrome 网上应用店页面使用此功能');
      return;
    }

    // 确保 content script 已注入
    await ensureContentScriptInjected(tab.id);

    // 发送消息启动区域选择
    await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
    window.close();
  } catch (err) {
    console.error('区域截图失败:', err);
    alert('无法在当前页面启动区域截图。请刷新页面后重试，或尝试在普通网页使用。');
  }
}

async function startFullPageCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (isRestrictedUrl(tab.url)) {
      alert('无法在 chrome:// 页面或 Chrome 网上应用店页面使用此功能');
      return;
    }

    // 确保 content script 已注入
    await ensureContentScriptInjected(tab.id);

    // 发送消息启动整页截图
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'captureFullPage' });

    if (response && response.error) {
      throw new Error(response.error);
    }

    window.close();
  } catch (err) {
    console.error('整页截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

async function startScrollCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (isRestrictedUrl(tab.url)) {
      alert('无法在 chrome:// 页面或 Chrome 网上应用店页面使用此功能');
      return;
    }

    await ensureContentScriptInjected(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'startScrollCapture' });

    if (response && response.error) {
      throw new Error(response.error);
    }

    window.close();
  } catch (err) {
    console.error('自动滚动截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

async function startAreaScrollCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (isRestrictedUrl(tab.url)) {
      alert('无法在 chrome:// 页面或 Chrome 网上应用店页面使用此功能');
      return;
    }

    await ensureContentScriptInjected(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'startAreaScrollCapture' });

    if (response && response.error) {
      throw new Error(response.error);
    }

    window.close();
  } catch (err) {
    console.error('选择区域滚动截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

async function captureAndEdit(type) {
  try {
    if (type === 'visible') {
      // 截图可见区域 - 这个在 chrome 页面也支持
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      });

      // 检查图片大小
      const sizeInBytes = dataUrl.length * 0.75;
      if (sizeInBytes > 4 * 1024 * 1024) {
        await openEditorWithBlob(dataUrl);
      } else {
        await openEditor(dataUrl);
      }
    }
  } catch (err) {
    console.error('截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

async function openEditor(dataUrl) {
  // 存储截图数据
  await chrome.storage.local.set({ 'tempScreenshot': dataUrl });

  // 清理之前可能存在的草稿
  await chrome.storage.local.remove('zdfshot_draft');

  // 打开编辑器窗口（添加时间戳防止缓存）
  const editorUrl = chrome.runtime.getURL('editor.html') + '?t=' + Date.now();
  await chrome.windows.create({
    url: editorUrl,
    type: 'popup',
    width: 1200,
    height: 800,
    focused: true
  });

  window.close();
}

async function openEditorWithBlob(dataUrl) {
  // 通过 background 使用 Blob URL
  await chrome.runtime.sendMessage({
    action: 'openEditor',
    dataUrl: dataUrl
  });
  window.close();
}

// 确保 content script 已注入到页面
async function ensureContentScriptInjected(tabId) {
  try {
    // 尝试发送一个 ping 消息
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (err) {
    // 如果失败，说明 content script 未注入，手动注入
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    // 等待一小段时间确保脚本加载
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
