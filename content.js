// 区域选择遮罩层
let selectionOverlay = null;
let isSelecting = false;
let startX, startY, endX, endY;
let selectionBox = null;

// 区域滚动截图状态
let areaScrollState = null;

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ pong: true });
    return true;
  }

  if (request.action === 'startAreaSelection') {
    startAreaSelection();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'captureFullPage') {
    captureFullPageAndOpenEditor().then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'startScrollCapture') {
    startAutoScrollCapture();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'startAreaScrollCapture') {
    // V5：全自动滚动 + 底部补捕
    startAreaScrollCaptureV5();
    sendResponse({ success: true });
    return true;
  }
});

// 开始区域选择
function startAreaSelection() {
  if (selectionOverlay) return;

  isSelecting = false;

  selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'zdfsnap-overlay';
  selectionOverlay.innerHTML = `
    <div class="zdfsnap-hint">拖动选择截图区域，按 ESC 取消</div>
    <div class="zdfsnap-selection"></div>
  `;
  document.body.appendChild(selectionOverlay);

  selectionBox = selectionOverlay.querySelector('.zdfsnap-selection');
  const hint = selectionOverlay.querySelector('.zdfsnap-hint');

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

  async function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    endX = e.clientX;
    endY = e.clientY;

    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    if (width < 10 || height < 10) {
      cleanup();
      return;
    }

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);

    cleanup();
    await captureArea(left, top, width, height);
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
    // 等待遮罩移除后重新渲染，避免遮罩被截入
    await sleep(120);

    const dataUrl = await captureVisibleTab();
    const img = await loadImage(dataUrl);

    // 用实际图片尺寸推算比例，比直接用 devicePixelRatio 更可靠
    // （兼容浏览器缩放、高 DPR 等各种情况）
    const scaleX = img.width / window.innerWidth;
    const scaleY = img.height / window.innerHeight;

    const cropX = Math.round(left   * scaleX);
    const cropY = Math.round(top    * scaleY);
    const cropW = Math.round(width  * scaleX);
    const cropH = Math.round(height * scaleY);

    const canvas = document.createElement('canvas');
    canvas.width  = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const croppedDataUrl = canvas.toDataURL('image/png');
    await chrome.runtime.sendMessage({ action: 'openEditor', dataUrl: croppedDataUrl });
  } catch (err) {
    console.error('区域截图失败:', err);
    alert('截图失败: ' + err.message);
  }
}

// ============ 页面滚动截图（自动） ============

async function startAutoScrollCapture() {
  const viewportHeight = window.innerHeight;
  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  // 如果页面很短，直接整页截图
  if (pageHeight <= viewportHeight * 1.5) {
    await captureFullPageAndOpenEditor();
    return;
  }

  // 创建控制面板
  const panel = document.createElement('div');
  panel.id = 'zdfshot-autoscroll-panel';
  panel.innerHTML = `
    <div class="zdfshot-autoscroll-title">页面滚动截图</div>
    <div class="zdfshot-autoscroll-status" id="zdfshot-autoscroll-status">准备中...</div>
    <div class="zdfshot-autoscroll-progress">
      <div class="zdfshot-autoscroll-bar" id="zdfshot-autoscroll-bar"></div>
    </div>
    <div class="zdfshot-autoscroll-btns">
      <button id="zdfshot-autoscroll-start">▶ 开始截图</button>
      <button id="zdfshot-autoscroll-cancel">✕ 取消</button>
    </div>
  `;
  document.body.appendChild(panel);

  // 添加样式
  const style = document.createElement('style');
  style.textContent = `
    #zdfshot-autoscroll-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fff;
      border: 2px solid #0969da;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      z-index: 999999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 250px;
    }
    .zdfshot-autoscroll-title {
      font-size: 16px;
      font-weight: 600;
      color: #1f2328;
      margin-bottom: 12px;
    }
    .zdfshot-autoscroll-status {
      font-size: 14px;
      color: #656d76;
      margin-bottom: 12px;
    }
    .zdfshot-autoscroll-progress {
      width: 100%;
      height: 6px;
      background: #e1e4e8;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .zdfshot-autoscroll-bar {
      width: 0%;
      height: 100%;
      background: #0969da;
      transition: width 0.3s;
    }
    .zdfshot-autoscroll-btns {
      display: flex;
      gap: 8px;
    }
    .zdfshot-autoscroll-btns button {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }
    #zdfshot-autoscroll-start {
      background: #0969da;
      color: white;
    }
    #zdfshot-autoscroll-start:hover {
      background: #0550ae;
    }
    #zdfshot-autoscroll-cancel {
      background: #f6f8fa;
      color: #cf222e;
      border: 1px solid #d0d7de;
    }
    #zdfshot-autoscroll-cancel:hover {
      background: #fff5f5;
    }
  `;
  document.head.appendChild(style);

  // 绑定事件
  document.getElementById('zdfshot-autoscroll-start').addEventListener('click', async () => {
    document.getElementById('zdfshot-autoscroll-start').disabled = true;
    await runPageAutoScroll(panel);
  });

  document.getElementById('zdfshot-autoscroll-cancel').addEventListener('click', () => {
    panel.remove();
    style.remove();
  });
}

async function runPageAutoScroll(panel) {
  const statusEl = document.getElementById('zdfshot-autoscroll-status');
  const barEl = document.getElementById('zdfshot-autoscroll-bar');
  
  const viewportHeight = window.innerHeight;
  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  
  const scrollStep = Math.floor(viewportHeight * 0.7);
  const maxScrollY = Math.max(0, pageHeight - viewportHeight);
  const totalScrolls = Math.ceil(maxScrollY / scrollStep) + 1;

  const screenshots = [];
  const originalScrollY = window.scrollY;

  try {
    window.scrollTo(0, 0);
    await sleep(800);

    for (let i = 0; i < totalScrolls; i++) {
      const currentScrollY = window.scrollY;
      
      statusEl.textContent = `截图中... (${i + 1}/${totalScrolls})`;
      barEl.style.width = `${((i + 1) / totalScrolls) * 100}%`;

      await sleep(600);

      const prevPanelVis = panel.style.visibility;
      panel.style.visibility = 'hidden';
      const fixedElements = hideFixedElements();

      const dataUrl = await captureWithDelay();

      restoreFixedElements(fixedElements);
      panel.style.visibility = prevPanelVis;
      
      screenshots.push({
        dataUrl: dataUrl,
        scrollY: currentScrollY
      });

      if (currentScrollY + viewportHeight >= pageHeight - 50) {
        break;
      }

      const nextScrollY = Math.min(currentScrollY + scrollStep, maxScrollY);
      if (nextScrollY <= currentScrollY) break;
      
      window.scrollTo(0, nextScrollY);
      await sleep(800);
    }

    statusEl.textContent = '拼接中...';
    const finalDataUrl = await stitchPageScreenshots(screenshots, viewportHeight);

    window.scrollTo(0, originalScrollY);
    panel.remove();

    await chrome.runtime.sendMessage({
      action: 'openEditor',
      dataUrl: finalDataUrl
    });

  } catch (err) {
    console.error('自动滚动截图失败:', err);
    alert('截图失败: ' + err.message);
    window.scrollTo(0, originalScrollY);
    panel.remove();
  }
}

// ============ 区域滚动截图（手动控制） ============

function startManualAreaScrollCapture() {
  if (selectionOverlay) return;

  isSelecting = false;

  selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'zdfsnap-overlay';
  selectionOverlay.innerHTML = `
    <div class="zdfsnap-hint">拖动选择滚动截图区域，按 ESC 取消</div>
    <div class="zdfsnap-selection"></div>
  `;
  document.body.appendChild(selectionOverlay);

  selectionBox = selectionOverlay.querySelector('.zdfsnap-selection');
  const hint = selectionOverlay.querySelector('.zdfsnap-hint');

  selectionOverlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    endX = e.clientX;
    endY = e.clientY;
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

  async function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    endX = e.clientX;
    endY = e.clientY;

    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    if (width < 50 || height < 100) {
      alert('选择区域太小，请重新选择');
      cleanup();
      return;
    }

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);

    cleanup();
    await runAutoAreaScrollCapture(left, top, width, height);
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

function getScrollableElementAtPoint(x, y) {
  const elems = document.elementsFromPoint(x, y) || [];
  for (const el of elems) {
    if (!el || el === document.documentElement || el === document.body) continue;
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const scrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      el.scrollHeight > el.clientHeight + 1;
    if (scrollable) {
      return { type: 'element', el };
    }
  }
  return { type: 'window' };
}

function getScrollTop(target) {
  return target.type === 'element' ? target.el.scrollTop : window.scrollY;
}

function setScrollTop(target, value) {
  if (target.type === 'element') {
    target.el.scrollTop = value;
  } else {
    window.scrollTo(0, value);
  }
}

function getMaxScrollTop(target) {
  if (target.type === 'element') {
    return Math.max(0, target.el.scrollHeight - target.el.clientHeight);
  }
  const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  return Math.max(0, pageHeight - window.innerHeight);
}

function getViewportHeightForTarget(target, areaHeight) {
  if (target.type === 'element') {
    return Math.min(areaHeight, target.el.clientHeight || areaHeight);
  }
  return areaHeight;
}

async function runAutoAreaScrollCapture(areaLeft, areaTop, areaWidth, areaHeight) {
  const panel = document.createElement('div');
  panel.id = 'zdfshot-area-panel';
  panel.innerHTML = `
    <div class="zdfshot-area-title">区域滚动截图</div>
    <div class="zdfshot-area-info" id="zdfshot-area-info">准备中...</div>
    <div class="zdfshot-area-info" id="zdfshot-area-stats">已截取 0 张 · 位置 0%</div>
    <div class="zdfshot-autoscroll-progress">
      <div class="zdfshot-autoscroll-bar" id="zdfshot-area-bar"></div>
    </div>
    <div class="zdfshot-area-btns" style="display:flex; gap:8px; flex-wrap: wrap;">
      <button id="zdfshot-area-pause" style="flex:1; min-width:110px; background:#f5a524; color:#111; border-color:#f5a524;">⏸ 暂停</button>
      <button id="zdfshot-area-finish" style="flex:1; min-width:110px; background:#1a7f37; color:#fff; border-color:#1a7f37;">✓ 完成拼接</button>
      <button id="zdfshot-area-cancel" style="flex:1; min-width:110px;">✕ 取消</button>
    </div>
  `;
  document.body.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    #zdfshot-area-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fff;
      border: 2px solid #0969da;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      z-index: 999999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 280px;
    }
    .zdfshot-area-title { font-size: 16px; font-weight: 600; color: #1f2328; margin-bottom: 10px; }
    .zdfshot-area-info { font-size: 13px; color: #656d76; margin-bottom: 10px; }
    .zdfshot-area-btns button {
      width: 100%; padding: 8px 12px; border: 1px solid #d0d7de; border-radius: 6px;
      background: #f6f8fa; color: #cf222e; cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  const infoEl = document.getElementById('zdfshot-area-info');
  const statsEl = document.getElementById('zdfshot-area-stats');
  const barEl = document.getElementById('zdfshot-area-bar');
  const cancelBtn = document.getElementById('zdfshot-area-cancel');
  const finishBtn = document.getElementById('zdfshot-area-finish');
  const pauseBtn = document.getElementById('zdfshot-area-pause');

  const highlightBox = document.createElement('div');
  highlightBox.style.cssText = `position:fixed;left:${areaLeft}px;top:${areaTop}px;width:${areaWidth}px;height:${areaHeight}px;border:2px solid #0969da;background:rgba(9,105,218,0.08);z-index:999999997;pointer-events:none;`;
  const marker = document.createElement('div');
  marker.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#f85149;top:0;';
  highlightBox.appendChild(marker);
  document.body.appendChild(highlightBox);

  let cancelled = false;
  let finishRequested = false;
  let paused = false;

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
  });
  finishBtn.addEventListener('click', () => {
    finishRequested = true;
    finishBtn.disabled = true;
    finishBtn.textContent = '处理中...';
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
  });

  const targetPointX = areaLeft + Math.floor(areaWidth / 2);
  const targetPointY = areaTop + Math.floor(areaHeight / 2);
  const scrollTarget = getScrollableElementAtPoint(targetPointX, targetPointY);
  const targetLabel = scrollTarget.type === 'element' ? '容器滚动' : '页面滚动';

  const originalScrollY = getScrollTop(scrollTarget);
  const effectiveViewportHeight = getViewportHeightForTarget(scrollTarget, areaHeight);
  const scrollStep = Math.max(60, Math.floor(effectiveViewportHeight * 0.70));
  const screenshots = [];

  const cleanup = () => {
    panel.remove();
    style.remove();
    highlightBox.remove();
  };

  const waitIfPaused = async () => {
    while (paused && !cancelled && !finishRequested) {
      const cur = getScrollTop(scrollTarget);
      const max = Math.max(1, getMaxScrollTop(scrollTarget));
      const percent = Math.min(100, Math.round((cur / max) * 100));
      infoEl.textContent = '已暂停，可滚动页面检查后继续';
      statsEl.textContent = `已截取 ${screenshots.length} 张 · 位置 ${percent}%`;
      marker.style.top = `${Math.min(areaHeight - 2, Math.round((percent / 100) * areaHeight))}px`;
      await sleep(180);
    }
  };

  try {
    infoEl.textContent = `已识别：${targetLabel}，可暂停/继续，点击完成后拼接`;
    await sleep(350);

    let lastScrollY = -1;
    let stagnantCount = 0;

    while (true) {
      if (cancelled) throw new Error('用户已取消');
      await waitIfPaused();
      if (cancelled) throw new Error('用户已取消');

      const maxScrollY = Math.max(0, getMaxScrollTop(scrollTarget));
      const currentScrollY = getScrollTop(scrollTarget);
      const percent = Math.min(100, Math.round((currentScrollY / Math.max(1, maxScrollY)) * 100));

      infoEl.textContent = finishRequested ? '正在按你的指令收尾...' : `${targetLabel}截图中...`;
      statsEl.textContent = `已截取 ${screenshots.length + 1} 张 · 位置 ${percent}%`;
      barEl.style.width = `${percent}%`;
      marker.style.top = `${Math.min(areaHeight - 2, Math.round((percent / 100) * areaHeight))}px`;

      await sleep(280);

      const prevPanelVis = panel.style.visibility;
      const prevHighlightVis = highlightBox.style.visibility;
      panel.style.visibility = 'hidden';
      highlightBox.style.visibility = 'hidden';
      const fixedElements = hideFixedElements();

      const dataUrl = await captureWithDelay();

      restoreFixedElements(fixedElements);
      panel.style.visibility = prevPanelVis;
      highlightBox.style.visibility = prevHighlightVis;

      screenshots.push({ dataUrl, scrollY: currentScrollY, areaLeft, areaTop });

      if (finishRequested) break;

      const atEnd = currentScrollY >= maxScrollY - 2;
      if (atEnd) break;

      const nextScrollY = Math.min(currentScrollY + scrollStep, maxScrollY);
      setScrollTop(scrollTarget, nextScrollY);
      await sleep(380);

      const afterScrollY = getScrollTop(scrollTarget);
      if (afterScrollY <= currentScrollY + 1) {
        stagnantCount += 1;
        const fallbackStep = Math.max(24, Math.floor(scrollStep / 2));
        setScrollTop(scrollTarget, Math.min(currentScrollY + fallbackStep, maxScrollY));
        await sleep(280);
      } else {
        stagnantCount = 0;
      }

      if (lastScrollY === currentScrollY) {
        stagnantCount += 1;
      }
      lastScrollY = currentScrollY;

      // 连续卡住且未到达底部时提示用户手动继续滚动后再点继续
      if (stagnantCount >= 4 && getScrollTop(scrollTarget) < getMaxScrollTop(scrollTarget) - 2) {
        paused = true;
        pauseBtn.textContent = '▶ 继续';
        infoEl.textContent = '页面拦截了自动滚动，请手动滚动一点后点继续';
      }
    }

    if (screenshots.length === 0) throw new Error('未捕获到截图');

    infoEl.textContent = `拼接中（${screenshots.length} 张）...`;
    const finalDataUrl = await stitchAreaScreenshots(screenshots, areaLeft, areaTop, areaWidth, areaHeight);

    setScrollTop(scrollTarget, originalScrollY);
    cleanup();
    await chrome.runtime.sendMessage({ action: 'openEditor', dataUrl: finalDataUrl });
  } catch (err) {
    setScrollTop(scrollTarget, originalScrollY);
    cleanup();
    if (err.message !== '用户已取消') {
      alert('区域滚动截图失败: ' + err.message);
    }
  }
}

