# Privacy Policy for ZDFShot

**Effective date:** 2026-02-23

ZDFShot is a screenshot and annotation extension. We design it with a simple privacy principle:

> Your screenshot data stays local by default and is only processed when you trigger the extension.

## 1) What data is processed

- Screenshot image data from the current tab (when you capture)
- Annotation content you create (text, shapes, blur/mosaic)
- Temporary extension state/settings stored locally

## 2) Why this data is processed

- To provide screenshot capture and editing features
- To support copy-to-clipboard and local download
- To restore temporary editing state/drafts for usability

## 3) Storage and transmission

- Data is stored locally in your browser (e.g., `chrome.storage`)
- ZDFShot does **not** upload screenshot or annotation content to developer servers by default

## 4) Chrome permissions and purpose

- `activeTab`: capture the active tab when user requests
- `storage`: save temporary screenshot data and preferences
- `downloads`: export images to local files
- `clipboardWrite`: copy image to clipboard
- `scripting`: inject capture/edit logic into the current page

## 5) Third-party sharing

ZDFShot does not sell, rent, or share your screenshot content with third parties.

## 6) Data retention and deletion

- Most screenshot/edit data is temporary and local
- You can clear extension data anytime in browser extension settings

## 7) Contact

If you have privacy questions, please open an issue:

https://github.com/zhaodengfeng/zdfshot/issues
