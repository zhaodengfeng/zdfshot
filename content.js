// 区域选择遮罩层
let selectionOverlay = null;
let isSelecting = false;
let startX, startY, endX, endY;
let selectionBox = null;

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAreaSelection') {
    startAreaSelection();
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'captureFullPage') {
    captureFullPage().then(dataUrl => {
      sendResponse({ dataUrl });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// 开始区域选择
function startAreaSelection() {
  if (selectionOverlay) return;
  
  isSelecting = false;
  
  // 创建遮罩层
  selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'zdfsnap-overlay';
  selectionOverlay.innerHTML = `
    <div class="zdfsnap-hint">拖动选择截图区域，按 ESC 取消</div>
    <div class="zdfsnap-selection"></div>
  `;
  document.body.appendChild(selectionOverlay);
  
  selectionBox = selectionOverlay.querySelector('.zdfsnap-selection');
  const hint = selectionOverlay.querySelector('.zdfsnap-hint');
  
  // 鼠标事件
  selectionOverlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
  
  function onMouseDown(e) {
    if (e.button !== 0) return;
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    selectionBox.style.display = 'block';
    hint.style.display = 'none';
    updateSelectionBox();
  }
  
  function onMouseMove(e) {
    if (!isSelecting) return;
    endX = e.clientX;
    endY = e.clientY;
    updateSelectionBox();
  }
  
  function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    endX = e.clientX;
    endY = e.clientY;
    
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    // 如果选区太小，取消选择
    if (width < 10 || height < 10) {
      cleanup();
      return;
    }
    
    // 计算选区坐标
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    
    cleanup();
    captureArea(left, top, width, height);
  }
  
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
    }
  }
  
  function updateSelectionBox() {
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
  }
  
  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
    if (selectionOverlay) {
      selectionOverlay.remove();
      selectionOverlay = null;
    }
  }
}

// 截取指定区域
async function captureArea(left, top, width, height) {
  try {
    // 先截取整个可见区域
    const dataUrl = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureTab' }, response => {
        if (response && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || '截图失败'));
        }
      });
    });
    
    // 在 Canvas 上裁剪出选区
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      // 考虑设备像素比
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        left * dpr, top * dpr, width * dpr, height * dpr,
        0, 0, width * dpr, height * dpr
      );
      
      const croppedDataUrl = canvas.toDataURL('image/png');
      
      // 打开编辑器
      await chrome.runtime.sendMessage({
        action: 'openEditor',
        dataUrl: croppedDataUrl
      });
    };
    img.src = dataUrl;
  } catch (err) {
    console.error('区域截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

// ============ 长网页滚动截图核心 ============

async function captureFullPage() {
  // 显示进度提示
  const progress = showProgress('正在准备截图...');
  
  try {
    // 保存原始状态
    const originalScrollY = window.scrollY;
    const originalStyle = document.body.style.cssText;
    
    // 获取页面尺寸
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const totalWidth = Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth
    );
    const viewportHeight = window.innerHeight;
    const viewportWidth = document.documentElement.clientWidth;
    
    // 隐藏固定定位元素（避免重复出现）
    const fixedElements = hideFixedElements();
    
    // 计算需要截图的段数
    const numSegments = Math.ceil(totalHeight / viewportHeight);
    const dpr = window.devicePixelRatio || 1;
    
    // 创建最终画布
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.min(totalWidth, viewportWidth) * dpr;
    finalCanvas.height = totalHeight * dpr;
    const finalCtx = finalCanvas.getContext('2d');
    
    progress.update(`正在截图 (0/${numSegments})...`);
    
    // 分段截图
    const segments = [];
    for (let i = 0; i < numSegments; i++) {
      // 滚动到对应位置
      const scrollY = i * viewportHeight;
      window.scrollTo(0, scrollY);
      
      // 等待渲染稳定
      await sleep(150);
      
      // 截图
      const dataUrl = await captureVisibleTab();
      segments.push({
        dataUrl,
        y: scrollY,
        isLast: i === numSegments - 1
      });
      
      progress.update(`正在截图 (${i + 1}/${numSegments})...`);
    }
    
    progress.update('正在拼接图片...');
    
    // 拼接所有截图
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const img = await loadImage(segment.dataUrl);
      
      // 计算绘制参数
      const sourceY = 0;
      let sourceHeight = viewportHeight;
      let drawY = segment.y;
      
      // 最后一段可能需要裁剪
      if (segment.isLast) {
        const remainingHeight = totalHeight - segment.y;
        sourceHeight = remainingHeight;
      }
      
      // 绘制到最终画布
      finalCtx.drawImage(
        img,
        0, sourceY * dpr, img.width, sourceHeight * dpr,
        0, drawY * dpr, finalCanvas.width, sourceHeight * dpr
      );
    }
    
    // 恢复状态
    window.scrollTo(0, originalScrollY);
    document.body.style.cssText = originalStyle;
    restoreFixedElements(fixedElements);
    
    progress.hide();
    
    return finalCanvas.toDataURL('image/png');
    
  } catch (err) {
    progress.hide();
    throw err;
  }
}

// 隐藏固定定位元素
function hideFixedElements() {
  const fixedElements = [];
  const elements = document.querySelectorAll('*');
  
  elements.forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') {
      const originalVisibility = el.style.visibility;
      el.style.visibility = 'hidden';
      fixedElements.push({ el, originalVisibility });
    }
  });
  
  return fixedElements;
}

// 恢复固定定位元素
function restoreFixedElements(elements) {
  elements.forEach(({ el, originalVisibility }) => {
    el.style.visibility = originalVisibility;
  });
}

// 截图当前可见区域
function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'captureTab' }, response => {
      if (response && response.dataUrl) {
        resolve(response.dataUrl);
      } else {
        reject(new Error(response?.error || '截图失败'));
      }
    });
  });
}

// 加载图片
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 显示进度提示
function showProgress(message) {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #161b22;
    color: #c9d1d9;
    padding: 20px 30px;
    border-radius: 12px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    z-index: 999999999;
    border: 1px solid #30363d;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  `;
  div.textContent = message;
  document.body.appendChild(div);
  
  return {
    update: (msg) => { div.textContent = msg; },
    hide: () => { div.remove(); }
  };
}
