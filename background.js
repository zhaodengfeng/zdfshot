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
    return true; // 保持消息通道开启
  }
  
  if (request.action === 'openEditor') {
    chrome.storage.local.set({ 'tempScreenshot': request.dataUrl }).then(() => {
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
    return true;
  }
});

// 快捷键监听
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'take-screenshot') {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      });
      
      await chrome.storage.local.set({ 'tempScreenshot': dataUrl });
      
      const editorUrl = chrome.runtime.getURL('editor.html');
      await chrome.windows.create({
        url: editorUrl,
        type: 'popup',
        width: 1200,
        height: 800,
        focused: true
      });
    } catch (err) {
      console.error('快捷键截图失败:', err);
    }
  }
});
