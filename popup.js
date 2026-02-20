document.addEventListener('DOMContentLoaded', () => {
  // 截图可见区域
  document.getElementById('captureVisible').addEventListener('click', async () => {
    await captureAndEdit('visible');
  });

  // 选择区域截图
  document.getElementById('captureArea').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
    window.close();
  });

  // 整页截图
  document.getElementById('captureFull').addEventListener('click', async () => {
    await captureAndEdit('full');
  });
});

async function captureAndEdit(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (type === 'visible') {
      // 截图可见区域
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      });
      await openEditor(dataUrl);
    } else if (type === 'full') {
      // 整页截图 - 通过 content script 获取
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'captureFullPage' });
      if (response && response.dataUrl) {
        await openEditor(response.dataUrl);
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
  
  // 打开编辑器窗口
  const editorUrl = chrome.runtime.getURL('editor.html');
  await chrome.windows.create({
    url: editorUrl,
    type: 'popup',
    width: 1200,
    height: 800,
    focused: true
  });
  
  window.close();
}