// 拼接区域截图
async function stitchAreaScreenshots(screenshots, areaLeft, areaTop, areaWidth, areaHeight) {
  const images = [];
  for (const shot of screenshots) {
    const img = await loadImage(shot.dataUrl);
    images.push(img);
  }

  const dpr = window.devicePixelRatio || 1;
  const sourceX = Math.round(areaLeft * dpr);
  const sourceY = Math.round(areaTop * dpr);
  const sourceW = Math.round(areaWidth * dpr);
  const sourceH = Math.round(areaHeight * dpr);

  // 先计算最终高度，避免裁切不完整
  let totalHeight = sourceH;
  for (let i = 1; i < screenshots.length; i++) {
    const scrollDelta = Math.max(1, Math.round((screenshots[i].scrollY - screenshots[i - 1].scrollY) * dpr));
    const newPart = Math.min(sourceH, Math.max(1, scrollDelta));
    totalHeight += newPart;
  }

  const canvas = document.createElement('canvas');
  canvas.width = sourceW;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  let currentY = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    if (i === 0) {
      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, currentY, sourceW, sourceH);
      currentY += sourceH;
      continue;
    }

    const scrollDelta = Math.max(1, Math.round((screenshots[i].scrollY - screenshots[i - 1].scrollY) * dpr));
    const overlap = Math.max(0, sourceH - scrollDelta);
    const drawH = Math.max(1, sourceH - overlap);

    ctx.drawImage(
      img,
      sourceX,
      sourceY + overlap,
      sourceW,
      drawH,
      0,
      currentY,
      sourceW,
      drawH
    );
    currentY += drawH;
  }

  return canvas.toDataURL('image/png');
}

// 拼接整页截图
async function stitchPageScreenshots(screenshots, viewportHeight) {
  const images = [];
  for (const shot of screenshots) {
    const img = await loadImage(shot.dataUrl);
    images.push(img);
  }

  const dpr = window.devicePixelRatio || 1;
  const canvasWidth = images[0].width;

  const heights = [];
  let totalHeight = 0;

  for (let i = 0; i < images.length; i++) {
    if (i === 0) {
      heights.push(viewportHeight * dpr);
    } else {
      const scrollDelta = screenshots[i].scrollY - screenshots[i - 1].scrollY;
      const overlap = Math.max(0, (viewportHeight - scrollDelta) * dpr);
      const newHeight = (viewportHeight * dpr) - overlap;
      heights.push(Math.max(1, newHeight));
    }
    totalHeight += heights[i];
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  let currentY = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const height = heights[i];

    if (i === 0) {
      ctx.drawImage(img, 0, 0);
    } else {
      const scrollDelta = (screenshots[i].scrollY - screenshots[i - 1].scrollY) * dpr;
      const overlapPixels = Math.max(0, (viewportHeight * dpr) - scrollDelta);
      const skipFromSource = overlapPixels;
      const newContentHeight = (viewportHeight * dpr) - overlapPixels;

      ctx.drawImage(
        img,
        0, skipFromSource, img.width, newContentHeight,
        0, currentY, img.width, newContentHeight
      );
    }
    currentY += height;
  }

  return canvas.toDataURL('image/png');
}

// ============ 整页截图（带配额限制） ============

