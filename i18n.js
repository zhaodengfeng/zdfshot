// ZDFShot i18n 多语言配置
const i18n = {
  zh: {
    // 通用
    appName: 'ZDFShot',
    save: '保存',
    cancel: '取消',
    confirm: '确认',
    delete: '删除',
    copy: '复制',
    clear: '清空',
    crop: '裁剪',
    
    // 工具
    toolSelect: '选择',
    toolRect: '矩形',
    toolRoundRect: '圆角矩形',
    toolEllipse: '圆形',
    toolTriangle: '三角形',
    toolStar: '星形',
    toolArrow: '箭头',
    toolLine: '直线',
    toolPen: '画笔',
    toolText: '文字',
    toolMosaic: '马赛克',
    toolBlur: '模糊',
    
    // 工具提示
    titleSelect: '选择 V',
    titleRect: '矩形 R',
    titleRoundRect: '圆角矩形 U',
    titleEllipse: '圆形 E',
    titleTriangle: '三角形 G',
    titleStar: '星形 S',
    titleArrow: '箭头 A',
    titleLine: '直线 L',
    titlePen: '画笔 P',
    titleText: '文字 T',
    titleMosaic: '马赛克 M',
    titleBlur: '模糊 B',
    
    // 样式
    fillMode: '填充模式',
    strokeMode: '描边模式',
    strokeWidth: '线宽',
    
    // 操作
    undo: '撤销',
    redo: '重做',
    undoTitle: '撤销 Ctrl+Z',
    redoTitle: '重做 Ctrl+Y',
    deleteTitle: '删除',
    clearTitle: '清空所有',
    copyTitle: '复制到剪贴板',
    downloadTitle: '保存图片',
    cropTitle: '裁剪图片',
    
    // 图层面板
    layers: '图层',
    layerEmpty: '暂无标注',
    
    // 裁剪
    cropHint: '拖动选择裁剪区域，按 ESC 取消',
    cropConfirm: '确认裁剪',
    
    // 文字输入
    textPlaceholder: '输入文字后按回车',
    
    // 提示
    copied: '已复制到剪贴板',
    saved: '图片已保存',
    draftRestored: '已恢复上次的草稿',
    clearConfirm: '确定要清空所有标注吗？',
    
    // 状态栏
    shortcuts: 'V选择 R矩形 T文字 Delete删除 Ctrl+Z撤销 Ctrl+S保存',
    
    // popup
    captureVisible: '截图可见区域',
    captureArea: '选择区域截图',
    captureFull: '整页截图',
    popupHint: 'Alt + Shift + S 快速截图',
    tagline: '截图与标注'
  },
  
  en: {
    // General
    appName: 'ZDFShot',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    copy: 'Copy',
    clear: 'Clear',
    crop: 'Crop',
    
    // Tools
    toolSelect: 'Select',
    toolRect: 'Rectangle',
    toolRoundRect: 'Rounded',
    toolEllipse: 'Ellipse',
    toolTriangle: 'Triangle',
    toolStar: 'Star',
    toolArrow: 'Arrow',
    toolLine: 'Line',
    toolPen: 'Pen',
    toolText: 'Text',
    toolMosaic: 'Mosaic',
    toolBlur: 'Blur',
    
    // Tool titles
    titleSelect: 'Select (V)',
    titleRect: 'Rectangle (R)',
    titleRoundRect: 'Rounded (U)',
    titleEllipse: 'Ellipse (E)',
    titleTriangle: 'Triangle (G)',
    titleStar: 'Star (S)',
    titleArrow: 'Arrow (A)',
    titleLine: 'Line (L)',
    titlePen: 'Pen (P)',
    titleText: 'Text (T)',
    titleMosaic: 'Mosaic (M)',
    titleBlur: 'Blur (B)',
    
    // Styles
    fillMode: 'Fill Mode',
    strokeMode: 'Stroke Mode',
    strokeWidth: 'Width',
    
    // Actions
    undo: 'Undo',
    redo: 'Redo',
    undoTitle: 'Undo (Ctrl+Z)',
    redoTitle: 'Redo (Ctrl+Y)',
    deleteTitle: 'Delete',
    clearTitle: 'Clear All',
    copyTitle: 'Copy to Clipboard',
    downloadTitle: 'Save Image',
    cropTitle: 'Crop Image',
    
    // Layers
    layers: 'Layers',
    layerEmpty: 'No annotations',
    
    // Crop
    cropHint: 'Drag to select crop area, ESC to cancel',
    cropConfirm: 'Confirm Crop',
    
    // Text
    textPlaceholder: 'Type and press Enter',
    
    // Toast
    copied: 'Copied to clipboard',
    saved: 'Image saved',
    draftRestored: 'Draft restored',
    clearConfirm: 'Clear all annotations?',
    
    // Status
    shortcuts: 'V=Select R=Rect T=Text Del=Delete Ctrl+Z=Undo Ctrl+S=Save',
    
    // popup
    captureVisible: 'Capture Visible',
    captureArea: 'Capture Area',
    captureFull: 'Capture Full Page',
    popupHint: 'Alt + Shift + S for quick capture',
    tagline: 'Screenshot & Annotation'
  }
};

// 当前语言
let currentLang = 'zh';

// 获取翻译
function t(key) {
  return i18n[currentLang]?.[key] || i18n['en'][key] || key;
}

// 切换语言
function setLanguage(lang) {
  if (i18n[lang]) {
    currentLang = lang;
    localStorage.setItem('zdfshot_lang', lang);
    applyTranslations();
  }
}

// 检测浏览器语言
function detectLanguage() {
  const saved = localStorage.getItem('zdfshot_lang');
  if (saved && i18n[saved]) return saved;
  
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith('zh')) return 'zh';
  return 'en';
}

// 应用翻译到 DOM
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) {
      const text = t(key);
      if (el.tagName === 'INPUT' && el.type !== 'text' || el.tagName === 'TEXTAREA') {
        // 对于非文本输入，使用 placeholder
        if (el.hasAttribute('data-i18n-placeholder')) {
          el.placeholder = t(el.dataset.i18nPlaceholder);
        }
      } else {
        el.textContent = text;
      }
    }
  });
  
  // 处理 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });
  
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });
}

// 初始化
function initI18n() {
  currentLang = detectLanguage();
  applyTranslations();
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { i18n, t, setLanguage, initI18n };
}
