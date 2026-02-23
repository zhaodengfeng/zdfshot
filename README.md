# ZDFShot

[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://github.com/zhaodengfeng/zdfshot)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/chrome-extension-brightgreen.svg)](https://chrome.google.com/webstore)

A lightweight Chrome extension for capturing screenshots and annotating with ease.

## Features

- **Multiple Capture Modes**
  - Visible area capture
  - Area selection capture
  - Full-page scrolling capture (auto-stitching for long pages)

- **12 Annotation Tools**
  - Rectangle / Rounded rectangle / Ellipse
  - Triangle / Star / Arrow / Line
  - Freehand pen / Text
  - Mosaic / Gaussian blur
  - Fill/stroke toggle

- **Layer Panel**
  - Visual list of all annotations
  - Show/hide toggle
  - Click to select, delete individual items

- **Image Editing**
  - Crop before editing
  - 50-step undo/redo history
  - Auto-save drafts (30s interval, 7-day retention)

- **UI/UX**
  - Bilingual (English/Chinese)
  - Dual themes (GitHub Dark/Light)
  - Keyboard shortcuts for all tools

## Recent Updates (v1.5.0)

- New **Area Scroll Capture** flow (auto scrolling + bottom completion capture)
- Crop upgraded to **default full-image box + 8 handles** (4 corners + 4 edges)
- Crop coordinate/scale fixes for zoomed or large images
- Zoom controls moved to status bar for cleaner editing space
- Text interaction updated: **single click to drag/select, double click to edit**
- Unified quick capture shortcuts: **Win `Alt+Shift+S` / Mac `⌘+Shift+S`**
- Packaging cleanup for store submission (removed debug logs and temp artifacts)

## Installation

### Developer Mode

1. Open Chrome Extensions: `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `zdfshot` folder

### From Chrome Web Store

*Coming soon*

## Usage

### Global Shortcut

| Shortcut | Action |
|----------|--------|
| Win: `Alt + Shift + S` | Quick screenshot |
| Mac: `⌘ + Shift + S` | Quick screenshot |

### Tool Shortcuts

| Key | Tool |
|-----|------|
| V | Select |
| R | Rectangle |
| U | Rounded Rect |
| E | Ellipse |
| G | Triangle |
| S | Star |
| A | Arrow |
| L | Line |
| P | Pen |
| T | Text |
| M | Mosaic |
| B | Blur |
| Delete | Delete selected |

### Action Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + S | Save image |
| ESC | Cancel current operation |

## Project Structure

```
zdfshot/
├── manifest.json          # Extension manifest
├── background.js          # Service worker
├── popup.{html,js}        # Popup UI
├── content.{js,css}       # Content script (selection overlay, full-page capture)
├── editor.{html,css,js}   # Annotation editor
├── i18n.js                # Internationalization
└── icons/                 # Extension icons
```

## Tech Stack

- **Manifest V3** — Latest Chrome extension API
- **Canvas API** — Image manipulation & annotations
- **CSS Variables** — Dynamic theming
- **chrome.storage** — Draft persistence

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome | ✅ 88+ |
| Edge | ✅ 88+ |
| Opera | ✅ 74+ |
| Firefox | ❌ (Manifest V2 only) |

## Contributing

Issues and PRs welcome.

## Privacy Policy

- https://github.com/zhaodengfeng/zdfshot/blob/main/PRIVACY.md

## License

[GPL-3.0](LICENSE)
