// 截图请求处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    }).then(dataUrl => {
      sendResponse({ dataUrl });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'openEditor') {
    // 如果图片太大，使用 Blob URL 而不是 storage
    const dataUrl = request.dataUrl;
    const sizeInBytes = dataUrl.length * 0.75; // base64 大约是原大小的 4/3

    if (sizeInBytes > 4 * 1024 * 1024) {
      // 超过 4MB，使用 Blob URL
      openEditorWithBlob(dataUrl).then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ error: err.message });
      });
    } else {
      // 小图片继续使用 storage
      chrome.storage.local.set({ 'tempScreenshot': dataUrl }).then(() => {
        const editorUrl = chrome.runtime.getURL('editor.html');
        return chrome.windows.create({
          url: editorUrl,
          type: 'popup',
          width: 1200,
          height: 800,
          focused: true
        });
      }).then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ error: err.message });
      });
    }
    return true;
  }

  if (request.action === 'openEditorWithUrl') {
    // 直接使用传入的 URL（Blob URL 或 dataUrl）
    const editorUrl = chrome.runtime.getURL('editor.html') + '?url=' + encodeURIComponent(request.url);
    chrome.windows.create({
      url: editorUrl,
      type: 'popup',
      width: 1200,
      height: 800,
      focused: true
    }).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// 使用 Blob URL 打开编辑器（处理大图片）
async function openEditorWithBlob(dataUrl) {
  // 将 dataUrl 转换为 Blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // 创建 Blob URL
  const blobUrl = URL.createObjectURL(blob);

  // 存储 Blob URL（编辑器会读取并使用）
  await chrome.storage.local.set({ 'tempScreenshotBlobUrl': blobUrl });

  // 打开编辑器
  const editorUrl = chrome.runtime.getURL('editor.html') + '?blob=1';
  await chrome.windows.create({
    url: editorUrl,
    type: 'popup',
    width: 1200,
    height: 800,
    focused: true
  });
}

// 快捷键监听
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'take-screenshot') {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      });

      const sizeInBytes = dataUrl.length * 0.75;

      if (sizeInBytes > 4 * 1024 * 1024) {
        await openEditorWithBlob(dataUrl);
      } else {
        await chrome.storage.local.set({ 'tempScreenshot': dataUrl });
        const editorUrl = chrome.runtime.getURL('editor.html');
        await chrome.windows.create({
          url: editorUrl,
          type: 'popup',
          width: 1200,
          height: 800,
          focused: true
        });
      }
    } catch (err) {
      console.error('快捷键截图失败:', err);
    }
  }
});