async function captureFullPageAndOpenEditor() {
  const progress = showProgress('正在准备截图...');

  try {
    const originalScrollY = window.scrollY;
    const originalStyle = document.body.style.cssText;

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

    const MAX_HEIGHT = 16000;
    const MAX_WIDTH = 8000;

    if (totalHeight > MAX_HEIGHT || totalWidth > MAX_WIDTH) {
      throw new Error(`页面尺寸过大(${totalWidth}×${totalHeight})，超过安全限制。请使用"选择区域滚动截图"。`);
    }

    const fixedElements = hideFixedElements();

    const overlap = 100;
    const scrollStep = Math.max(viewportHeight - overlap, viewportHeight * 0.5);
    const numSegments = Math.ceil((totalHeight - viewportHeight) / scrollStep) + 1;

    const screenshots = [];

    progress.update(`正在截图 (0/${numSegments})...`);

    window.scrollTo(0, 0);
    await sleep(600);

    for (let i = 0; i < numSegments; i++) {
      const scrollY = Math.min(i * scrollStep, totalHeight - viewportHeight);
      window.scrollTo(0, scrollY);

      await sleep(600);

      const dataUrl = await captureWithDelay();

      screenshots.push({
        dataUrl: dataUrl,
        scrollY: scrollY
      });

      progress.update(`正在截图 (${i + 1}/${numSegments})...`);

      if (scrollY + viewportHeight >= totalHeight) {
        break;
      }
    }

    progress.update('正在拼接图片...');

    let currentY = 0;
    const dpr = window.devicePixelRatio || 1;
    const finalCanvas = document.createElement('canvas');
    const finalWidth = Math.min(totalWidth, window.innerWidth, MAX_WIDTH);
    const finalHeight = Math.min(totalHeight, MAX_HEIGHT);
    finalCanvas.width = finalWidth * dpr;
    finalCanvas.height = finalHeight * dpr;
    const finalCtx = finalCanvas.getContext('2d');

    for (let i = 0; i < screenshots.length; i++) {
      const img = await loadImage(screenshots[i].dataUrl);
      const scrollY = screenshots[i].scrollY;

      if (i === 0) {
        finalCtx.drawImage(img, 0, 0);
        currentY = viewportHeight * dpr;
      } else {
        const prevScrollY = screenshots[i - 1].scrollY;
        const scrollDelta = scrollY - prevScrollY;
        const overlapPixels = Math.max(0, (viewportHeight - scrollDelta) * dpr);

        const sourceY = overlapPixels;
        const drawHeight = (viewportHeight * dpr) - overlapPixels;

        const remainingHeight = (totalHeight - prevScrollY - viewportHeight) * dpr;
        const actualDrawHeight = Math.min(drawHeight, Math.max(0, remainingHeight));

        if (actualDrawHeight > 0) {
          finalCtx.drawImage(
            img,
            0, sourceY, img.width, actualDrawHeight,
            0, currentY, img.width, actualDrawHeight
          );
          currentY += actualDrawHeight;
        }
      }
    }

    progress.update('正在打开编辑器...');

    const fullPageDataUrl = finalCanvas.toDataURL('image/png');

    const sizeInMB = fullPageDataUrl.length * 0.75 / 1024 / 1024;
    let finalDataUrl = fullPageDataUrl;

    if (sizeInMB > 5) {
      progress.update('正在压缩图片...');
      finalDataUrl = finalCanvas.toDataURL('image/jpeg', 0.8);
    }

    window.scrollTo(0, originalScrollY);
    document.body.style.cssText = originalStyle;
    restoreFixedElements(fixedElements);

    progress.hide();

    await chrome.runtime.sendMessage({
      action: 'openEditor',
      dataUrl: finalDataUrl
    });

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

function restoreFixedElements(elements) {
  elements.forEach(({ el, originalVisibility }) => {
    el.style.visibility = originalVisibility;
  });
}

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

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 截图函数（带延迟防抖）
let lastCaptureTime = 0;
async function captureWithDelay() {
  const now = Date.now();
  const timeSinceLastCapture = now - lastCaptureTime;
  if (timeSinceLastCapture < 500) {
    await sleep(500 - timeSinceLastCapture);
  }
  lastCaptureTime = Date.now();
  return captureVisibleTab();
}

// ============ 区域滚动截图 V2 (完全重写) ============

// 保存原始滚动位置
let areaScrollOriginalState = {
  scrollTarget: null,
  scrollY: 0
};

// 开始区域选择并滚动截图
function startAreaScrollCaptureV2() {
  startManualAreaScrollCaptureV2();
}

function startManualAreaScrollCaptureV2() {
  // 如果已有选择覆盖层，则不重复创建
  const existingOverlay = document.querySelector('.zdfshot-v2-overlay');
  if (existingOverlay) {
    return;
  }

  // 创建选择遮罩
  const overlay = document.createElement('div');
  overlay.className = 'zdfshot-v2-overlay';
  overlay.innerHTML = `
    <div class="zdfshot-v2-hint">拖动选择滚动截图区域，按 ESC 取消</div>
    <div class="zdfshot-v2-selection"></div>
  `;
  
  // 添加样式
  const style = document.createElement('style');
  style.textContent = `
    .zdfshot-v2-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4); z-index: 2147483647;
      cursor: crosshair; user-select: none;
    }
    .zdfshot-v2-hint {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      color: #fff; font-size: 18px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      text-shadow: 0 2px 8px rgba(0,0,0,0.5); pointer-events: none;
    }
    .zdfshot-v2-selection {
      position: absolute; border: 2px dashed #0969da; background: rgba(9,105,218,0.1);
      display: none; pointer-events: none;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const selectionBox = overlay.querySelector('.zdfshot-v2-selection');
  const hint = overlay.querySelector('.zdfshot-v2-hint');

  let isSelecting = false;
  let startX = 0, startY = 0, endX = 0, endY = 0;

  // 鼠标事件
  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    endX = e.clientX;
    endY = e.clientY;
    selectionBox.style.display = 'block';
    hint.style.display = 'none';
    updateSelection();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    endX = e.clientX;
    endY = e.clientY;
    updateSelection();
  });

  document.addEventListener('mouseup', async (e) => {
    if (!isSelecting) return;
    isSelecting = false;
    endX = e.clientX;
    endY = e.clientY;

    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    if (width < 30 || height < 30) {
      alert('选择区域太小，请重新选择');
      cleanup();
      return;
    }

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);

    cleanup();
    
    // 开始滚动截图
    await runAreaScrollCaptureV2(left, top, width, height);
  });

  // ESC 取消
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };
  document.addEventListener('keydown', escHandler);

  function updateSelection() {
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
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    style.remove();
  }
}

// 执行区域滚动截图
async function runAreaScrollCaptureV2(areaLeft, areaTop, areaWidth, areaHeight) {
  
  // 保存原始滚动位置
  areaScrollOriginalState = {
    scrollTarget: window,
    scrollY: window.scrollY
  };

  // 创建控制面板
  const panel = createScrollPanelV2();
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('.status');
  const statsEl = panel.querySelector('.stats');
  const progressBar = panel.querySelector('.progress-bar');
  const pauseBtn = panel.querySelector('.pause-btn');
  const finishBtn = panel.querySelector('.finish-btn');
  const cancelBtn = panel.querySelector('.cancel-btn');

  // 创建高亮框
  const highlightBox = document.createElement('div');
  highlightBox.style.cssText = `
    position: fixed; left: ${areaLeft}px; top: ${areaTop}px;
    width: ${areaWidth}px; height: ${areaHeight}px;
    border: 2px solid #0969da; background: rgba(9,105,218,0.08);
    z-index: 2147483646; pointer-events: none;
  `;
  const scrollMarker = document.createElement('div');
  scrollMarker.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#f85149;top:0;transition:top 0.2s;';
  highlightBox.appendChild(scrollMarker);
  document.body.appendChild(highlightBox);

  // 状态变量
  let cancelled = false;
  let finished = false;
  let paused = false;
  let screenshots = [];

  // 按钮事件
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
  });

  finishBtn.addEventListener('click', () => {
    finished = true;
    finishBtn.disabled = true;
    finishBtn.textContent = '处理中...';
  });

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
  });

  const dpr = window.devicePixelRatio || 1;
  
  // 使用固定滚动步长
  const scrollStep = Math.floor(areaHeight * 0.65);
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  try {
    // 滚动到顶部开始
    window.scrollTo(0, 0);
    await sleep(500);

    let currentScrollY = 0;
    let lastCapturedScrollY = -1;

    while (true) {
      if (cancelled) {
        break;
      }

      // 等待如果暂停
      while (paused && !cancelled && !finished) {
        statsEl.textContent = `已暂停 · 已截取 ${screenshots.length} 张`;
        await sleep(200);
      }

      if (cancelled || finished) break;

      // 更新进度
      const percent = Math.min(100, Math.round((currentScrollY / Math.max(1, maxScrollY)) * 100));
      statusEl.textContent = `滚动截图中... ${percent}%`;
      statsEl.textContent = `已截取 ${screenshots.length} 张 · 位置 ${percent}%`;
      progressBar.style.width = percent + '%';
      scrollMarker.style.top = `${Math.min(areaHeight - 2, Math.round((percent / 100) * areaHeight))}px`;

      // 隐藏UI元素后截图
      const uiWasVisible = hideUIElementsV2(panel, highlightBox);
      
      await sleep(100);
      const dataUrl = await captureWithDelay();
      
      restoreUIElementsV2(uiWasVisible);

      // 只有当滚动位置发生变化才保存
      if (currentScrollY !== lastCapturedScrollY) {
        screenshots.push({
          dataUrl: dataUrl,
          scrollY: currentScrollY,
          areaLeft: areaLeft,
          areaTop: areaTop,
          areaWidth: areaWidth,
          areaHeight: areaHeight
        });
        lastCapturedScrollY = currentScrollY;
      }

      // 检查是否到达底部
      if (currentScrollY >= maxScrollY || finished) {
        break;
      }

      // 滚动到下一个位置
      const nextScrollY = Math.min(currentScrollY + scrollStep, maxScrollY);
      window.scrollTo(0, nextScrollY);
      currentScrollY = nextScrollY;
      
      await sleep(400);
    }

    if (screenshots.length === 0) {
      throw new Error('未能捕获任何截图');
    }


    // 拼接图片
    const finalDataUrl = await stitchScreenshotsV2(screenshots);
    
    // 恢复原始滚动位置
    window.scrollTo(0, areaScrollOriginalState.scrollY);
    
    // 清理UI
    panel.remove();
    highlightBox.remove();
    const panelStyle = document.querySelector('#zdfshot-v2-panel-style');
    if (panelStyle) panelStyle.remove();

    await chrome.runtime.sendMessage({ action: 'openEditor', dataUrl: finalDataUrl });

  } catch (err) {
    console.error('[ZDFShot] 截图失败:', err);
    window.scrollTo(0, areaScrollOriginalState.scrollY);
    panel.remove();
    highlightBox.remove();
    const panelStyle = document.querySelector('#zdfshot-v2-panel-style');
    if (panelStyle) panelStyle.remove();
    
    alert('区域滚动截图失败: ' + err.message);
  }
}

// 创建滚动控制面板
function createScrollPanelV2() {
  const panel = document.createElement('div');
  panel.id = 'zdfshot-v2-panel';
  
  const style = document.createElement('style');
  style.id = 'zdfshot-v2-panel-style';
  style.textContent = `
    #zdfshot-v2-panel {
      position: fixed; top: 20px; right: 20px;
      background: #fff; border: 2px solid #0969da; border-radius: 12px;
      padding: 16px; min-width: 260px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #zdfshot-v2-panel .title { font-size: 16px; font-weight: 600; color: #1f2328; margin-bottom: 12px; }
    #zdfshot-v2-panel .status { font-size: 13px; color: #656d76; margin-bottom: 6px; }
    #zdfshot-v2-panel .stats { font-size: 12px; color: #656d76; margin-bottom: 12px; }
    #zdfshot-v2-panel .progress { width: 100%; height: 6px; background: #e1e4e8; border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
    #zdfshot-v2-panel .progress-bar { width: 0%; height: 100%; background: #0969da; transition: width 0.3s; }
    #zdfshot-v2-panel .btns { display: flex; gap: 8px; }
    #zdfshot-v2-panel button {
      flex: 1; padding: 8px 12px; border: 1px solid #d0d7de; border-radius: 6px;
      font-size: 13px; cursor: pointer; background: #f6f8fa;
    }
    #zdfshot-v2-panel .pause-btn { background: #f5a524; color: #111; border-color: #f5a524; }
    #zdfshot-v2-panel .finish-btn { background: #1a7f37; color: #fff; border-color: #1a7f37; }
  `;
  document.head.appendChild(style);

  panel.innerHTML = `
    <div class="title">区域滚动截图</div>
    <div class="status">准备中...</div>
    <div class="stats">已截取 0 张</div>
    <div class="progress"><div class="progress-bar"></div></div>
    <div class="btns">
      <button class="pause-btn">⏸ 暂停</button>
      <button class="finish-btn">✓ 完成</button>
      <button class="cancel-btn">✕ 取消</button>
    </div>
  `;

  return panel;
}

// 隐藏UI元素
function hideUIElementsV2(panel, highlightBox) {
  const state = {
    panel: panel.style.visibility,
    highlight: highlightBox.style.visibility
  };
  panel.style.visibility = 'hidden';
  highlightBox.style.visibility = 'hidden';
  
  // 隐藏固定定位元素
  const fixedElements = [];
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') {
      const original = el.style.visibility;
      el.style.visibility = 'hidden';
      fixedElements.push({ el, original });
    }
  });
  state.fixedElements = fixedElements;
  
  return state;
}

// 恢复UI元素
function restoreUIElementsV2(state) {
  if (state.panel) document.getElementById('zdfshot-v2-panel').style.visibility = state.panel;
  if (state.highlight) {
    const hb = document.querySelector('div[style*="border: 2px solid #0969da"]');
    if (hb) hb.style.visibility = state.highlight;
  }
  if (state.fixedElements) {
    state.fixedElements.forEach(item => {
      item.el.style.visibility = item.original;
    });
  }
}

// 拼接截图
async function stitchScreenshotsV2(screenshots) {
  
  if (screenshots.length === 0) {
    throw new Error('没有截图可拼接');
  }

  const dpr = window.devicePixelRatio || 1;
  
  // 加载所有图片
  const images = await Promise.all(screenshots.map(s => loadImage(s.dataUrl)));
  
  const sourceX = Math.round(screenshots[0].areaLeft * dpr);
  const sourceY = Math.round(screenshots[0].areaTop * dpr);
  const sourceW = Math.round(screenshots[0].areaWidth * dpr);
  const sourceH = Math.round(screenshots[0].areaHeight * dpr);
  

  // 计算总高度 - 简单叠加所有scroll delta
  let totalHeight = 0;
  for (let i = 0; i < screenshots.length; i++) {
    if (i === 0) {
      totalHeight += sourceH;
    } else {
      const delta = Math.abs(screenshots[i].scrollY - screenshots[i-1].scrollY);
      const effectiveDelta = Math.max(1, Math.round(delta * dpr));
      totalHeight += Math.min(sourceH, effectiveDelta);
    }
  }


  const canvas = document.createElement('canvas');
  canvas.width = sourceW;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  let currentY = 0;
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    
    if (i === 0) {
      // 第一张：完整绘制
      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, currentY, sourceW, sourceH);
      currentY += sourceH;
    } else {
      // 后续张：计算重叠
      const delta = Math.abs(screenshots[i].scrollY - screenshots[i-1].scrollY);
      const effectiveDelta = Math.max(1, Math.round(delta * dpr));
      const overlap = Math.max(0, sourceH - effectiveDelta);
      const drawHeight = Math.max(1, sourceH - overlap);
      
      // 从原图的重叠位置开始裁剪
      ctx.drawImage(
        img,
        sourceX, sourceY + overlap, sourceW, drawHeight,
        0, currentY, sourceW, drawHeight
      );
      
      currentY += drawHeight;
    }
  }

  const result = canvas.toDataURL('image/png');
  
  return result;
}

// =============================================
// 区域滚动截图 V3 - 用户自主滚动 + 实时跟踪
// =============================================

let _v3 = null; // 全局状态

function startAreaScrollCaptureV3() {
  if (_v3) { console.warn('[V3] 已在运行中'); return; }
  _v3ShowSelectionUI();
}

// ---- 第一步：绘制选区 ----
function _v3ShowSelectionUI() {
  const style = _v3InjectStyle('zdfshot-v3-sel-style', `
    #zdfshot-v3-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.35);
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
    }
    #zdfshot-v3-overlay .tip {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      color: #fff; font: 600 16px/1.5 -apple-system,sans-serif;
      text-align: center; pointer-events: none;
      text-shadow: 0 2px 8px rgba(0,0,0,.6);
    }
    #zdfshot-v3-sel {
      position: absolute;
      border: 2px dashed #0969da;
      background: rgba(9,105,218,.12);
      pointer-events: none;
      display: none;
    }
  `);

  const overlay = document.createElement('div');
  overlay.id = 'zdfshot-v3-overlay';
  overlay.innerHTML = `
    <div class="tip">拖动鼠标，选择要截取的固定区域<br><small style="opacity:.7">按 ESC 取消</small></div>
    <div id="zdfshot-v3-sel"></div>
  `;
  document.body.appendChild(overlay);

  const sel = overlay.querySelector('#zdfshot-v3-sel');
  let sx = 0, sy = 0, dragging = false;

  const onDown = e => {
    if (e.button !== 0) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    sel.style.display = 'block';
    _v3UpdateSel(sel, sx, sy, sx, sy);
  };
  const onMove = e => {
    if (!dragging) return;
    _v3UpdateSel(sel, sx, sy, e.clientX, e.clientY);
  };
  const onUp = async e => {
    if (!dragging) return;
    dragging = false;
    const rect = {
      left:   Math.round(Math.min(sx, e.clientX)),
      top:    Math.round(Math.min(sy, e.clientY)),
      width:  Math.round(Math.abs(e.clientX - sx)),
      height: Math.round(Math.abs(e.clientY - sy)),
    };
    done();
    if (rect.width < 40 || rect.height < 40) { alert('选区太小，请重新选择'); return; }
    await _v3StartCapture(rect);
  };
  const onKey = e => { if (e.key === 'Escape') done(); };

  overlay.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  document.addEventListener('keydown',   onKey);

  function done() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('keydown',   onKey);
    overlay.remove(); style.remove();
  }
}

function _v3UpdateSel(el, x1, y1, x2, y2) {
  el.style.left   = Math.min(x1,x2) + 'px';
  el.style.top    = Math.min(y1,y2) + 'px';
  el.style.width  = Math.abs(x2-x1) + 'px';
  el.style.height = Math.abs(y2-y1) + 'px';
}

// ---- 第二步：进入捕获模式 ----
async function _v3StartCapture(rect) {
  const dpr = window.devicePixelRatio || 1;

  _v3 = {
    rect,
    dpr,
    frames: [],          // { scrollY, dataUrl }
    lastScrollY: -99999,
    stepPx: Math.max(80, Math.floor(rect.height * 0.65)), // 每次滚动至少 65% 区域高度才新帧
    done: false,
    scrollListener: null,
  };

  // 高亮框：固定在选区位置
  const hlStyle = _v3InjectStyle('zdfshot-v3-hl-style', `
    #zdfshot-v3-hl {
      position: fixed;
      border: 2.5px solid #0969da;
      background: rgba(9,105,218,.04);
      z-index: 2147483645;
      pointer-events: none;
      box-sizing: border-box;
    }
    /* 进度轨道 - 右侧细条 */
    #zdfshot-v3-track {
      position: absolute; right: -10px; top: 0;
      width: 6px; height: 100%;
      background: rgba(0,0,0,.1);
      border-radius: 3px;
      overflow: hidden;
    }
    #zdfshot-v3-fill {
      width: 100%; height: 0%;
      background: #0969da;
      border-radius: 3px;
      transition: height .25s ease;
    }
    /* 当前位置指针 */
    #zdfshot-v3-ptr {
      position: absolute; right: -14px;
      width: 14px; height: 2px;
      background: #f85149;
      top: 0;
      transition: top .25s ease;
    }
  `);

  const hl = document.createElement('div');
  hl.id = 'zdfshot-v3-hl';
  hl.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  hl.innerHTML = `<div id="zdfshot-v3-track"><div id="zdfshot-v3-fill"></div></div><div id="zdfshot-v3-ptr"></div>`;
  document.body.appendChild(hl);

  // 控制面板
  const panelStyle = _v3InjectStyle('zdfshot-v3-panel-style', `
    #zdfshot-v3-panel {
      position: fixed; top: 20px; right: 20px;
      width: 240px;
      background: #fff; border: 2px solid #0969da; border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,.15);
      z-index: 2147483647;
      font: 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      color: #1f2328;
    }
    #zdfshot-v3-panel h4 { margin: 0 0 8px; font-size: 15px; color: #0969da; }
    #zdfshot-v3-panel .row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: #57606a; }
    #zdfshot-v3-panel .val { font-weight: 600; color: #1f2328; }
    #zdfshot-v3-panel .hint { font-size: 11px; color: #8c959f; margin-bottom: 12px; line-height: 1.4; }
    #zdfshot-v3-panel .prog { height: 4px; background: #e1e4e8; border-radius: 2px; margin-bottom: 12px; }
    #zdfshot-v3-panel .prog-bar { height: 100%; width: 0%; background: #0969da; border-radius: 2px; transition: width .3s; }
    #zdfshot-v3-panel .btns { display: flex; gap: 8px; }
    #zdfshot-v3-panel button {
      flex: 1; padding: 8px; border: 1px solid #d0d7de; border-radius: 6px;
      background: #f6f8fa; font-size: 12px; cursor: pointer; transition: .15s;
    }
    #zdfshot-v3-panel .btn-finish {
      background: #1a7f37; color: #fff; border-color: #1a7f37; font-weight: 600;
    }
    #zdfshot-v3-panel .btn-finish:hover { background: #116329; }
    #zdfshot-v3-panel .btn-cancel:hover { background: #fff5f5; color: #cf222e; border-color: #cf222e; }
  `);

  const panel = document.createElement('div');
  panel.id = 'zdfshot-v3-panel';
  panel.innerHTML = `
    <h4>📸 区域滚动截图</h4>
    <div class="row">帧数 <span class="val" id="v3-frames">0</span></div>
    <div class="row">滚动位置 <span class="val" id="v3-pos">0px</span></div>
    <div class="prog"><div class="prog-bar" id="v3-bar"></div></div>
    <div class="hint">滚动页面，插件自动捕帧<br>滚到底部后点「完成生成」</div>
    <div class="btns">
      <button class="btn-finish" id="v3-finish">✓ 完成生成</button>
      <button class="btn-cancel" id="v3-cancel">✕ 取消</button>
    </div>
  `;
  document.body.appendChild(panel);

  const fill    = document.getElementById('zdfshot-v3-fill');
  const ptr     = document.getElementById('zdfshot-v3-ptr');
  const framesEl = document.getElementById('v3-frames');
  const posEl   = document.getElementById('v3-pos');
  const barEl   = document.getElementById('v3-bar');

  // 更新进度 UI
  function updateUI() {
    const maxScroll = Math.max(1,
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      - window.innerHeight
    );
    const pct = Math.min(100, Math.round((window.scrollY / maxScroll) * 100));
    fill.style.height = pct + '%';
    ptr.style.top     = Math.min(rect.height - 4, Math.round((pct / 100) * rect.height)) + 'px';
    barEl.style.width = pct + '%';
    framesEl.textContent = _v3 ? _v3.frames.length : 0;
    posEl.textContent   = Math.round(window.scrollY) + 'px';
  }

  // 截一帧（隐藏所有 UI 元素）
  async function captureFrame() {
    if (!_v3 || _v3.done) return;
    // 隐藏
    panel.style.visibility = 'hidden';
    hl.style.visibility = 'hidden';
    const fixed = _v3HideFixed();
    await sleep(80);
    const dataUrl = await captureVisibleTab();
    _v3RestoreFixed(fixed);
    hl.style.visibility = '';
    panel.style.visibility = '';

    _v3.frames.push({ scrollY: window.scrollY, dataUrl });
    _v3.lastScrollY = window.scrollY;
    updateUI();
  }

  // 截第一帧
  await sleep(300);
  await captureFrame();

  // 滚动监听
  let scrollTimer = null;
  const onScroll = () => {
    if (!_v3 || _v3.done) return;
    clearTimeout(scrollTimer);
    // 滚动停顿 200ms 后检测是否需要新帧
    scrollTimer = setTimeout(async () => {
      if (!_v3 || _v3.done) return;
      const delta = Math.abs(window.scrollY - _v3.lastScrollY);
      if (delta >= _v3.stepPx) {
        await captureFrame();
      }
      updateUI();
    }, 200);
    updateUI(); // 实时刷新指针
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  _v3.scrollListener = onScroll;

  // 完成按钮
  document.getElementById('v3-finish').addEventListener('click', async () => {
    if (!_v3 || _v3.done) return;
    _v3.done = true;
    clearTimeout(scrollTimer);
    window.removeEventListener('scroll', onScroll);

    // 补捕最后一帧（如果位置变了）
    if (Math.abs(window.scrollY - _v3.lastScrollY) > 10) {
      await captureFrame();
    }

    panel.querySelector('h4').textContent = '⏳ 拼接中...';
    panel.querySelector('.btns').style.display = 'none';

    try {
      const finalUrl = await _v3Stitch(_v3.frames, rect, dpr);
      panel.remove(); hl.remove();
      panelStyle.remove(); hlStyle.remove();
      _v3 = null;
      await chrome.runtime.sendMessage({ action: 'openEditor', dataUrl: finalUrl });
    } catch (err) {
      alert('生成失败: ' + err.message);
      panel.remove(); hl.remove();
      panelStyle.remove(); hlStyle.remove();
      _v3 = null;
    }
  });

  // 取消按钮
  document.getElementById('v3-cancel').addEventListener('click', () => {
    if (_v3) {
      _v3.done = true;
      clearTimeout(scrollTimer);
      window.removeEventListener('scroll', _v3.scrollListener);
    }
    panel.remove(); hl.remove();
    panelStyle.remove(); hlStyle.remove();
    _v3 = null;
  });
}

// ---- 拼接 ----
async function _v3Stitch(frames, rect, dpr) {
  if (frames.length === 0) throw new Error('没有截图数据');

  const imgs = await Promise.all(frames.map(f => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = f.dataUrl;
  })));

  const sx = Math.round(rect.left   * dpr);
  const sy = Math.round(rect.top    * dpr);
  const sw = Math.round(rect.width  * dpr);
  const sh = Math.round(rect.height * dpr);

  // 计算总高度
  let totalH = sh;
  for (let i = 1; i < frames.length; i++) {
    const delta  = Math.abs(frames[i].scrollY - frames[i-1].scrollY);
    const deltaP = Math.round(delta * dpr);
    totalH += Math.min(sh, Math.max(1, deltaP));
  }

  const canvas = document.createElement('canvas');
  canvas.width  = sw;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  let curY = 0;
  for (let i = 0; i < imgs.length; i++) {
    if (i === 0) {
      ctx.drawImage(imgs[i], sx, sy, sw, sh, 0, curY, sw, sh);
      curY += sh;
    } else {
      const delta   = Math.abs(frames[i].scrollY - frames[i-1].scrollY);
      const deltaP  = Math.round(delta * dpr);
      const overlap = Math.max(0, sh - deltaP);
      const drawH   = Math.max(1, sh - overlap);
      ctx.drawImage(imgs[i], sx, sy + overlap, sw, drawH, 0, curY, sw, drawH);
      curY += drawH;
    }
  }

  // 超大图压缩
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length * 0.75 > 8 * 1024 * 1024) {
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  return dataUrl;
}

// ---- 工具 ----
function _v3InjectStyle(id, css) {
  const el = document.createElement('style');
  el.id = id; el.textContent = css;
  document.head.appendChild(el);
  return el;
}

function _v3HideFixed() {
  const list = [];
  document.querySelectorAll('*').forEach(el => {
    const pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      list.push({ el, vis: el.style.visibility });
      el.style.visibility = 'hidden';
    }
  });
  return list;
}

function _v3RestoreFixed(list) {
  list.forEach(({ el, vis }) => { el.style.visibility = vis; });
}

// =============================================
// 区域滚动截图 V4
// - 自动识别选区内可滚动容器 vs 页面滚动
// - 现代 UI 风格
// =============================================

let _v4 = null;

function startAreaScrollCaptureV4() {
  if (_v4) return;
  _v4_selectionPhase();
}

// ─────────────────────────────────────────
// 阶段一：区域选择
// ─────────────────────────────────────────
function _v4_selectionPhase() {
  const s = document.createElement('style');
  s.id = 'v4-sel-style';
  s.textContent = `
    #v4-overlay {
      position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;
      background:rgba(0,0,0,.5);backdrop-filter:blur(1px);
    }
    #v4-guide {
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:#fff;font:600 15px/2 -apple-system,BlinkMacSystemFont,sans-serif;
      text-align:center;pointer-events:none;
      padding:12px 24px;background:rgba(255,255,255,.1);
      border:1px solid rgba(255,255,255,.25);border-radius:12px;
      backdrop-filter:blur(8px);
    }
    #v4-box {
      position:absolute;display:none;pointer-events:none;
      border:2px solid #60a5fa;border-radius:2px;
      background:rgba(96,165,250,.08);
      box-shadow:0 0 0 1px rgba(96,165,250,.3),inset 0 0 0 1px rgba(96,165,250,.15);
    }
    /* 四角把手 */
    #v4-box::before,#v4-box::after{
      content:'';position:absolute;width:10px;height:10px;
      border-color:#60a5fa;border-style:solid;
    }
    #v4-box::before{top:-2px;left:-2px;border-width:2px 0 0 2px;}
    #v4-box::after{bottom:-2px;right:-2px;border-width:0 2px 2px 0;}
    #v4-size {
      position:absolute;bottom:-26px;left:0;
      background:rgba(0,0,0,.7);color:#fff;
      font:11px/20px monospace;padding:0 6px;border-radius:4px;
      white-space:nowrap;
    }
  `;
  document.head.appendChild(s);

  const overlay = document.createElement('div'); overlay.id = 'v4-overlay';
  overlay.innerHTML = `
    <div id="v4-guide">拖动选择截图区域<br><span style="font-weight:400;font-size:13px;opacity:.8">按 ESC 取消</span></div>
    <div id="v4-box"><div id="v4-size"></div></div>
  `;
  document.body.appendChild(overlay);

  const box = overlay.querySelector('#v4-box');
  const sizeEl = overlay.querySelector('#v4-size');
  const guide = overlay.querySelector('#v4-guide');
  let x1=0,y1=0,dragging=false;

  const onDown = e => {
    if(e.button!==0)return;
    dragging=true; x1=e.clientX; y1=e.clientY;
    box.style.display='block'; guide.style.display='none';
    _v4_refreshBox(box,sizeEl,x1,y1,x1,y1);
  };
  const onMove = e => {
    if(!dragging)return;
    _v4_refreshBox(box,sizeEl,x1,y1,e.clientX,e.clientY);
  };
  const onUp = async e => {
    if(!dragging)return; dragging=false;
    const rect={
      left:Math.round(Math.min(x1,e.clientX)),
      top:Math.round(Math.min(y1,e.clientY)),
      width:Math.round(Math.abs(e.clientX-x1)),
      height:Math.round(Math.abs(e.clientY-y1)),
    };
    cleanup();
    if(rect.width<40||rect.height<40){alert('选区太小，请重新选择');return;}
    await _v4_capturePhase(rect);
  };
  const onKey = e=>{ if(e.key==='Escape')cleanup(); };

  overlay.addEventListener('mousedown',onDown);
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
  document.addEventListener('keydown',onKey);

  function cleanup(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    document.removeEventListener('keydown',onKey);
    overlay.remove(); s.remove();
  }
}

function _v4_refreshBox(box,sizeEl,x1,y1,x2,y2){
  const l=Math.min(x1,x2),t=Math.min(y1,y2),
        w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  box.style.cssText=`display:block;left:${l}px;top:${t}px;width:${w}px;height:${h}px;`;
  sizeEl.textContent=`${w} × ${h}`;
}

// ─────────────────────────────────────────
// 阶段二：捕获模式
// ─────────────────────────────────────────
async function _v4_capturePhase(rect) {
  const dpr = window.devicePixelRatio || 1;

  // 识别滚动目标：选区中心下的可滚动容器 or 页面
  const cx = rect.left + rect.width/2;
  const cy = rect.top  + rect.height/2;
  const scrollTarget = _v4_detectScroll(cx, cy);
  const isElement = scrollTarget.type === 'element';
  const label = isElement ? '容器滚动' : '页面滚动';

  _v4 = {
    rect, dpr, frames: [],
    lastScrollY: -99999,
    stepPx: Math.max(60, Math.floor(rect.height * 0.6)),
    done: false, target: scrollTarget,
  };

  // ── 高亮框
  const hlS = document.createElement('style'); hlS.id='v4-hl-style'; hlS.textContent=`
    #v4-hl {
      position:fixed;box-sizing:border-box;pointer-events:none;
      border:2px solid #60a5fa;
      box-shadow:0 0 0 1px rgba(96,165,250,.3);
      z-index:2147483645;
      border-radius:3px;
    }
    #v4-hl-label {
      position:absolute;top:-26px;left:0;
      background:#1e40af;color:#fff;
      font:11px/20px -apple-system,sans-serif;padding:0 8px;border-radius:4px;
      white-space:nowrap;
    }
    /* 右侧进度轨道 */
    #v4-track {
      position:absolute;top:0;right:-14px;bottom:0;width:6px;
      background:rgba(0,0,0,.1);border-radius:3px;overflow:hidden;
    }
    #v4-track-fill {
      position:absolute;top:0;left:0;right:0;height:0%;
      background:linear-gradient(180deg,#60a5fa,#3b82f6);
      border-radius:3px;transition:height .3s ease;
    }
    #v4-track-ptr {
      position:absolute;left:-3px;right:-3px;height:2px;
      background:#f87171;border-radius:1px;top:0;
      transition:top .3s ease;
      box-shadow:0 0 4px rgba(248,113,113,.6);
    }
  `;
  document.head.appendChild(hlS);

  const hl = document.createElement('div'); hl.id='v4-hl';
  hl.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  hl.innerHTML=`
    <div id="v4-hl-label">📷 ${label}截图中</div>
    <div id="v4-track"><div id="v4-track-fill"></div><div id="v4-track-ptr"></div></div>
  `;
  document.body.appendChild(hl);

  // ── 控制面板（现代风）
  const panS = document.createElement('style'); panS.id='v4-panel-style'; panS.textContent=`
    #v4-panel {
      position:fixed;top:20px;right:20px;width:260px;
      background:rgba(15,23,42,.92);backdrop-filter:blur(16px);
      border:1px solid rgba(255,255,255,.12);border-radius:16px;
      padding:18px;box-shadow:0 8px 32px rgba(0,0,0,.4);
      z-index:2147483647;color:#f1f5f9;
      font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    }
    #v4-panel .v4-header {
      display:flex;align-items:center;gap:8px;margin-bottom:14px;
    }
    #v4-panel .v4-icon {
      width:30px;height:30px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);
      border-radius:8px;display:flex;align-items:center;justify-content:center;
      font-size:15px;flex-shrink:0;
    }
    #v4-panel .v4-title { font-size:14px;font-weight:600;color:#f8fafc; }
    #v4-panel .v4-sub   { font-size:11px;color:#94a3b8; }
    #v4-panel .v4-stats {
      display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;
    }
    #v4-panel .v4-stat {
      background:rgba(255,255,255,.06);border-radius:8px;padding:8px 10px;
    }
    #v4-panel .v4-stat-val { font-size:16px;font-weight:700;color:#60a5fa; }
    #v4-panel .v4-stat-key { font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px; }
    #v4-panel .v4-prog-wrap { margin-bottom:14px; }
    #v4-panel .v4-prog-label { display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:4px; }
    #v4-panel .v4-prog-bg {
      height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;
    }
    #v4-panel .v4-prog-bar {
      height:100%;width:0%;border-radius:3px;
      background:linear-gradient(90deg,#3b82f6,#8b5cf6);
      transition:width .4s ease;
    }
    #v4-panel .v4-tip {
      font-size:11px;color:#475569;line-height:1.5;margin-bottom:14px;
      padding:8px 10px;background:rgba(255,255,255,.04);border-radius:8px;
    }
    #v4-panel .v4-btns { display:flex;gap:8px; }
    #v4-panel .v4-btn {
      flex:1;padding:10px;border:none;border-radius:10px;
      font:600 12px -apple-system,sans-serif;cursor:pointer;transition:.2s;
    }
    #v4-panel .v4-btn-finish {
      background:linear-gradient(135deg,#10b981,#059669);color:#fff;
    }
    #v4-panel .v4-btn-finish:hover { opacity:.9;transform:translateY(-1px); }
    #v4-panel .v4-btn-cancel {
      background:rgba(255,255,255,.08);color:#94a3b8;
    }
    #v4-panel .v4-btn-cancel:hover { background:rgba(239,68,68,.2);color:#fca5a5; }
    #v4-panel .v4-btn:disabled { opacity:.4;cursor:not-allowed;transform:none!important; }
  `;
  document.head.appendChild(panS);

  const panel = document.createElement('div'); panel.id='v4-panel';
  panel.innerHTML=`
    <div class="v4-header">
      <div class="v4-icon">📸</div>
      <div><div class="v4-title">区域滚动截图</div><div class="v4-sub" id="v4-label">${label}</div></div>
    </div>
    <div class="v4-stats">
      <div class="v4-stat"><div class="v4-stat-val" id="v4-frames">0</div><div class="v4-stat-key">已截帧</div></div>
      <div class="v4-stat"><div class="v4-stat-val" id="v4-pos">0px</div><div class="v4-stat-key">滚动位置</div></div>
    </div>
    <div class="v4-prog-wrap">
      <div class="v4-prog-label"><span>页面进度</span><span id="v4-pct">0%</span></div>
      <div class="v4-prog-bg"><div class="v4-prog-bar" id="v4-bar"></div></div>
    </div>
    <div class="v4-tip" id="v4-tip">向下滚动页面，插件自动捕帧<br>截取完成后点「生成长图」</div>
    <div class="v4-btns">
      <button class="v4-btn v4-btn-finish" id="v4-finish">✓ 生成长图</button>
      <button class="v4-btn v4-btn-cancel" id="v4-cancel">✕ 取消</button>
    </div>
  `;
  document.body.appendChild(panel);

  const trackFill = document.getElementById('v4-track-fill');
  const trackPtr  = document.getElementById('v4-track-ptr');
  const framesEl  = document.getElementById('v4-frames');
  const posEl     = document.getElementById('v4-pos');
  const pctEl     = document.getElementById('v4-pct');
  const barEl     = document.getElementById('v4-bar');
  const tipEl     = document.getElementById('v4-tip');

  function getScrollY() {
    return isElement ? scrollTarget.el.scrollTop : window.scrollY;
  }
  function getMaxScroll() {
    if (isElement) {
      return Math.max(0, scrollTarget.el.scrollHeight - scrollTarget.el.clientHeight);
    }
    return Math.max(0,
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      - window.innerHeight);
  }

  function updateUI() {
    const cur = getScrollY();
    const max = Math.max(1, getMaxScroll());
    const pct = Math.min(100, Math.round((cur / max) * 100));
    trackFill.style.height = pct + '%';
    trackPtr.style.top = Math.min(rect.height - 4, Math.round((pct/100)*rect.height)) + 'px';
    barEl.style.width  = pct + '%';
    pctEl.textContent  = pct + '%';
    framesEl.textContent = _v4 ? _v4.frames.length : 0;
    posEl.textContent  = Math.round(cur) + 'px';
  }

  // 截一帧
  async function captureFrame() {
    if (!_v4 || _v4.done) return;
    const scrollY = getScrollY();
    // 隐藏所有 UI
    panel.style.visibility = 'hidden';
    hl.style.visibility = 'hidden';
    const saved = _v4_hideFixed();
    await sleep(80);
    let dataUrl;
    try { dataUrl = await captureVisibleTab(); }
    finally {
      _v4_restoreFixed(saved);
      hl.style.visibility = '';
      panel.style.visibility = '';
    }
    _v4.frames.push({ scrollY, dataUrl });
    _v4.lastScrollY = scrollY;
    updateUI();
    // 帧计数闪烁提示
    framesEl.animate([{color:'#60a5fa'},{color:'#10b981'},{color:'#60a5fa'}],{duration:400});
  }

  // 捕首帧
  await sleep(350);
  await captureFrame();
  tipEl.textContent = '↓ 开始向下滚动，自动捕帧';

  // 滚动监听（同时支持容器滚动和页面滚动）
  let scrollTimer = null;
  const onScroll = async () => {
    if (!_v4 || _v4.done) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(async () => {
      if (!_v4 || _v4.done) return;
      const delta = Math.abs(getScrollY() - _v4.lastScrollY);
      if (delta >= _v4.stepPx) await captureFrame();
      updateUI();
    }, 200);
    updateUI();
  };

  const scrollEl = isElement ? scrollTarget.el : window;
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  _v4.cleanup = () => {
    clearTimeout(scrollTimer);
    scrollEl.removeEventListener('scroll', onScroll);
  };

  // ── 完成生成
  document.getElementById('v4-finish').addEventListener('click', async () => {
    if (!_v4 || _v4.done) return;
    _v4.done = true;
    _v4.cleanup();

    // 补截最后一帧
    if (Math.abs(getScrollY() - _v4.lastScrollY) > 10) await captureFrame();

    panel.querySelector('.v4-title').textContent = '⏳ 拼接中...';
    panel.querySelector('.v4-btns').style.display = 'none';
    tipEl.textContent = `正在拼接 ${_v4.frames.length} 帧，请稍候...`;

    try {
      const result = await _v4_stitch(_v4.frames, rect, dpr);
      _v4_destroy(hl,hlS,panel,panS);
      await chrome.runtime.sendMessage({ action:'openEditor', dataUrl:result });
    } catch(err) {
      alert('生成失败: ' + err.message);
      _v4_destroy(hl,hlS,panel,panS);
    }
    _v4 = null;
  });

  // ── 取消
  document.getElementById('v4-cancel').addEventListener('click', () => {
    if (_v4) { _v4.done=true; _v4.cleanup(); }
    _v4_destroy(hl,hlS,panel,panS);
    _v4 = null;
  });
}

// ─────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────
function _v4_detectScroll(x, y) {
  const els = document.elementsFromPoint(x, y) || [];
  for (const el of els) {
    if (!el || el === document.documentElement || el === document.body) continue;
    const st = window.getComputedStyle(el);
    const ov = st.overflowY;
    if ((ov==='auto'||ov==='scroll'||ov==='overlay') && el.scrollHeight > el.clientHeight+1) {
      return { type:'element', el };
    }
  }
  return { type:'window' };
}

function _v4_hideFixed() {
  const list = [];
  document.querySelectorAll('*').forEach(el => {
    const p = window.getComputedStyle(el).position;
    if (p==='fixed'||p==='sticky') {
      list.push({el, v:el.style.visibility});
      el.style.visibility = 'hidden';
    }
  });
  return list;
}
function _v4_restoreFixed(list) {
  list.forEach(({el,v})=>{ el.style.visibility=v; });
}

function _v4_destroy(hl,hlS,panel,panS) {
  [hl,hlS,panel,panS].forEach(el=>{ try{el.remove();}catch(e){} });
}

async function _v4_stitch(frames, rect, dpr) {
  if (!frames.length) throw new Error('无截图数据');
  const imgs = await Promise.all(frames.map(f => new Promise((res,rej)=>{
    const img = new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=f.dataUrl;
  })));

  const sx = Math.round(rect.left   * dpr);
  const sy = Math.round(rect.top    * dpr);
  const sw = Math.round(rect.width  * dpr);
  const sh = Math.round(rect.height * dpr);

  let totalH = sh;
  for (let i=1; i<frames.length; i++) {
    const d = Math.abs(frames[i].scrollY - frames[i-1].scrollY);
    totalH += Math.min(sh, Math.max(1, Math.round(d * dpr)));
  }

  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  let curY = 0;
  for (let i=0; i<imgs.length; i++) {
    if (i===0) {
      ctx.drawImage(imgs[i], sx, sy, sw, sh, 0, curY, sw, sh);
      curY += sh;
    } else {
      const d       = Math.abs(frames[i].scrollY - frames[i-1].scrollY);
      const deltaP  = Math.round(d * dpr);
      const overlap = Math.max(0, sh - deltaP);
      const drawH   = Math.max(1, sh - overlap);
      ctx.drawImage(imgs[i], sx, sy+overlap, sw, drawH, 0, curY, sw, drawH);
      curY += drawH;
    }
  }

  const raw = canvas.toDataURL('image/png');
  return (raw.length * 0.75 > 8*1024*1024)
    ? canvas.toDataURL('image/jpeg', 0.9)
    : raw;
}

// ================================================
// 区域滚动截图 V4F - 修复底部补捕 + 现代 UI
// ================================================

let _v4f = null;

function startAreaScrollCaptureV4F() {
  if (_v4f) return;
  _v4f_select();
}

// ── 阶段一：选区 ──────────────────────────────
function _v4f_select() {
  const style = _v4f_addStyle('_v4f_sel_style', `
    #_v4f_ov {
      position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;
      background:rgba(0,0,0,.45);backdrop-filter:blur(2px);
    }
    #_v4f_guide {
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:#fff;font:600 15px/2.2 -apple-system,BlinkMacSystemFont,sans-serif;
      text-align:center;padding:14px 28px;
      background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
      border-radius:14px;backdrop-filter:blur(10px);pointer-events:none;
    }
    #_v4f_box {
      position:absolute;display:none;pointer-events:none;
      border:2px solid #38bdf8;border-radius:3px;
      background:rgba(56,189,248,.1);
      box-shadow:0 0 0 1px rgba(56,189,248,.25);
    }
    #_v4f_dim { font:11px/20px monospace;color:#fff;
      position:absolute;bottom:-24px;left:0;background:rgba(0,0,0,.65);
      padding:0 6px;border-radius:4px;white-space:nowrap; }
  `);
  const ov = document.createElement('div'); ov.id='_v4f_ov';
  ov.innerHTML=`<div id="_v4f_guide">拖动选择要截取的区域<br>
    <span style="font-weight:400;font-size:12px;opacity:.75">按 ESC 取消</span></div>
    <div id="_v4f_box"><div id="_v4f_dim"></div></div>`;
  document.body.appendChild(ov);
  const box=ov.querySelector('#_v4f_box'), dim=ov.querySelector('#_v4f_dim'),
        guide=ov.querySelector('#_v4f_guide');
  let x1=0,y1=0,drag=false;
  const onDown=e=>{
    if(e.button!==0)return; drag=true; x1=e.clientX; y1=e.clientY;
    box.style.display='block'; guide.style.display='none';
    _v4f_setBox(box,dim,x1,y1,x1,y1);
  };
  const onMove=e=>{ if(!drag)return; _v4f_setBox(box,dim,x1,y1,e.clientX,e.clientY); };
  const onUp=async e=>{
    if(!drag)return; drag=false;
    const r={left:Math.round(Math.min(x1,e.clientX)),top:Math.round(Math.min(y1,e.clientY)),
      width:Math.round(Math.abs(e.clientX-x1)),height:Math.round(Math.abs(e.clientY-y1))};
    done();
    if(r.width<40||r.height<40){alert('选区太小，请重新选择');return;}
    await _v4f_capture(r);
  };
  const onKey=e=>{if(e.key==='Escape')done();};
  ov.addEventListener('mousedown',onDown);
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
  document.addEventListener('keydown',onKey);
  function done(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    document.removeEventListener('keydown',onKey);
    ov.remove(); style.remove();
  }
}
function _v4f_setBox(box,dim,x1,y1,x2,y2){
  const l=Math.min(x1,x2),t=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  box.style.cssText=`display:block;left:${l}px;top:${t}px;width:${w}px;height:${h}px;`;
  dim.textContent=`${w} × ${h}`;
}

// ── 阶段二：捕获 ──────────────────────────────
async function _v4f_capture(rect) {
  const dpr=window.devicePixelRatio||1;
  const vh=window.innerHeight;

  // 识别滚动目标
  const st=_v4f_detectScroll(rect.left+rect.width/2, rect.top+rect.height/2);
  const isEl=st.type==='element';
  // stepPx: 每滚动 35% 选区高度自动截一帧，防止漏帧
  const stepPx=Math.max(30,Math.floor(rect.height*0.35));

  _v4f={ rect,dpr,vh,frames:[],lastScrollY:-99999,stepPx,done:false,target:st,cleanup:null };

  const getScrollY=()=>isEl?st.el.scrollTop:window.scrollY;
  const getMaxScroll=()=>isEl
    ?Math.max(0,st.el.scrollHeight-st.el.clientHeight)
    :Math.max(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-vh);

  // 高亮框
  const hlStyle=_v4f_addStyle('_v4f_hl_style',`
    #_v4f_hl {
      position:fixed;pointer-events:none;box-sizing:border-box;
      border:2px solid #38bdf8;border-radius:3px;
      box-shadow:0 0 0 1px rgba(56,189,248,.2), inset 0 0 0 1px rgba(56,189,248,.1);
      z-index:2147483645;
    }
    #_v4f_hl_lbl {
      position:absolute;top:-28px;left:0;
      background:linear-gradient(135deg,#0ea5e9,#6366f1);
      color:#fff;font:600 11px/22px -apple-system,sans-serif;
      padding:0 10px;border-radius:6px;white-space:nowrap;
    }
    #_v4f_track {
      position:absolute;top:0;right:-12px;bottom:0;width:4px;
      background:rgba(255,255,255,.1);border-radius:2px;overflow:visible;
    }
    #_v4f_track_fill {
      position:absolute;top:0;left:0;right:0;height:0%;
      background:linear-gradient(180deg,#38bdf8,#6366f1);
      border-radius:2px;transition:height .3s ease;
    }
    #_v4f_ptr {
      position:absolute;left:-4px;right:-4px;height:2px;top:0;
      background:#f87171;border-radius:1px;
      box-shadow:0 0 6px rgba(248,113,113,.7);
      transition:top .3s ease;
    }
    /* 底部补捕扩展指示器 */
    #_v4f_ext_zone {
      position:absolute;left:0;right:0;
      border:2px dashed rgba(251,191,36,.6);
      border-top:none;border-radius:0 0 3px 3px;
      background:rgba(251,191,36,.06);
      display:none;top:100%;
    }
    #_v4f_ext_lbl {
      position:absolute;bottom:-22px;left:0;
      font:11px/18px -apple-system,sans-serif;color:rgba(251,191,36,.9);
      white-space:nowrap;
    }
  `);

  const hl=document.createElement('div'); hl.id='_v4f_hl';
  hl.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;

  // 计算选区下方距视口底部的剩余空间（底部补捕区）
  const extraBelow=Math.max(0, vh-(rect.top+rect.height));
  const extHtml=extraBelow>10
    ?`<div id="_v4f_ext_zone" style="height:${extraBelow}px;"><div id="_v4f_ext_lbl">↓ 底部补捕区 ${extraBelow}px</div></div>`:'';

  hl.innerHTML=`
    <div id="_v4f_hl_lbl">📷 ${isEl?'容器':'页面'}滚动截图</div>
    <div id="_v4f_track"><div id="_v4f_track_fill"></div><div id="_v4f_ptr"></div></div>
    ${extHtml}
  `;
  document.body.appendChild(hl);

  // 控制面板
  const panStyle=_v4f_addStyle('_v4f_pan_style',`
    #_v4f_pan {
      position:fixed;top:20px;right:20px;width:256px;
      background:rgba(10,15,30,.92);backdrop-filter:blur(20px) saturate(180%);
      border:1px solid rgba(255,255,255,.1);border-radius:18px;
      padding:18px 18px 16px;
      box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);
      z-index:2147483647;color:#e2e8f0;
      font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    }
    #_v4f_pan .ph {display:flex;align-items:center;gap:10px;margin-bottom:16px;}
    #_v4f_pan .pi {
      width:34px;height:34px;flex-shrink:0;border-radius:10px;
      background:linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%);
      display:flex;align-items:center;justify-content:center;font-size:16px;
    }
    #_v4f_pan .pt { font-size:14px;font-weight:700;color:#f8fafc;letter-spacing:-.2px; }
    #_v4f_pan .ps { font-size:11px;color:#64748b;margin-top:1px; }
    #_v4f_pan .pg { display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px; }
    #_v4f_pan .pc {
      background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);
      border-radius:10px;padding:10px 12px;
    }
    #_v4f_pan .pcv { font-size:18px;font-weight:700;color:#38bdf8;letter-spacing:-.5px; }
    #_v4f_pan .pck { font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.6px;margin-top:2px; }
    #_v4f_pan .ppw { margin-bottom:14px; }
    #_v4f_pan .ppl { display:flex;justify-content:space-between;
      font-size:11px;color:#475569;margin-bottom:5px; }
    #_v4f_pan .ppb { height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden; }
    #_v4f_pan .ppf {
      height:100%;width:0%;border-radius:2px;
      background:linear-gradient(90deg,#0ea5e9,#6366f1);transition:width .4s ease;
    }
    #_v4f_pan .tip {
      font-size:11px;color:#475569;line-height:1.55;margin-bottom:14px;
      padding:9px 11px;background:rgba(255,255,255,.04);
      border-radius:8px;border:1px solid rgba(255,255,255,.06);
    }
    #_v4f_pan .btns {display:flex;gap:8px;}
    #_v4f_pan button {
      flex:1;padding:11px;border:none;border-radius:11px;
      font:600 12px -apple-system,sans-serif;cursor:pointer;transition:.18s;
      letter-spacing:.1px;
    }
    #_v4f_pan .bf {
      background:linear-gradient(135deg,#059669,#10b981);color:#fff;
      box-shadow:0 4px 12px rgba(16,185,129,.35);
    }
    #_v4f_pan .bf:hover{opacity:.9;transform:translateY(-1px);}
    #_v4f_pan .bc {background:rgba(255,255,255,.07);color:#94a3b8;}
    #_v4f_pan .bc:hover{background:rgba(239,68,68,.15);color:#fca5a5;}
    #_v4f_pan button:disabled{opacity:.35;cursor:not-allowed;transform:none!important;}
  `);

  const pan=document.createElement('div'); pan.id='_v4f_pan';
  pan.innerHTML=`
    <div class="ph">
      <div class="pi">📸</div>
      <div><div class="pt">区域滚动截图</div><div class="ps" id="_v4f_mode">${isEl?'容器滚动':'页面滚动'}</div></div>
    </div>
    <div class="pg">
      <div class="pc"><div class="pcv" id="_v4f_fcnt">0</div><div class="pck">已截帧</div></div>
      <div class="pc"><div class="pcv" id="_v4f_pos">—</div><div class="pck">滚动位置</div></div>
    </div>
    <div class="ppw">
      <div class="ppl"><span>页面进度</span><span id="_v4f_pct">0%</span></div>
      <div class="ppb"><div class="ppf" id="_v4f_bar"></div></div>
    </div>
    <div class="tip" id="_v4f_tip">向下滚动，插件自动追踪截帧<br>到底后点「生成长图」，补捕底部内容</div>
    <div class="btns">
      <button class="bf" id="_v4f_fin">✓ 生成长图</button>
      <button class="bc" id="_v4f_can">✕ 取消</button>
    </div>
  `;
  document.body.appendChild(pan);

  const tf=document.getElementById('_v4f_track_fill'),
        ptr=document.getElementById('_v4f_ptr'),
        fcntEl=document.getElementById('_v4f_fcnt'),
        posEl=document.getElementById('_v4f_pos'),
        pctEl=document.getElementById('_v4f_pct'),
        barEl=document.getElementById('_v4f_bar'),
        tipEl=document.getElementById('_v4f_tip'),
        extZone=document.getElementById('_v4f_ext_zone');

  function updateUI(){
    const cur=getScrollY(), max=Math.max(1,getMaxScroll());
    const pct=Math.min(100,Math.round((cur/max)*100));
    tf.style.height=pct+'%';
    ptr.style.top=Math.min(rect.height-3,Math.round((pct/100)*rect.height))+'px';
    barEl.style.width=pct+'%'; pctEl.textContent=pct+'%';
    fcntEl.textContent=_v4f?_v4f.frames.length:0;
    posEl.textContent=Math.round(cur)+'px';
  }

  // 构造帧（记录 sx/sy/sw/sh 用于精确拼接）
  function makeFrame(virtualScrollY, dataUrl, cropOffsetPx=0){
    const sy_css=rect.top+cropOffsetPx;
    const sh_css=Math.max(1, Math.min(rect.height, vh-sy_css));
    return {
      scrollY: virtualScrollY,
      dataUrl,
      sx: Math.round(rect.left*dpr),
      sy: Math.round(sy_css*dpr),
      sw: Math.round(rect.width*dpr),
      sh: Math.round(sh_css*dpr),
    };
  }

  // 截一帧（隐藏所有固定 UI）
  async function snap(virtualScrollY, cropOffsetPx=0){
    if(!_v4f||_v4f.done) return;
    pan.style.visibility='hidden'; hl.style.visibility='hidden';
    const saved=_v4f_fixedHide();
    await sleep(80);
    let dataUrl;
    try{ dataUrl=await captureVisibleTab(); }
    finally{ _v4f_fixedRestore(saved); pan.style.visibility=''; hl.style.visibility=''; }
    const f=makeFrame(virtualScrollY,dataUrl,cropOffsetPx);
    _v4f.frames.push(f);
    updateUI();
    // 帧数字弹跳提示
    fcntEl.animate&&fcntEl.animate([{transform:'scale(1.3)',color:'#10b981'},{transform:'scale(1)',color:'#38bdf8'}],{duration:300});
    return f;
  }

  // ── 回到顶部 → 捕第一帧
  tipEl.innerHTML='⏳ 正在回到顶部...';
  if(isEl){ st.el.scrollTop=0; } else { window.scrollTo({top:0,behavior:'instant'}); }
  await sleep(600);  // 等页面稳定

  await snap(getScrollY());
  _v4f.lastScrollY=getScrollY();
  tipEl.innerHTML='↓ 从顶部向下滚动，插件自动截帧<br>到底后点「生成长图」';

  // 滚动监听（节流 + 并发保护，防止快速滚动漏帧）
  let isSnapping=false;
  let snapTimer=null;
  const scrollEl=isEl?st.el:window;

  const onScroll=()=>{
    if(!_v4f||_v4f.done)return;
    updateUI();
    // 立即检测：只要偏移超过 stepPx 就排队截帧
    clearTimeout(snapTimer);
    snapTimer=setTimeout(async()=>{
      if(!_v4f||_v4f.done||isSnapping)return;
      const cur=getScrollY();
      if(Math.abs(cur-_v4f.lastScrollY)>=_v4f.stepPx){
        isSnapping=true;
        await snap(cur);
        _v4f.lastScrollY=cur;
        isSnapping=false;
        // 如果滚动继续，再次检测
        if(!_v4f.done&&Math.abs(getScrollY()-_v4f.lastScrollY)>=_v4f.stepPx){
          onScroll();
        }
      }
    },150);
  };
  scrollEl.addEventListener('scroll',onScroll,{passive:true});
  _v4f.cleanup=()=>{ clearTimeout(snapTimer); scrollEl.removeEventListener('scroll',onScroll); };

  // 底部补捕：当选框下方视口还有空间时，下移裁剪窗口补捕内容
  async function captureExtension(){
    if(extraBelow<10) return;
    // 显示补捕进度
    if(extZone) extZone.style.display='block';
    const modeEl=document.getElementById('_v4f_mode');
    if(modeEl) modeEl.textContent='正在补捕底部...';
    tipEl.innerHTML='🔍 补捕选框下方内容...';

    const lastVirtScroll=_v4f.frames[_v4f.frames.length-1].scrollY;
    let shift=stepPx;
    while(shift<=extraBelow){
      const actual=Math.min(shift,extraBelow);
      await snap(lastVirtScroll+actual, actual);
      if(actual>=extraBelow) break;
      shift+=stepPx;
    }
    if(extZone) extZone.style.display='none';
  }

  // ── 生成按钮
  document.getElementById('_v4f_fin').addEventListener('click',async()=>{
    if(!_v4f||_v4f.done) return;
    _v4f.done=true; _v4f.cleanup();
    document.getElementById('_v4f_fin').disabled=true;
    document.getElementById('_v4f_can').disabled=true;

    // 补上最后滚动位置（若有变动）
    if(Math.abs(getScrollY()-_v4f.lastScrollY)>10){
      await snap(getScrollY()); _v4f.lastScrollY=getScrollY();
    }

    // 底部补捕
    await captureExtension();

    pan.querySelector('.pt').textContent='⏳ 拼接中...';
    tipEl.textContent=`正在拼接 ${_v4f.frames.length} 帧...`;

    try{
      const result=await _v4f_stitch(_v4f.frames);
      _v4f_destroy(hl,hlStyle,pan,panStyle);
      _v4f=null;
      await chrome.runtime.sendMessage({action:'openEditor',dataUrl:result});
    }catch(err){
      alert('生成失败: '+err.message);
      _v4f_destroy(hl,hlStyle,pan,panStyle); _v4f=null;
    }
  });

  // ── 取消
  document.getElementById('_v4f_can').addEventListener('click',()=>{
    if(_v4f){_v4f.done=true;_v4f.cleanup();}
    _v4f_destroy(hl,hlStyle,pan,panStyle); _v4f=null;
  });
}

// ── 拼接（使用帧自带 sx/sy/sw/sh）────────────
async function _v4f_stitch(frames){
  if(!frames.length) throw new Error('无截图');
  const imgs=await Promise.all(frames.map(f=>new Promise((res,rej)=>{
    const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=f.dataUrl;
  })));

  // 计算总高度
  let totalH=0;
  for(let i=0;i<frames.length;i++){
    if(i===0){ totalH+=frames[i].sh; }
    else{
      const d=Math.abs(frames[i].scrollY-frames[i-1].scrollY);
      const dP=Math.round(d*(window.devicePixelRatio||1));
      const prevSh=frames[i-1].sh;
      totalH+=Math.max(1,Math.min(frames[i].sh, dP));
    }
  }

  const canvas=document.createElement('canvas');
  canvas.width=frames[0].sw; canvas.height=totalH;
  const ctx=canvas.getContext('2d');

  let curY=0;
  for(let i=0;i<imgs.length;i++){
    const f=frames[i];
    if(i===0){
      ctx.drawImage(imgs[i],f.sx,f.sy,f.sw,f.sh,0,curY,f.sw,f.sh);
      curY+=f.sh;
    }else{
      const d=Math.abs(frames[i].scrollY-frames[i-1].scrollY);
      const dP=Math.round(d*(window.devicePixelRatio||1));
      const prevSh=frames[i-1].sh;
      const overlap=Math.max(0,prevSh-dP);
      const drawH=Math.max(1,f.sh-overlap);
      ctx.drawImage(imgs[i],f.sx,f.sy+overlap,f.sw,drawH,0,curY,f.sw,drawH);
      curY+=drawH;
    }
  }
  const raw=canvas.toDataURL('image/png');
  return raw.length*0.75>8*1024*1024?canvas.toDataURL('image/jpeg',.9):raw;
}

// ── 工具 ─────────────────────────────────────
function _v4f_addStyle(id,css){
  const el=document.createElement('style');el.id=id;el.textContent=css;
  document.head.appendChild(el);return el;
}
function _v4f_detectScroll(x,y){
  for(const el of(document.elementsFromPoint(x,y)||[])){
    if(!el||el===document.documentElement||el===document.body)continue;
    const s=window.getComputedStyle(el).overflowY;
    if((s==='auto'||s==='scroll'||s==='overlay')&&el.scrollHeight>el.clientHeight+1)
      return{type:'element',el};
  }
  return{type:'window'};
}
function _v4f_fixedHide(){
  const list=[];
  document.querySelectorAll('*').forEach(el=>{
    const p=window.getComputedStyle(el).position;
    if(p==='fixed'||p==='sticky'){list.push({el,v:el.style.visibility});el.style.visibility='hidden';}
  });
  return list;
}
function _v4f_fixedRestore(list){list.forEach(({el,v})=>{el.style.visibility=v;});}
function _v4f_destroy(...els){els.forEach(e=>{try{e.remove();}catch(x){}});}

// ================================================
// 区域滚动截图 V5 - 全自动滚动 + 精确底部补捕
// ================================================

let _v5 = null;

function startAreaScrollCaptureV5() {
  if (_v5) return;
  _v5_select();
}

// ── 阶段一：选区 ─────────────────────────────
function _v5_select() {
  const s = _v5_css('_v5_sel_s', `
    #_v5_ov {
      position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;
      background:rgba(0,0,0,.38);
      animation:_v5_fadein .15s ease;
    }
    @keyframes _v5_fadein { from{opacity:0} to{opacity:1} }
    #_v5_guide {
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:#fff;font:600 15px/2.2 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;
      padding:14px 30px;background:rgba(0,0,0,.52);
      border:1px solid rgba(255,255,255,.14);border-radius:14px;pointer-events:none;
    }
    #_v5_box {
      position:absolute;display:none;pointer-events:none;
      border:1.5px solid rgba(56,189,248,.9);
      border-radius:2px;background:rgba(56,189,248,.06);
    }
    #_v5_box::before,#_v5_box::after {
      content:'';position:absolute;width:8px;height:8px;border-color:#38bdf8;border-style:solid;
    }
    #_v5_box::before{top:-2px;left:-2px;border-width:2px 0 0 2px;}
    #_v5_box::after{bottom:-2px;right:-2px;border-width:0 2px 2px 0;}
    #_v5_dim {
      font:11px/20px monospace;color:#fff;
      position:absolute;bottom:-26px;left:0;
      background:rgba(0,0,0,.65);padding:0 8px;border-radius:4px;white-space:nowrap;
    }
  `);
  const ov = document.createElement('div'); ov.id='_v5_ov';
  ov.innerHTML=`<div id="_v5_guide">拖动选择截图区域<br><span style="font-weight:400;font-size:12px;opacity:.75">按 ESC 取消</span></div>
    <div id="_v5_box"><div id="_v5_dim"></div></div>`;
  document.body.appendChild(ov);
  const box=ov.querySelector('#_v5_box'), dim=ov.querySelector('#_v5_dim'), guide=ov.querySelector('#_v5_guide');
  let x1=0,y1=0,drag=false;
  const onDown=e=>{if(e.button!==0)return;drag=true;x1=e.clientX;y1=e.clientY;
    box.style.display='block';guide.style.display='none';_v5_setBox(box,dim,x1,y1,x1,y1);};
  const onMove=e=>{if(!drag)return;_v5_setBox(box,dim,x1,y1,e.clientX,e.clientY);};
  const onUp=async e=>{if(!drag)return;drag=false;
    const r={left:Math.round(Math.min(x1,e.clientX)),top:Math.round(Math.min(y1,e.clientY)),
      width:Math.round(Math.abs(e.clientX-x1)),height:Math.round(Math.abs(e.clientY-y1))};
    done();
    if(r.width<40||r.height<40){alert('选区太小，请重新选择');return;}
    await _v5_capture(r);};
  const onKey=e=>{if(e.key==='Escape')done();};
  ov.addEventListener('mousedown',onDown);
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
  document.addEventListener('keydown',onKey);
  function done(){document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);document.removeEventListener('keydown',onKey);
    ov.remove();s.remove();}
}
function _v5_setBox(b,d,x1,y1,x2,y2){
  const l=Math.min(x1,x2),t=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  b.style.cssText=`display:block;left:${l}px;top:${t}px;width:${w}px;height:${h}px;`;
  d.textContent=`${w} × ${h}`;
}

// ── 阶段二：全自动截图 ────────────────────────
async function _v5_capture(rect) {
  const dpr=window.devicePixelRatio||1, vh=window.innerHeight;

  // 识别滚动目标
  const st=_v5_detectScroll(rect.left+rect.width/2, rect.top+rect.height/2);
  const isEl=st.type==='element';

  _v5={rect,dpr,vh,frames:[],done:false,cancelled:false};

  const getScrollY=()=>isEl?st.el.scrollTop:window.scrollY;
  const setScrollY=v=>{ if(isEl)st.el.scrollTop=v; else window.scrollTo(0,v); };
  const getMaxScroll=()=>isEl
    ?Math.max(0,st.el.scrollHeight-st.el.clientHeight)
    :Math.max(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-vh);

  // 选区下方的视口剩余空间（底部补捕宽度）
  const extraBelow=Math.max(0, vh-(rect.top+rect.height));

  // UI
  const hlS=_v5_css('_v5_hl_s',`
    @keyframes _v5_scan_move {
      0%   { top:-2px; opacity:0; }
      5%   { opacity:1; }
      88%  { opacity:.8; }
      100% { top:100%; opacity:0; }
    }
    @keyframes _v5_frame_flash {
      0%   { border-color:rgba(56,189,248,.9); background:rgba(56,189,248,.06); }
      30%  { border-color:rgba(255,255,255,.9); background:rgba(255,255,255,.18); }
      100% { border-color:rgba(56,189,248,.9); background:rgba(56,189,248,.06); }
    }
    #_v5_hl{
      position:fixed;pointer-events:none;box-sizing:border-box;overflow:hidden;
      border:2px solid rgba(56,189,248,.9);border-radius:3px;z-index:2147483645;
      background:rgba(56,189,248,.06);
    }
    #_v5_hl.flash{ animation:_v5_frame_flash .35s ease-out forwards; }
    #_v5_hl_lbl{
      position:absolute;top:-26px;left:0;
      background:linear-gradient(90deg,#0ea5e9,#6366f1);
      color:#fff;font:600 11px/22px -apple-system,sans-serif;
      padding:0 10px;border-radius:5px;white-space:nowrap;
      display:flex;align-items:center;gap:5px;
    }
    #_v5_rec{
      width:6px;height:6px;border-radius:50%;background:#fff;flex-shrink:0;
      animation:_v5_rec_blink 1s ease-in-out infinite;
    }
    @keyframes _v5_rec_blink{ 0%,100%{opacity:1} 50%{opacity:.2} }
    #_v5_rec.hidden{ display:none; }
    #_v5_scan{
      position:absolute;left:-2px;right:-2px;height:3px;top:-2px;
      background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.4) 20%,rgba(255,255,255,.9) 50%,rgba(255,255,255,.4) 80%,transparent 100%);
      filter:blur(.5px);pointer-events:none;opacity:0;
    }
    #_v5_scan.active{ animation:_v5_scan_move 1.5s cubic-bezier(.4,0,.6,1) infinite;opacity:1; }
    #_v5_trk{
      position:absolute;top:0;right:-12px;bottom:0;width:4px;
      background:rgba(0,0,0,.08);border-radius:2px;
    }
    #_v5_trk_f{
      position:absolute;top:0;left:0;right:0;height:0%;
      background:linear-gradient(180deg,#38bdf8,#6366f1);
      border-radius:2px;transition:height .3s ease;
    }
    #_v5_ptr{
      position:absolute;left:-3px;right:-3px;height:2px;top:0;
      background:#f87171;border-radius:1px;
      box-shadow:0 0 6px rgba(248,113,113,.8);
      transition:top .3s ease;
    }
    #_v5_ext{
      position:absolute;left:0;right:0;top:100%;
      border:1.5px dashed rgba(251,191,36,.6);border-top:none;
      border-radius:0 0 3px 3px;background:rgba(251,191,36,.05);
    }
  `);
  const hl=document.createElement('div'); hl.id='_v5_hl';
  hl.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  hl.innerHTML=`
    <div id="_v5_hl_lbl"><div id="_v5_rec" class="hidden"></div>${isEl?'容器':'页面'}滚动截图</div>
    <div id="_v5_scan"></div>
    <div id="_v5_trk"><div id="_v5_trk_f"></div><div id="_v5_ptr"></div></div>
    ${extraBelow>5?`<div id="_v5_ext" style="height:${extraBelow}px;"></div>`:''}
  `;
  document.body.appendChild(hl);

  const panS=_v5_css('_v5_pan_s',`
    @keyframes _v5_slidein {
      from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)}
    }
    @keyframes _v5_dot_pulse {
      0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(.75);opacity:.5}
    }
    @keyframes _v5_bar_anim {
      0%{background-position:0% 0} 100%{background-position:200% 0}
    }
    #_v5_pan {
      position:fixed;top:20px;right:20px;width:240px;
      background:#fff;
      border:1px solid rgba(0,0,0,.07);border-radius:16px;
      padding:16px 16px 14px;
      box-shadow:0 8px 30px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);
      z-index:2147483647;color:#1e293b;
      font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      animation:_v5_slidein .22s cubic-bezier(.22,1,.36,1);
    }
    #_v5_pan .ph{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
    #_v5_pan .pi{
      width:34px;height:34px;flex-shrink:0;border-radius:10px;
      background:linear-gradient(135deg,#3b82f6,#6366f1);
      display:flex;align-items:center;justify-content:center;font-size:16px;
      box-shadow:0 3px 10px rgba(99,102,241,.3);
    }
    #_v5_pan .ptitle{font-size:14px;font-weight:700;color:#0f172a;}
    #_v5_pan .psub{font-size:11px;color:#94a3b8;margin-top:1px;}
    #_v5_pan .pstat{
      display:flex;align-items:center;gap:6px;
      font-size:12px;color:#64748b;margin-bottom:12px;
    }
    #_v5_pan .pdot{
      width:7px;height:7px;border-radius:50%;flex-shrink:0;
      background:#22c55e;
      animation:_v5_dot_pulse 1.6s ease-in-out infinite;
    }
    #_v5_pan .pdot.idle{background:#cbd5e1;animation:none;}
    #_v5_pan .pdot.busy{background:#f59e0b;animation:_v5_dot_pulse 1s ease-in-out infinite;}
    #_v5_pan .ppwrap{margin-bottom:12px;display:none;}
    #_v5_pan .pplabel{
      display:flex;justify-content:space-between;
      font-size:11px;color:#94a3b8;margin-bottom:4px;
    }
    #_v5_pan .ppct{color:#6366f1;font-weight:700;}
    #_v5_pan .ppbg{height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;}
    #_v5_pan .ppf{
      height:100%;width:0%;border-radius:3px;
      background:linear-gradient(90deg,#3b82f6,#6366f1,#8b5cf6);
      background-size:200% 100%;
      transition:width .3s ease;
    }
    #_v5_pan .ppf.active{ animation:_v5_bar_anim 2s linear infinite; }
    #_v5_pan .ptip{font-size:12px;color:#64748b;line-height:1.55;margin-bottom:12px;}
    #_v5_pan .btns{display:flex;gap:8px;}
    #_v5_pan button{
      flex:1;padding:10px;border:none;border-radius:10px;
      font:600 12.5px -apple-system,sans-serif;cursor:pointer;
      transition:all .16s ease;
    }
    #_v5_pan .bstart{
      background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;
      box-shadow:0 3px 12px rgba(99,102,241,.35);
    }
    #_v5_pan .bstart:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(99,102,241,.4);}
    #_v5_pan .bstart:active{transform:translateY(0);box-shadow:none;}
    #_v5_pan .bcanc{
      background:#f8fafc;color:#94a3b8;flex:0 0 40px;
      border:1px solid #e2e8f0;
    }
    #_v5_pan .bcanc:hover{background:#fef2f2;color:#ef4444;border-color:#fecaca;}
    #_v5_pan button:disabled{opacity:.35;cursor:not-allowed;transform:none!important;box-shadow:none!important;}
  `);
  const pan=document.createElement('div'); pan.id='_v5_pan';
  pan.innerHTML=`
    <div class="ph">
      <div class="pi">📸</div>
      <div><div class="ptitle">区域滚动截图</div><div class="psub">${isEl?'容器':'页面'}滚动 · ${rect.width}×${rect.height}</div></div>
    </div>
    <div class="pstat"><div class="pdot idle" id="_v5_dot"></div><span id="_v5_tip">点击「开始」，自动滚动完成截图</span></div>
    <div class="ppwrap" id="_v5_progwrap">
      <div class="pplabel"><span>截图进度</span><span class="ppct" id="_v5_pct">0%</span></div>
      <div class="ppbg"><div class="ppf" id="_v5_bar"></div></div>
    </div>
    <div class="btns">
      <button class="bstart" id="_v5_start">▶ 开始截图</button>
      <button class="bcanc" id="_v5_canc">✕</button>
    </div>
  `;
  document.body.appendChild(pan);

  const trkF=document.getElementById('_v5_trk_f'), ptr=document.getElementById('_v5_ptr'),
        barEl=document.getElementById('_v5_bar'),
        pctEl=document.getElementById('_v5_pct'),
        progWrap=document.getElementById('_v5_progwrap'),
        dotEl=document.getElementById('_v5_dot'),
        tipEl=document.getElementById('_v5_tip'),
        extZone=document.getElementById('_v5_ext');

  function setUI(pct, stage, tip){
    trkF.style.height=pct+'%'; ptr.style.top=Math.min(rect.height-3,pct/100*rect.height)+'px';
    barEl.style.width=pct+'%';
    if(pctEl) pctEl.textContent=pct+'%';
    if(pct>0){ progWrap.style.display='block'; barEl.classList.add('active'); }
    if(tip){ tipEl.innerHTML=tip; }
    // 状态点颜色
    if(dotEl){
      dotEl.className='pdot';
      if(stage==='idle') dotEl.classList.add('idle');
      else if(stage==='busy') dotEl.classList.add('busy');
    }
  }

  // 构造帧对象（含精确裁剪坐标）
  function mkFrame(vScrollY, dataUrl, cropOffsetCss=0){
    const sy_css=rect.top+cropOffsetCss;
    const sh_css=Math.max(1,Math.min(rect.height, vh-sy_css));
    return { scrollY:vScrollY, dataUrl,
      sx:Math.round(rect.left*dpr), sy:Math.round(sy_css*dpr),
      sw:Math.round(rect.width*dpr), sh:Math.round(sh_css*dpr) };
  }

  // 截一帧（隐藏 UI 元素防止污染）
  async function snap(vScrollY, cropOffsetCss=0){
    if(!_v5||_v5.cancelled) return null;
    pan.style.visibility='hidden'; hl.style.visibility='hidden';
    const saved=_v5_hideFixed();
    await sleep(100);
    let dataUrl;
    try{ dataUrl=await captureVisibleTab(); }
    finally{
      _v5_restoreFixed(saved); pan.style.visibility=''; hl.style.visibility='';
      // 闪光反馈：边框高亮后恢复
      hl.classList.add('flash');
      setTimeout(()=>hl.classList.remove('flash'), 380);
    }
    const f=mkFrame(vScrollY,dataUrl,cropOffsetCss);
    _v5.frames.push(f);
    return f;
  }

  function destroy(){
    try{hl.remove();}catch(e){}try{hlS.remove();}catch(e){}
    try{pan.remove();}catch(e){}try{panS.remove();}catch(e){}
    _v5=null;
  }

  // 取消
  document.getElementById('_v5_canc').addEventListener('click',()=>{
    if(_v5) _v5.cancelled=true;
    destroy();
  });

  // ── 开始截图
  document.getElementById('_v5_start').addEventListener('click',async()=>{
    const startBtn=document.getElementById('_v5_start');
    if(!startBtn||startBtn.disabled)return;
    startBtn.disabled=true;

    const maxScroll=getMaxScroll();
    // 步长：选区高度的 40%，保证足够重叠
    const stepPx=Math.max(20,Math.floor(rect.height*0.40));

    // 启动扫描线动画 + REC 指示
    const scanEl=document.getElementById('_v5_scan');
    const recEl=document.getElementById('_v5_rec');
    if(scanEl) scanEl.classList.add('active');
    if(recEl) recEl.classList.remove('hidden');

    // 1. 回到顶部
    setUI(0,'busy','⏳ 正在回到顶部...');
    setScrollY(0);
    await sleep(600);

    // 2. 逐步滚动截图
    let scrollY=0, frameIdx=0;
    while(true){
      if(!_v5||_v5.cancelled) return;
      const pct=maxScroll>0?Math.min(99,Math.round((scrollY/maxScroll)*100)):50;
      setUI(pct,'busy',`📷 第 ${frameIdx+1} 帧 · 进度 ${pct}%`);

      await snap(scrollY);
      frameIdx++;

      if(scrollY>=maxScroll) break;  // 到底了
      const next=Math.min(scrollY+stepPx, maxScroll);
      setScrollY(next);
      await sleep(350); // 等渲染
      // 实际到达的位置（有些页面会有滚动限制）
      scrollY=getScrollY();
    }

    // 3. 底部补捕：把选框下方的视口区域也截入
    if(extraBelow>5 && (!_v5||!_v5.cancelled)){
      if(extZone) extZone.style.display='block';
      // 选框下方区域分段滚到底截图（cropOffset 从 stepPx 逐步到 extraBelow）
      let offset=stepPx;
      const lastVS=_v5.frames[_v5.frames.length-1].scrollY;
      while(true){
        if(!_v5||_v5.cancelled) break;
        const actual=Math.min(offset,extraBelow);
        const pct=Math.round((actual/extraBelow)*100);
        setUI(pct,'busy',`🔍 补捕底部内容...`);
        await snap(lastVS+actual, actual);
        if(actual>=extraBelow) break;
        offset+=stepPx;
      }
      if(extZone) extZone.style.display='none';
    }

    if(!_v5||_v5.cancelled) return;

    // 4. 拼接
    const frameCount=_v5.frames.length;
    // 停止扫描线
    if(scanEl) scanEl.classList.remove('active');
    if(recEl) recEl.classList.add('hidden');
    setUI(100,'busy',`⚙️ 正在拼接 ${frameCount} 帧，请稍候...`);
    try{
      const result=await _v5_stitch(_v5.frames);
      destroy();
      await chrome.runtime.sendMessage({action:'openEditor',dataUrl:result});
    }catch(err){
      destroy();
      alert('拼接失败: '+err.message);
    }
  });
}

// ── 拼接 ────────────────────────────────────
async function _v5_stitch(frames){
  if(!frames.length) throw new Error('无截图');
  const dpr=window.devicePixelRatio||1;
  const imgs=await Promise.all(frames.map(f=>new Promise((res,rej)=>{
    const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=f.dataUrl;
  })));
  // 计算总高度
  let totalH=0;
  for(let i=0;i<frames.length;i++){
    if(i===0){ totalH+=frames[i].sh; }
    else{
      const d=Math.abs(frames[i].scrollY-frames[i-1].scrollY);
      const dP=Math.round(d*dpr);
      totalH+=Math.min(frames[i].sh,Math.max(1,dP));
    }
  }
  const canvas=document.createElement('canvas');
  canvas.width=frames[0].sw; canvas.height=totalH;
  const ctx=canvas.getContext('2d');
  let curY=0;
  for(let i=0;i<imgs.length;i++){
    const f=frames[i];
    if(i===0){
      ctx.drawImage(imgs[i],f.sx,f.sy,f.sw,f.sh,0,curY,f.sw,f.sh); curY+=f.sh;
    }else{
      const d=Math.abs(frames[i].scrollY-frames[i-1].scrollY);
      const dP=Math.round(d*dpr);
      const pSh=frames[i-1].sh;
      const overlap=Math.max(0,pSh-dP);
      const drawH=Math.max(1,f.sh-overlap);
      ctx.drawImage(imgs[i],f.sx,f.sy+overlap,f.sw,drawH,0,curY,f.sw,drawH);
      curY+=drawH;
    }
  }
  const raw=canvas.toDataURL('image/png');
  return raw.length*0.75>8*1024*1024?canvas.toDataURL('image/jpeg',.9):raw;
}

// ── 工具 ────────────────────────────────────
function _v5_css(id,css){const e=document.createElement('style');e.id=id;e.textContent=css;document.head.appendChild(e);return e;}
function _v5_detectScroll(x,y){
  for(const el of(document.elementsFromPoint(x,y)||[])){
    if(!el||el===document.documentElement||el===document.body)continue;
    const s=window.getComputedStyle(el).overflowY;
    if((s==='auto'||s==='scroll'||s==='overlay')&&el.scrollHeight>el.clientHeight+1)return{type:'element',el};
  }
  return{type:'window'};
}
function _v5_hideFixed(){const l=[];document.querySelectorAll('*').forEach(el=>{
  const p=window.getComputedStyle(el).position;
  if(p==='fixed'||p==='sticky'){l.push({el,v:el.style.visibility});el.style.visibility='hidden';}});return l;}
function _v5_restoreFixed(l){l.forEach(({el,v})=>{el.style.visibility=v;});}
