// ZDFShot Editor - 核心逻辑

/**
 * 给十六进制颜色加透明度后缀（两位 hex alpha）
 * @param {string} hex - 六位十六进制颜色，如 '#ff4444'
 * @param {number} alpha - 透明度 0~1，默认 0.25 → 'xx40'
 */
function withAlpha(hex, alpha = 0.25) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  // 兼容带 '#' 的颜色字符串
  return hex + a;
}

class Editor {
  constructor() {
    this.canvas = document.getElementById('editorCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.bgImage = null;

    // 画布容器
    this.canvasViewport = document.getElementById('canvasViewport');
    this.canvasTransform = document.getElementById('canvasTransform');

    // 缩放和平移状态
    this.scale = 1;
    this.minScale = 0.1;
    this.maxScale = 5;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // 状态
    this.currentTool = 'select';
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;

    // 样式
    this.color = '#ff4444';
    this.strokeWidth = 20;
    this.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif";
    this.fillMode = false;

    // 历史记录
    this.history = [];
    this.historyStep = -1;
    this.maxHistory = 50;

    // 绘制对象列表
    this.shapes = [];
    this.currentShape = null;
    this.selectedShapeIndex = -1;

    // 图层可见性
    this.layerVisibility = new Map();

    // 文字输入
    this.textInputLayer = document.getElementById('textInputLayer');
    this.textInput = document.getElementById('textInput');
    this.textDragHandle = document.getElementById('textDragHandle');
    this.pendingText = null;
    this.isTextLayerDragging = false;
    this.textLayerDragOffsetX = 0;
    this.textLayerDragOffsetY = 0;

    // 裁剪功能
    this.cropOverlay = document.getElementById('cropOverlay');
    this.cropSelection = document.querySelector('.crop-selection');
    this.cropActions = document.querySelector('.crop-actions');
    this.isCropping = false;
    this.cropStartX = 0;
    this.cropStartY = 0;

    // 拖动状态
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragShapeOriginal = null;

    this.init();
  }

  async init() {
    // 重置所有状态
    this.resetState();

    // 加载截图
    await this.loadScreenshot();

    // 绑定事件
    this.bindEvents();
    this.bindZoomControls();
    this.bindTools();
    this.bindStyleControls();
    this.bindActions();

    // 初始化图层面板
    this.initLayersPanel();

    // 初始化多语言
    initI18n();
    this.bindLanguageToggle();

    // 自动保存
    this.setupAutoSave();

    // 初始化历史
    this.saveHistory();

    // 键盘快捷键
    this.bindKeyboard();
  }

  resetState() {
    // 清空所有标注数据
    this.shapes = [];
    this.currentShape = null;
    this.selectedShapeIndex = -1;
    this.layerVisibility = new Map();

    // 重置历史
    this.history = [];
    this.historyStep = -1;

    // 重置样式
    this.color = '#ff4444';
    this.strokeWidth = 20;
    this.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif";
    this.fillMode = false;

    // 重置缩放和平移
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    this.pendingText = null;

    // 清理草稿（新截图不需要加载旧草稿）
    this.clearDraft();
  }

  async loadScreenshot() {
    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const blobUrl = urlParams.get('url');
    const useBlob = urlParams.get('blob') === '1';

    if (blobUrl) {
      // 从 URL 参数加载（用于大图片）
      return new Promise((resolve) => {
        this.bgImage = new Image();
        this.bgImage.onload = () => {
          this.canvas.width = this.bgImage.width;
          this.canvas.height = this.bgImage.height;
          this.ctx.drawImage(this.bgImage, 0, 0);
          document.getElementById('canvasSize').textContent =
            `${this.canvas.width} × ${this.canvas.height}`;
          this.fitToWindow();
          resolve();
        };
        this.bgImage.src = blobUrl;
      });
    }

    if (useBlob) {
      // 从 storage 获取 Blob URL
      const result = await chrome.storage.local.get('tempScreenshotBlobUrl');
      if (result.tempScreenshotBlobUrl) {
        return new Promise((resolve) => {
          this.bgImage = new Image();
          this.bgImage.onload = () => {
            this.canvas.width = this.bgImage.width;
            this.canvas.height = this.bgImage.height;
            this.ctx.drawImage(this.bgImage, 0, 0);
            document.getElementById('canvasSize').textContent =
              `${this.canvas.width} × ${this.canvas.height}`;
            this.fitToWindow();
            // 清理 Blob URL
            chrome.storage.local.remove('tempScreenshotBlobUrl');
            resolve();
          };
          this.bgImage.src = result.tempScreenshotBlobUrl;
        });
      }
    }

    // 默认从 storage 加载
    const result = await chrome.storage.local.get('tempScreenshot');
    if (!result.tempScreenshot) {
      alert(t('noScreenshotData') || 'No screenshot data');
      return;
    }

    return new Promise((resolve) => {
      this.bgImage = new Image();
      this.bgImage.onload = () => {
        this.canvas.width = this.bgImage.width;
        this.canvas.height = this.bgImage.height;
        this.ctx.drawImage(this.bgImage, 0, 0);
        document.getElementById('canvasSize').textContent =
          `${this.canvas.width} × ${this.canvas.height}`;
        this.fitToWindow();
        // 清理 storage
        chrome.storage.local.remove('tempScreenshot');
        resolve();
      };
      this.bgImage.src = result.tempScreenshot;
    });
  }

  // ============ 缩放和平移 ============

  bindZoomControls() {
    document.getElementById('zoomIn').addEventListener('click', () => {
      this.zoomBy(0.2);
    });

    document.getElementById('zoomOut').addEventListener('click', () => {
      this.zoomBy(-0.2);
    });

    document.getElementById('zoomFit').addEventListener('click', () => {
      this.fitToWindow();
    });

    // 鼠标滚轮缩放
    this.canvasViewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        this.zoomBy(delta);
      }
    }, { passive: false });

    // 空格键 + 拖拽平移（裁剪模式下禁用，防止裁剪框与图片错位）
    this.canvasViewport.addEventListener('mousedown', (e) => {
      if (this.isCropping) return;
      if (e.button === 0 && (e.shiftKey || this.currentTool === 'select')) {
        // 检查是否点击在画布空白处
        const pos = this.getMousePos(e);
        const shapeIndex = this.findShapeAt(pos.x, pos.y);
        if (shapeIndex === -1 && !this.isDrawing) {
          this.startPan(e);
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isCropping) return;
      if (this.isPanning) {
        this.doPan(e);
      }
    });

    document.addEventListener('mouseup', () => {
      this.endPan();
    });

    // 窗口尺寸变化时自动重居中，避免右侧出现大块空白
    window.addEventListener('resize', () => {
      if (this.isCropping || this.isPanning) return;
      this.centerViewport();
    });
  }

  zoomBy(delta) {
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
    if (newScale !== this.scale) {
      this.scale = newScale;
      this.updateTransform();
    }
  }

  setZoom(newScale) {
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    this.updateTransform();
  }

  fitToWindow() {
    if (!this.canvas.width || !this.canvas.height) return;

    const viewportWidth = Math.max(1, this.canvasViewport.clientWidth - 80);
    const viewportHeight = Math.max(1, this.canvasViewport.clientHeight - 80);

    const scaleX = viewportWidth / this.canvas.width;
    const scaleY = viewportHeight / this.canvas.height;

    this.scale = Math.max(this.minScale, Math.min(scaleX, scaleY, 1));
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
    this.centerViewport();
  }

  centerViewport() {
    requestAnimationFrame(() => {
      this.canvasViewport.scrollLeft = Math.max(0, (this.canvasViewport.scrollWidth - this.canvasViewport.clientWidth) / 2);
      this.canvasViewport.scrollTop = Math.max(0, (this.canvasViewport.scrollHeight - this.canvasViewport.clientHeight) / 2);
    });
  }

  updateTransform() {
    // 用 canvas CSS 尺寸缩放，保证溢出时出现滚动条
    this.canvas.style.width = `${Math.max(1, Math.round(this.canvas.width * this.scale))}px`;
    this.canvas.style.height = `${Math.max(1, Math.round(this.canvas.height * this.scale))}px`;
    this.canvasTransform.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
    const zoomText = Math.round(this.scale * 100) + '%';
    const zoomValueEl = document.getElementById('zoomValue');
    const zoomStatusEl = document.getElementById('zoomStatus');
    if (zoomValueEl) zoomValueEl.textContent = zoomText;
    if (zoomStatusEl) zoomStatusEl.textContent = zoomText;
  }

  startPan(e) {
    this.isPanning = true;
    this.panStartX = e.clientX - this.panX;
    this.panStartY = e.clientY - this.panY;
    this.canvasViewport.classList.add('panning');
  }

  doPan(e) {
    if (!this.isPanning) return;
    this.panX = e.clientX - this.panStartX;
    this.panY = e.clientY - this.panStartY;
    this.updateTransform();
  }

  endPan() {
    this.isPanning = false;
    this.canvasViewport.classList.remove('panning');
  }

  // 将屏幕坐标转换为画布坐标（考虑缩放和平移）
  screenToCanvas(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const ratioX = this.canvas.width / Math.max(1, rect.width);
    const ratioY = this.canvas.height / Math.max(1, rect.height);
    return {
      x: (screenX - rect.left) * ratioX,
      y: (screenY - rect.top) * ratioY
    };
  }

  bindEvents() {
    // 鼠标事件
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    
    // 坐标显示 - 使用缩放后的坐标
    this.canvas.addEventListener('mousemove', (e) => {
      const pos = this.getMousePos(e);
      document.getElementById('mousePos').textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
    });
  }

  bindTools() {
    document.querySelectorAll('.tool').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
        this.updateCursor();
      });
    });
  }

  bindStyleControls() {
    // 颜色选择
    const colorPicker = document.getElementById('colorPicker');
    colorPicker.addEventListener('change', (e) => {
      this.color = e.target.value;
      document.querySelectorAll('.dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.color === this.color);
      });

      if (this.pendingText) {
        this.pendingText.color = this.color;
        this.redraw();
      }

      if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex]?.type === 'text') {
        this.shapes[this.selectedShapeIndex].color = this.color;
        this.redraw();
      }
    });

    // 颜色预设
    document.querySelectorAll('.dot').forEach(dot => {
      dot.addEventListener('click', () => {
        this.color = dot.dataset.color;
        colorPicker.value = this.color;
        document.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');

        if (this.pendingText) {
          this.pendingText.color = this.color;
          this.redraw();
        }

        if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex]?.type === 'text') {
          this.shapes[this.selectedShapeIndex].color = this.color;
          this.redraw();
        }
      });
    });

    // 线条粗细 / 文字字号
    const strokeWidth = document.getElementById('strokeWidth');
    const widthValue = document.querySelector('.width-value');
    strokeWidth.addEventListener('input', (e) => {
      this.strokeWidth = parseInt(e.target.value);
      widthValue.textContent = this.strokeWidth;

      if (this.pendingText) {
        this.pendingText.fontSize = this.strokeWidth;
        this.redraw();
      }

      if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex]?.type === 'text') {
        this.shapes[this.selectedShapeIndex].fontSize = this.strokeWidth;
        this.redraw();
      }
    });

    // 字体
    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily) {
      fontFamily.value = this.fontFamily;
      fontFamily.addEventListener('change', (e) => {
        this.fontFamily = e.target.value;
        if (this.pendingText) {
          this.pendingText.fontFamily = this.fontFamily;
          this.redraw();
        }
        if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex]?.type === 'text') {
          this.shapes[this.selectedShapeIndex].fontFamily = this.fontFamily;
          this.redraw();
        }
      });
    }

    // 填充模式切换
    const fillToggle = document.getElementById('fillToggle');
    if (fillToggle) {
      fillToggle.addEventListener('click', () => {
        this.fillMode = !this.fillMode;
        fillToggle.classList.toggle('active', this.fillMode);
        const strokeIcon = fillToggle.querySelector('.stroke-icon');
        const fillIcon = fillToggle.querySelector('.fill-icon');
        if (strokeIcon) strokeIcon.style.display = this.fillMode ? 'none' : 'block';
        if (fillIcon) fillIcon.style.display = this.fillMode ? 'block' : 'none';
      });
    }
  }

  bindLanguageToggle() {
    const langBtn = document.getElementById('langToggle');
    const langLabel = document.getElementById('langLabel');
    if (!langBtn) return;

    // 设置初始显示
    langLabel.textContent = currentLang === 'zh' ? '中/En' : 'En/中';

    langBtn.addEventListener('click', () => {
      const newLang = currentLang === 'zh' ? 'en' : 'zh';
      setLanguage(newLang);
      langLabel.textContent = newLang === 'zh' ? '中/En' : 'En/中';

      // 更新 fillToggle 的 title
      const fillToggle = document.getElementById('fillToggle');
      if (fillToggle) {
        fillToggle.dataset.i18nTitle = this.fillMode ? 'fillMode' : 'strokeMode';
      }
    });
  }

  bindActions() {
    // 撤销
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    // 重做
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
    // 删除选中
    document.getElementById('deleteBtn').addEventListener('click', () => this.deleteSelected());
    // 清空
    document.getElementById('clearBtn').addEventListener('click', () => this.clear());
    // 裁剪
    document.getElementById('cropBtn').addEventListener('click', () => this.startCrop());
    // 复制
    document.getElementById('copyBtn').addEventListener('click', () => this.copyToClipboard());
    // 下载
    document.getElementById('downloadBtn').addEventListener('click', () => this.download());

    // 文字输入确认/取消
    document.getElementById('textConfirm').addEventListener('click', () => this.confirmText());
    document.getElementById('textCancel').addEventListener('click', () => this.cancelText());

    this.textDragHandle?.addEventListener('mousedown', (e) => {
      this.isTextLayerDragging = true;
      const rect = this.textInputLayer.getBoundingClientRect();
      this.textLayerDragOffsetX = e.clientX - rect.left;
      this.textLayerDragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isTextLayerDragging) return;
      this.textInputLayer.style.left = `${Math.round(e.clientX - this.textLayerDragOffsetX)}px`;
      this.textInputLayer.style.top = `${Math.round(e.clientY - this.textLayerDragOffsetY)}px`;
    });

    document.addEventListener('mouseup', () => {
      this.isTextLayerDragging = false;
    });

    this.textInput.addEventListener('input', () => {
      if (!this.pendingText) return;
      this.pendingText.text = this.textInput.value;
      this.pendingText.fontSize = Math.max(10, this.strokeWidth);
      this.pendingText.color = this.color;
      this.pendingText.fontFamily = this.fontFamily;
      this.textInput.style.color = this.color;
      this.textInput.style.fontSize = this.pendingText.fontSize + 'px';
      this.textInput.style.fontFamily = this.fontFamily;
      this.redraw();
    });

    this.textInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this.confirmText();
      if (e.key === 'Escape') this.cancelText();
    });
  }

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // 工具快捷键
      switch(e.key.toLowerCase()) {
        case 'v': this.setTool('select'); break;
        case 'r': this.setTool('rect'); break;
        case 'e': this.setTool('ellipse'); break;
        case 'a': this.setTool('arrow'); break;
        case 'l': this.setTool('line'); break;
        case 'p': this.setTool('pen'); break;
        case 'g': this.setTool('triangle'); break;
        case 's': this.setTool('star'); break;
        case 't': this.setTool('text'); break;
        case 'm': this.setTool('mosaic'); break;
        case 'u': this.setTool('roundRect'); break;
        case 'b': this.setTool('blur'); break;
        case 'delete':
        case 'backspace':
          if (this.selectedShapeIndex >= 0) this.deleteSelected();
          break;
      }

      // 撤销/重做
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        this.redo();
      }

      // 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.download();
      }
    });
  }

  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll('.tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    this.updateCursor();
  }

  updateCursor() {
    this.canvas.className = 'tool-' + this.currentTool;
  }

  syncStyleControlsFromSelection() {
    const shape = this.selectedShapeIndex >= 0 ? this.shapes[this.selectedShapeIndex] : null;
    if (!shape || shape.type !== 'text') return;

    if (shape.color) {
      this.color = shape.color;
      const colorPicker = document.getElementById('colorPicker');
      if (colorPicker) colorPicker.value = this.color;
      document.querySelectorAll('.dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.color === this.color);
      });
    }

    if (shape.fontSize) {
      this.strokeWidth = shape.fontSize;
      const strokeWidth = document.getElementById('strokeWidth');
      if (strokeWidth) strokeWidth.value = this.strokeWidth;
      const widthValue = document.querySelector('.width-value');
      if (widthValue) widthValue.textContent = this.strokeWidth;
    }

    if (shape.fontFamily) {
      this.fontFamily = shape.fontFamily;
      const fontFamily = document.getElementById('fontFamily');
      if (fontFamily) fontFamily.value = this.fontFamily;
    }
  }

  getMousePos(e) {
    return this.screenToCanvas(e.clientX, e.clientY);
  }

  // 双击编辑文字
  onDoubleClick(e) {
    const pos = this.getMousePos(e);
    
    // 查找双击位置的形状
    const shapeIndex = this.findShapeAt(pos.x, pos.y);
    
    if (shapeIndex >= 0) {
      const shape = this.shapes[shapeIndex];
      
      // 如果是文字，可以编辑
      if (shape.type === 'text') {
        this.selectedShapeIndex = shapeIndex;
        this.updateDeleteButton();
        this.redraw();
        
        // 显示编辑框，预填充现有文字
        this.showTextInput(shape.x, shape.y, shape.text, shapeIndex);
      }
    }
  }

  onMouseDown(e) {
    const pos = this.getMousePos(e);

    const hitIndex = this.findShapeAt(pos.x, pos.y);

    // 选择模式：单击用于选中/拖动；文字编辑改为双击触发
    if (this.currentTool === 'select') {
      this.selectedShapeIndex = hitIndex;
      this.updateDeleteButton();
      this.syncStyleControlsFromSelection();

      // 如果点击了形状，开始拖动
      if (this.selectedShapeIndex >= 0) {
        this.isDragging = true;
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this.dragShapeOriginal = JSON.parse(JSON.stringify(this.shapes[this.selectedShapeIndex]));
      }

      this.redraw();
      return;
    }

    this.isDrawing = true;
    this.startX = pos.x;
    this.startY = pos.y;

    if (this.currentTool === 'text') {
      this.showTextInput(pos.x, pos.y);
      return;
    }

    if (this.currentTool === 'pen') {
      this.currentShape = {
        type: 'pen',
        color: this.color,
        width: this.strokeWidth,
        points: [{ x: pos.x, y: pos.y }]
      };
    } else if (this.currentTool === 'mosaic') {
      this.currentShape = {
        type: 'mosaic',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        size: this.strokeWidth * 3
      };
    } else if (this.currentTool === 'blur') {
      this.currentShape = {
        type: 'blur',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        radius: this.strokeWidth * 2
      };
    } else {
      // rect, ellipse, roundRect, arrow, line
      this.currentShape = {
        type: this.currentTool,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color: this.color,
        strokeWidth: this.strokeWidth,
        fill: this.fillMode
      };
    }
  }

  onMouseMove(e) {
    const pos = this.getMousePos(e);

    // 处理拖动
    if (this.isDragging && this.selectedShapeIndex >= 0 && this.dragShapeOriginal) {
      const dx = pos.x - this.dragStartX;
      const dy = pos.y - this.dragStartY;
      const shape = this.shapes[this.selectedShapeIndex];
      const original = this.dragShapeOriginal;

      if (shape.type === 'pen') {
        // 钢笔工具：移动所有点
        shape.points = original.points.map(p => ({
          x: p.x + dx,
          y: p.y + dy
        }));
      } else if (shape.type === 'text') {
        // 文字
        shape.x = original.x + dx;
        shape.y = original.y + dy;
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        // 线条和箭头
        shape.x = original.x + dx;
        shape.y = original.y + dy;
        // width和height表示终点相对于起点的偏移
      } else {
        // 其他形状（矩形、圆形、马赛克、模糊等）
        shape.x = original.x + dx;
        shape.y = original.y + dy;
      }

      this.redraw();
      return;
    }

    if (!this.isDrawing || !this.currentShape) return;

    if (this.currentShape.type === 'pen') {
      this.currentShape.points.push({ x: pos.x, y: pos.y });
      this.redraw();
      this.drawShape(this.currentShape);
    } else if (this.currentShape.type === 'mosaic' || this.currentShape.type === 'blur') {
      this.currentShape.width = pos.x - this.startX;
      this.currentShape.height = pos.y - this.startY;
      this.redraw();
      this.drawShape(this.currentShape);
    } else {
      this.currentShape.width = pos.x - this.startX;
      this.currentShape.height = pos.y - this.startY;
      this.redraw();
      this.drawShape(this.currentShape);
    }
  }

  onMouseUp() {
    // 处理拖动结束
    if (this.isDragging) {
      this.isDragging = false;
      this.dragShapeOriginal = null;
      this.saveHistory();
      return;
    }

    if (!this.isDrawing || !this.currentShape) return;

    this.isDrawing = false;

    // 过滤掉太小的形状
    const minSize = 5;
    if (this.currentShape.type !== 'pen' &&
        Math.abs(this.currentShape.width) < minSize &&
        Math.abs(this.currentShape.height) < minSize) {
      this.currentShape = null;
      this.redraw();
      return;
    }

    this.shapes.push(this.currentShape);
    this.currentShape = null;
    this.redraw();
    this.saveHistory();
  }

  drawShape(shape, isSelected = false) {
    this.ctx.save();

    // 选中状态高亮
    if (isSelected) {
      this.ctx.shadowColor = '#667eea';
      this.ctx.shadowBlur = 10;
    }

    switch(shape.type) {
      case 'rect':
        this.ctx.strokeStyle = shape.color;
        this.ctx.lineWidth = shape.strokeWidth;
        if (shape.fill) {
          this.ctx.fillStyle = withAlpha(shape.color);
          this.ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
        }
        this.ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
        break;

      case 'roundRect':
        this.ctx.strokeStyle = shape.color;
        this.ctx.lineWidth = shape.strokeWidth;
        this.drawRoundRect(shape.x, shape.y, shape.width, shape.height, 10, shape.fill, shape.color);
        break;

      case 'ellipse':
        this.ctx.strokeStyle = shape.color;
        this.ctx.lineWidth = shape.strokeWidth;
        this.ctx.beginPath();
        this.ctx.ellipse(
          shape.x + shape.width / 2,
          shape.y + shape.height / 2,
          Math.abs(shape.width / 2),
          Math.abs(shape.height / 2),
          0, 0, Math.PI * 2
        );
        if (shape.fill) {
          this.ctx.fillStyle = withAlpha(shape.color);
          this.ctx.fill();
        }
        this.ctx.stroke();
        break;

      case 'triangle':
        this.drawTriangle(shape);
        break;

      case 'star':
        this.drawStar(shape);
        break;

      case 'arrow':
        this.drawArrow(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height, shape.color, shape.strokeWidth);
        break;

      case 'line':
        this.ctx.strokeStyle = shape.color;
        this.ctx.lineWidth = shape.strokeWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(shape.x, shape.y);
        this.ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
        this.ctx.stroke();
        break;

      case 'pen':
        this.ctx.strokeStyle = shape.color;
        this.ctx.lineWidth = shape.width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        if (shape.points.length > 0) {
          this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (let i = 1; i < shape.points.length; i++) {
            this.ctx.lineTo(shape.points[i].x, shape.points[i].y);
          }
        }
        this.ctx.stroke();
        break;

      case 'text':
        this.ctx.fillStyle = shape.color;
        this.ctx.font = `${shape.fontSize || 20}px ${shape.fontFamily || "-apple-system, sans-serif"}`;
        this.drawMultilineText(shape.text || '', shape.x, shape.y, shape.fontSize || 20, shape.fontFamily || "-apple-system, sans-serif");
        break;

      case 'mosaic':
        this.drawMosaic(shape, isSelected, !!this.currentShape);
        break;

      case 'blur':
        this.drawBlur(shape, isSelected, !!this.currentShape);
        break;
    }

    this.ctx.restore();
  }

  // 绘制圆角矩形
  drawRoundRect(x, y, width, height, radius, fill, color) {
    const r = Math.abs(radius);
    const w = Math.abs(width);
    const h = Math.abs(height);
    const left = width < 0 ? x - w : x;
    const top = height < 0 ? y - h : y;

    this.ctx.beginPath();
    this.ctx.moveTo(left + r, top);
    this.ctx.lineTo(left + w - r, top);
    this.ctx.quadraticCurveTo(left + w, top, left + w, top + r);
    this.ctx.lineTo(left + w, top + h - r);
    this.ctx.quadraticCurveTo(left + w, top + h, left + w - r, top + h);
    this.ctx.lineTo(left + r, top + h);
    this.ctx.quadraticCurveTo(left, top + h, left, top + h - r);
    this.ctx.lineTo(left, top + r);
    this.ctx.quadraticCurveTo(left, top, left + r, top);
    this.ctx.closePath();

    if (fill) {
      this.ctx.fillStyle = withAlpha(color);
      this.ctx.fill();
    }
    this.ctx.stroke();
  }

  // 绘制三角形
  drawTriangle(shape) {
    const x = shape.x;
    const y = shape.y;
    const w = shape.width;
    const h = shape.height;

    this.ctx.strokeStyle = shape.color;
    this.ctx.lineWidth = shape.strokeWidth;

    this.ctx.beginPath();
    this.ctx.moveTo(x + w / 2, y);
    this.ctx.lineTo(x + w, y + h);
    this.ctx.lineTo(x, y + h);
    this.ctx.closePath();

    if (shape.fill) {
      this.ctx.fillStyle = withAlpha(shape.color);
      this.ctx.fill();
    }
    this.ctx.stroke();
  }

  // 绘制星形
  drawStar(shape) {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const outerR = Math.min(Math.abs(shape.width), Math.abs(shape.height)) / 2;
    const innerR = outerR * 0.4;
    const points = 5;

    this.ctx.strokeStyle = shape.color;
    this.ctx.lineWidth = shape.strokeWidth;
    this.ctx.beginPath();

    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI / points) - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();

    if (shape.fill) {
      this.ctx.fillStyle = withAlpha(shape.color);
      this.ctx.fill();
    }
    this.ctx.stroke();
  }

  drawMultilineText(text, x, y, fontSize, fontFamily) {
    const lines = String(text).split('\n');
    const lineHeight = Math.round(fontSize * 1.35);
    lines.forEach((line, idx) => {
      this.ctx.fillText(line, x, y + idx * lineHeight);
    });
  }

  drawArrow(x1, y1, x2, y2, color, strokeWidth) {
    const headLength = Math.max(strokeWidth * 3, 15);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = strokeWidth;

    // 计算箭头底部中心点（从终点往回退一段距离）
    const arrowBaseX = x2 - headLength * Math.cos(angle);
    const arrowBaseY = y2 - headLength * Math.sin(angle);

    // 线 - 从起点画到箭头底部，不画到箭头顶点
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(arrowBaseX, arrowBaseY);
    this.ctx.stroke();

    // 箭头 - 从底部中心向两侧展开到顶点
    this.ctx.beginPath();
    this.ctx.moveTo(x2, y2);  // 顶点
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  drawMosaic(shape, isSelected = false, isDrawing = false) {
    const x = Math.min(shape.x, shape.x + shape.width);
    const y = Math.min(shape.y, shape.y + shape.height);
    const w = Math.abs(shape.width);
    const h = Math.abs(shape.height);
    const size = shape.size || 10;

    if (w < 1 || h < 1) return;

    try {
      // 降采样 → 放大法（性能远优于逐像素计算平均色）
      const offCanvas = document.createElement('canvas');
      const scaledW = Math.max(1, Math.floor(w / size));
      const scaledH = Math.max(1, Math.floor(h / size));
      offCanvas.width = scaledW;
      offCanvas.height = scaledH;
      const offCtx = offCanvas.getContext('2d');

      // 缩小：开启平滑让浏览器计算平均色
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';
      offCtx.drawImage(this.canvas, x, y, w, h, 0, 0, scaledW, scaledH);

      // 放大回原尺寸，关闭平滑 → 产生像素块效果
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(offCanvas, 0, 0, scaledW, scaledH, x, y, w, h);
      this.ctx.imageSmoothingEnabled = true;

      // 只有在绘制过程中或选中时才绘制边界线
      if (isDrawing || isSelected) {
        this.ctx.strokeStyle = isDrawing ? '#000000' : '#667eea';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(x, y, w, h);
      }
    } catch(e) {
      console.error('Mosaic error:', e);
    }
  }

  // 高斯模糊
  drawBlur(shape, isSelected = false, isDrawing = false) {
    const x = Math.min(shape.x, shape.x + shape.width);
    const y = Math.min(shape.y, shape.y + shape.height);
    const w = Math.abs(shape.width);
    const h = Math.abs(shape.height);
    const radius = shape.radius || 10;

    if (w < 1 || h < 1) return;

    try {
      // 使用 Canvas filter 实现高斯模糊
      this.ctx.save();
      this.ctx.filter = `blur(${radius}px)`;
      // 重新绘制该区域（从背景图截取）
      if (this.bgImage) {
        this.ctx.drawImage(
          this.canvas,
          x, y, w, h,
          x, y, w, h
        );
      }
      this.ctx.restore();

      // 只有在绘制过程中或选中时才绘制边界线
      if (isDrawing || isSelected) {
        this.ctx.strokeStyle = isDrawing ? '#000000' : '#667eea';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(x, y, w, h);
      }
    } catch(e) {
      console.error('Blur error:', e);
    }
  }

  // 查找点击位置的形状
  findShapeAt(x, y) {
    // 从后往前查找（后绘制的在上面）
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (this.isPointInShape(x, y, shape)) {
        return i;
      }
    }
    return -1;
  }

  // 判断点是否在形状内
  isPointInShape(x, y, shape) {
    const tolerance = 10; // 点击容差

    switch(shape.type) {
      case 'rect':
      case 'roundRect':
      case 'mosaic':
      case 'blur':
        return x >= Math.min(shape.x, shape.x + shape.width) - tolerance &&
               x <= Math.max(shape.x, shape.x + shape.width) + tolerance &&
               y >= Math.min(shape.y, shape.y + shape.height) - tolerance &&
               y <= Math.max(shape.y, shape.y + shape.height) + tolerance;

      case 'ellipse':
        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        const rx = Math.abs(shape.width / 2);
        const ry = Math.abs(shape.height / 2);
        return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1.2;

      case 'text':
        this.ctx.font = `${shape.fontSize || 20}px -apple-system, sans-serif`;
        const metrics = this.ctx.measureText(shape.text);
        return x >= shape.x - tolerance &&
               x <= shape.x + metrics.width + tolerance &&
               y >= shape.y - (shape.fontSize || 20) - tolerance &&
               y <= shape.y + tolerance;

      case 'triangle': {
        // 三角形三个顶点（与 drawTriangle 保持一致）
        const tx1 = shape.x + shape.width / 2, ty1 = shape.y;
        const tx2 = shape.x + shape.width,      ty2 = shape.y + shape.height;
        const tx3 = shape.x,                    ty3 = shape.y + shape.height;
        // 先做包围盒粗筛，再用叉积精确判断点在三角形内
        if (x < Math.min(tx1, tx2, tx3) - tolerance || x > Math.max(tx1, tx2, tx3) + tolerance ||
            y < Math.min(ty1, ty2, ty3) - tolerance || y > Math.max(ty1, ty2, ty3) + tolerance) {
          return false;
        }
        const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
        const d1 = sign(x, y, tx1, ty1, tx2, ty2);
        const d2 = sign(x, y, tx2, ty2, tx3, ty3);
        const d3 = sign(x, y, tx3, ty3, tx1, ty1);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
      }

      case 'star': {
        // 星形：先做外接圆（bounding circle）粗筛，再用包围盒兜底
        const scx = shape.x + shape.width / 2;
        const scy = shape.y + shape.height / 2;
        const outerR = Math.min(Math.abs(shape.width), Math.abs(shape.height)) / 2;
        const dist = Math.sqrt((x - scx) ** 2 + (y - scy) ** 2);
        return dist <= outerR + tolerance;
      }

      case 'line':
      case 'arrow':
        return this.isPointNearLine(x, y, shape.x, shape.y,
          shape.x + shape.width, shape.y + shape.height, tolerance);

      case 'pen':
        if (!shape.points || shape.points.length === 0) return false;
        for (let i = 1; i < shape.points.length; i++) {
          if (this.isPointNearLine(x, y, shape.points[i-1].x, shape.points[i-1].y,
              shape.points[i].x, shape.points[i].y, tolerance)) {
            return true;
          }
        }
        return false;
    }
    return false;
  }

  // 判断点是否靠近线段
  isPointNearLine(px, py, x1, y1, x2, y2, tolerance) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = x1; yy = y1;
    } else if (param > 1) {
      xx = x2; yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    const dx = px - xx;
    const dy = py - yy;
    return (dx * dx + dy * dy) <= tolerance * tolerance;
  }

  // 文字输入（点击即内联编辑，实时预览）
  showTextInput(x, y, existingText = '', editIndex = -1) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = rect.left + (x / this.canvas.width) * rect.width;
    const screenY = rect.top + (y / this.canvas.height) * rect.height;
    const fontSize = Math.max(10, this.strokeWidth);

    this.pendingText = {
      x,
      y,
      editIndex,
      fontSize,
      color: this.color,
      fontFamily: this.fontFamily,
      text: existingText || ''
    };

    this.textInputLayer.style.left = Math.round(screenX) + 'px';
    this.textInputLayer.style.top = Math.round(screenY - fontSize) + 'px';
    this.textInputLayer.classList.add('active');

    this.textInput.value = existingText || '';
    this.textInput.style.color = this.color;
    this.textInput.style.fontSize = fontSize + 'px';
    this.textInput.style.fontFamily = this.fontFamily;

    this.redraw();

    setTimeout(() => {
      this.textInput.focus();
      this.textInput.selectionStart = this.textInput.value.length;
      this.textInput.selectionEnd = this.textInput.value.length;
    }, 0);
  }

  confirmText() {
    const text = this.textInput.value.trim();
    if (text && this.pendingText) {
      const { x, y, editIndex, fontSize, color, fontFamily } = this.pendingText;

      if (editIndex >= 0 && this.shapes[editIndex]) {
        this.shapes[editIndex].text = text;
        this.shapes[editIndex].color = color;
        this.shapes[editIndex].fontSize = fontSize;
        this.shapes[editIndex].fontFamily = fontFamily;
      } else {
        this.shapes.push({
          type: 'text',
          x,
          y,
          text,
          color,
          fontSize,
          fontFamily
        });
      }

      this.cancelText();
      this.redraw();
      this.saveHistory();
      return;
    }

    this.cancelText();
  }

  cancelText() {
    this.textInputLayer.classList.remove('active');
    this.textInput.value = '';
    this.pendingText = null;
    this.redraw();
  }

  // 历史记录
  saveHistory() {
    // 删除当前步骤之后的记录
    this.history = this.history.slice(0, this.historyStep + 1);

    // 保存当前状态
    this.history.push(JSON.parse(JSON.stringify(this.shapes)));

    // 限制历史记录数量
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyStep++;
    }

    this.updateHistoryButtons();
    this.renderLayers(); // 更新图层面板
  }

  undo() {
    if (this.historyStep > 0) {
      this.historyStep--;
      this.shapes = JSON.parse(JSON.stringify(this.history[this.historyStep]));
      this.selectedShapeIndex = -1;
      this.redraw();
      this.updateHistoryButtons();
      this.renderLayers();
      this.updateDeleteButton();
    }
  }

  redo() {
    if (this.historyStep < this.history.length - 1) {
      this.historyStep++;
      this.shapes = JSON.parse(JSON.stringify(this.history[this.historyStep]));
      this.selectedShapeIndex = -1;
      this.redraw();
      this.updateHistoryButtons();
      this.renderLayers();
      this.updateDeleteButton();
    }
  }

  updateHistoryButtons() {
    document.getElementById('undoBtn').disabled = this.historyStep <= 0;
    document.getElementById('redoBtn').disabled = this.historyStep >= this.history.length - 1;
  }

  clear() {
    if (this.shapes.length === 0) return;
    if (confirm('确定要清空所有标注吗？')) {
      this.shapes = [];
      this.selectedShapeIndex = -1;
      this.layerVisibility.clear();
      this.redraw();
      this.renderLayers();
      this.saveHistory();
    }
  }

  // 删除选中的形状
  deleteSelected() {
    if (this.selectedShapeIndex >= 0) {
      this.shapes.splice(this.selectedShapeIndex, 1);
      this.selectedShapeIndex = -1;
      this.updateDeleteButton();
      this.redraw();
      this.renderLayers();
      this.saveHistory();
    }
  }

  // 更新删除按钮状态
  updateDeleteButton() {
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) {
      deleteBtn.disabled = this.selectedShapeIndex < 0;
    }
  }

  // 复制到剪贴板
  async copyToClipboard() {
    try {
      this.canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          this.showToast(t('copied'));
        } catch (err) {
          console.error('Copy failed:', err);
          alert('Copy failed, please use save');
        }
      });
    } catch (err) {
      console.error('Copy error:', err);
      alert('Copy failed');
    }
  }

  // 下载
  download() {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `zdfshot-${timestamp}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
    this.showToast(t('saved'));
  }

  // 裁剪功能（默认全图选区 + 四角四边可调）
  startCrop() {
    if (this.isCropping) return;
    this.isCropping = true;
    this.cropOverlay.classList.add('active');
    const cropHint = this.cropOverlay.querySelector('.crop-hint');
    if (cropHint) cropHint.style.display = 'block';

    const getBounds = () => {
      const canvasRect = this.canvas.getBoundingClientRect();
      const overlayRect = this.cropOverlay.getBoundingClientRect();
      return {
        canvasOffsetX: canvasRect.left - overlayRect.left,
        canvasOffsetY: canvasRect.top - overlayRect.top,
        canvasW: canvasRect.width,
        canvasH: canvasRect.height
      };
    };

    const initBounds = getBounds();

    // 进入裁剪时默认整张图选中
    this._cropBoxCss = { x: 0, y: 0, w: initBounds.canvasW, h: initBounds.canvasH };

    // 初始化 8 个控制点（四角 + 四边）+ 尺寸标签
    if (!this.cropSelection.dataset.handlesInited) {
      const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      this.cropSelection.innerHTML = dirs
        .map((dir) => `<div class="crop-handle crop-handle-${dir}" data-dir="${dir}"></div>`)
        .join('') + '<div class="crop-size-label" id="cropSizeLabel"></div>';
      this.cropSelection.dataset.handlesInited = '1';
    }

    this.cropSelection.style.display = 'block';
    this.cropSelection.classList.add('active');
    // 操作按钮改为首轮框选完成后再显示，避免影响拖拽
    this.cropActions.classList.remove('active');
    const cropHint2 = this.cropOverlay.querySelector('.crop-hint');
    if (cropHint2) cropHint2.style.display = 'none';

    const minSize = 20;

    const renderCropSelection = () => {
      const b = this._cropBoxCss;
      if (!b) return;
      const bounds = getBounds();
      this.cropSelection.style.left = (bounds.canvasOffsetX + b.x) + 'px';
      this.cropSelection.style.top = (bounds.canvasOffsetY + b.y) + 'px';
      this.cropSelection.style.width = b.w + 'px';
      this.cropSelection.style.height = b.h + 'px';

      // 左下角实时显示裁剪尺寸（图片像素）
      const sizeLabel = document.getElementById('cropSizeLabel');
      if (sizeLabel) {
        const scaleX = this.canvas.width / Math.max(1, bounds.canvasW);
        const scaleY = this.canvas.height / Math.max(1, bounds.canvasH);
        const pxW = Math.max(1, Math.round(b.w * scaleX));
        const pxH = Math.max(1, Math.round(b.h * scaleY));
        sizeLabel.textContent = `${pxW} × ${pxH}`;
      }
    };

    renderCropSelection();

    this._cropScrollHandler = () => renderCropSelection();
    this.canvasViewport.addEventListener('scroll', this._cropScrollHandler);

    // 窗口尺寸变化时，裁剪框跟随画布实时重定位
    this._cropResizeHandler = () => renderCropSelection();
    window.addEventListener('resize', this._cropResizeHandler);

    this._cropMouseDownHandler = (e) => {
      const handle = e.target.closest('.crop-handle');
      const onSelection = e.target === this.cropSelection;
      if (!handle && !onSelection) return;

      e.preventDefault();
      e.stopPropagation();

      const mode = handle ? 'resize' : 'move';
      const dir = handle ? handle.dataset.dir : '';
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startBox = { ...this._cropBoxCss };

      const onMouseMove = (e2) => {
        const bounds = getBounds();
        const dx = e2.clientX - startClientX;
        const dy = e2.clientY - startClientY;

        let x = startBox.x;
        let y = startBox.y;
        let w = startBox.w;
        let h = startBox.h;

        if (mode === 'move') {
          x = Math.max(0, Math.min(bounds.canvasW - w, startBox.x + dx));
          y = Math.max(0, Math.min(bounds.canvasH - h, startBox.y + dy));
        } else {
          if (dir.includes('e')) {
            w = Math.max(minSize, Math.min(bounds.canvasW - startBox.x, startBox.w + dx));
          }
          if (dir.includes('s')) {
            h = Math.max(minSize, Math.min(bounds.canvasH - startBox.y, startBox.h + dy));
          }
          if (dir.includes('w')) {
            const newX = Math.max(0, Math.min(startBox.x + startBox.w - minSize, startBox.x + dx));
            w = startBox.w + (startBox.x - newX);
            x = newX;
          }
          if (dir.includes('n')) {
            const newY = Math.max(0, Math.min(startBox.y + startBox.h - minSize, startBox.y + dy));
            h = startBox.h + (startBox.y - newY);
            y = newY;
          }
        }

        this._cropBoxCss = { x, y, w, h };
        renderCropSelection();
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const b = this._cropBoxCss;
        if (b && b.w > minSize && b.h > minSize) {
          this.cropActions.classList.add('active');
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    this.cropSelection.addEventListener('mousedown', this._cropMouseDownHandler);

    // 确认裁剪
    document.getElementById('cropConfirm').onclick = () => {
      this.applyCrop();
      this.endCrop();
    };

    // 取消裁剪
    document.getElementById('cropCancel').onclick = () => {
      this.endCrop();
    };

    // ESC 取消
    this.cropKeyHandler = (e) => {
      if (e.key === 'Escape') {
        this.endCrop();
      }
      if (e.key === 'Enter') {
        this.applyCrop();
        this.endCrop();
      }
    };
    document.addEventListener('keydown', this.cropKeyHandler);
  }

  applyCrop() {
    const canvasRect = this.canvas.getBoundingClientRect();
    const box = this._cropBoxCss;

    if (!box) return;

    // 用实际画布像素尺寸 ÷ 屏幕显示尺寸，得到真实的像素比
    // 这比 devicePixelRatio 更准确，因为编辑器有独立的缩放级别
    const scaleX = this.canvas.width  / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;

    let x = Math.round(box.x * scaleX);
    let y = Math.round(box.y * scaleY);
    let w = Math.round(box.w * scaleX);
    let h = Math.round(box.h * scaleY);

    // 边界保护，避免 drawImage 越界导致比例异常
    x = Math.max(0, Math.min(this.canvas.width - 1, x));
    y = Math.max(0, Math.min(this.canvas.height - 1, y));
    w = Math.max(1, Math.min(this.canvas.width - x, w));
    h = Math.max(1, Math.min(this.canvas.height - y, h));

    if (w < 10 || h < 10) return;

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      this.canvas,
      x, y, w, h,
      0, 0, w, h
    );

    // 更新画布
    const newImg = new Image();
    newImg.onload = () => {
      this.bgImage = newImg;
      this.canvas.width = canvas.width;
      this.canvas.height = canvas.height;
      this.ctx.drawImage(newImg, 0, 0);
      // 裁剪后重新适配显示，避免缩放状态导致视觉比例失调
      this.fitToWindow();

      // 清空所有标注（因为坐标系变了）
      this.shapes = [];
      this.layerVisibility.clear();
      this.selectedShapeIndex = -1;
      this.renderLayers();
      this.updateDeleteButton();

      // 更新状态栏
      document.getElementById('canvasSize').textContent =
        `${this.canvas.width} x ${this.canvas.height}`;

      this.saveHistory();
      this.showToast(t('saved'));
    };
    newImg.src = canvas.toDataURL('image/png');
  }

  endCrop() {
    this.isCropping = false;
    this._cropBoxCss = null;
    this.cropOverlay.classList.remove('active');
    this.cropSelection.classList.remove('active');
    this.cropActions.classList.remove('active');
    // 使用实例属性确保无论何种退出路径都能清理干净
    if (this._cropMouseDownHandler) {
      this.cropSelection.removeEventListener('mousedown', this._cropMouseDownHandler);
      this._cropMouseDownHandler = null;
    }
    if (this.cropKeyHandler) {
      document.removeEventListener('keydown', this.cropKeyHandler);
      this.cropKeyHandler = null;
    }
    if (this._cropScrollHandler) {
      this.canvasViewport.removeEventListener('scroll', this._cropScrollHandler);
      this._cropScrollHandler = null;
    }
    if (this._cropResizeHandler) {
      window.removeEventListener('resize', this._cropResizeHandler);
      this._cropResizeHandler = null;
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // ============ 图层面板 ============

  initLayersPanel() {
    this.renderLayers();
  }

  renderLayers() {
    const list = document.getElementById('layersList');
    const count = document.getElementById('layerCount');

    if (!list) return;

    count.textContent = this.shapes.length;

    if (this.shapes.length === 0) {
      list.innerHTML = '<div class="layers-empty">暂无标注</div>';
      return;
    }

    list.innerHTML = '';

    // 倒序显示（最新的在上面）
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      const item = this.createLayerItem(shape, i);
      list.appendChild(item);
    }
  }

  createLayerItem(shape, index) {
    const div = document.createElement('div');
    div.className = 'layer-item';
    if (index === this.selectedShapeIndex) div.classList.add('active');
    if (this.layerVisibility.get(index) === false) div.classList.add('hidden');

    const iconSvg = this.getLayerIcon(shape.type);
    const typeName = this.getLayerTypeName(shape.type);
    const preview = this.getLayerPreview(shape);

    div.innerHTML = `
      <div class="layer-icon">${iconSvg}</div>
      <div class="layer-info">
        <div class="layer-type">${typeName}</div>
        <div class="layer-preview">${preview}</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn" title="显示/隐藏" data-action="toggle" data-index="${index}">
          ${this.layerVisibility.get(index) === false ? this.getEyeOffIcon() : this.getEyeIcon()}
        </button>
        <button class="layer-btn delete" title="删除" data-action="delete" data-index="${index}">
          ${this.getTrashIcon()}
        </button>
      </div>
    `;

    // 点击选中
    div.addEventListener('click', (e) => {
      if (e.target.closest('.layer-btn')) return;
      this.selectLayer(index);
    });

    // 按钮事件
    div.querySelectorAll('.layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const idx = parseInt(btn.dataset.index);
        if (action === 'toggle') this.toggleLayerVisibility(idx);
        if (action === 'delete') this.deleteLayer(idx);
      });
    });

    return div;
  }

  getLayerIcon(type) {
    const icons = {
      rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
      roundRect: '<rect x="4" y="6" width="16" height="12" rx="3"/>',
      ellipse: '<circle cx="12" cy="12" r="7"/>',
      triangle: '<path d="M12 5L5 19h14L12 5z"/>',
      star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
      arrow: '<path d="M5 12h12M14 7l5 5-5 5"/>',
      line: '<path d="M5 19L19 5"/>',
      pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/>',
      text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
      mosaic: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
      blur: '<circle cx="12" cy="12" r="5" opacity="0.5"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons[type] || icons.rect}</svg>`;
  }

  getLayerTypeName(type) {
    const key = 'tool' + type.charAt(0).toUpperCase() + type.slice(1);
    return t(key) || type;
  }

  getLayerPreview(shape) {
    if (shape.type === 'text') return shape.text || t('toolText');
    if (shape.color) {
      const shortColor = shape.color.length > 7 ? shape.color.slice(0, 7) : shape.color;
      return shortColor;
    }
    return '';
  }

  getEyeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  getEyeOffIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  }

  getTrashIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  }

  selectLayer(index) {
    this.selectedShapeIndex = index;
    this.renderLayers();
    this.updateDeleteButton();
    this.redraw();
  }

  toggleLayerVisibility(index) {
    const current = this.layerVisibility.get(index);
    this.layerVisibility.set(index, current === false ? true : false);
    this.renderLayers();
    this.redraw();
  }

  deleteLayer(index) {
    this.shapes.splice(index, 1);
    // 重新调整可见性映射
    const newVisibility = new Map();
    this.layerVisibility.forEach((visible, idx) => {
      if (idx < index) newVisibility.set(idx, visible);
      if (idx > index) newVisibility.set(idx - 1, visible);
    });
    this.layerVisibility = newVisibility;

    if (this.selectedShapeIndex === index) {
      this.selectedShapeIndex = -1;
    } else if (this.selectedShapeIndex > index) {
      this.selectedShapeIndex--;
    }

    this.renderLayers();
    this.updateDeleteButton();
    this.redraw();
    this.saveHistory();
  }

  redraw() {
    // 清空并重绘背景
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.bgImage) {
      this.ctx.drawImage(this.bgImage, 0, 0);
    }

    // 绘制所有可见形状
    this.shapes.forEach((shape, index) => {
      if (this.layerVisibility.get(index) !== false) {
        this.drawShape(shape, index === this.selectedShapeIndex);
      }
    });

    // 文本编辑实时预览
    if (this.pendingText && this.textInputLayer?.classList.contains('active')) {
      const previewText = this.textInput?.value ?? this.pendingText.text ?? '';
      if (previewText) {
        this.ctx.save();
        this.ctx.fillStyle = this.pendingText.color || this.color;
        this.ctx.font = `${this.pendingText.fontSize || Math.max(10, this.strokeWidth)}px ${this.pendingText.fontFamily || this.fontFamily}`;
        this.drawMultilineText(previewText, this.pendingText.x, this.pendingText.y, this.pendingText.fontSize || Math.max(10, this.strokeWidth), this.pendingText.fontFamily || this.fontFamily);
        this.ctx.restore();
      }
    }
  }

  // ============ 自动保存 ============

  async loadDraft() {
    try {
      const result = await chrome.storage.local.get('zdfshot_draft');
      if (result.zdfshot_draft) {
        const draft = result.zdfshot_draft;
        // 检查草稿是否过期（7天）
        const now = Date.now();
        const age = now - (draft.timestamp || 0);
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

        if (age < maxAge && draft.version === 1 && draft.shapes && draft.shapes.length > 0) {
          // 恢复形状
          this.shapes = draft.shapes;
          this.layerVisibility = new Map(draft.layerVisibility || []);
          this.redraw();
          this.renderLayers();
          this.showToast(t('draftRestored'));
        }
      }
    } catch (e) {
      console.error('加载草稿失败:', e);
    }
  }

  setupAutoSave() {
    // 每30秒自动保存
    setInterval(() => this.saveDraft(), 30000);

    // 页面关闭/隐藏前保存（pagehide + visibilitychange 双保险，避免 beforeunload 中 async 执行不完整）
    window.addEventListener('pagehide', () => this.saveDraft());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveDraft();
    });

    // 保存按钮点击时也保存
    document.getElementById('downloadBtn')?.addEventListener('click', () => {
      this.clearDraft(); // 保存后清除草稿
    });
  }

  async saveDraft() {
    if (this.shapes.length === 0) return;

    try {
      const draft = {
        version: 1,
        timestamp: Date.now(),
        shapes: this.shapes,
        layerVisibility: Array.from(this.layerVisibility.entries())
      };
      await chrome.storage.local.set({ zdfshot_draft: draft });
    } catch (e) {
      console.error('保存草稿失败:', e);
    }
  }

  async clearDraft() {
    try {
      await chrome.storage.local.remove('zdfshot_draft');
    } catch (e) {
      console.error('清除草稿失败:', e);
    }
  }

}

// 启动编辑器
document.addEventListener('DOMContentLoaded', () => {
  new Editor();
});
