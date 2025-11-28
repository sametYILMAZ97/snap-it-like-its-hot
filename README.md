# snap-it-like-its-hot

A powerful, Vivaldi-inspired screenshot extension for Google Chrome and Chromium-based browsers.

## Features

- **Capture Element:** Automatically detects and highlights page elements (divs, images, buttons) for precise capture. Includes keyboard navigation (Up/Down arrows) to select parent or child elements.
- **Capture Area:** Drag-and-drop to select a custom rectangular area on the screen.
- **Capture Full Page:** Automatically scrolls through the entire page and stitches it into a single high-quality image.
- **Floating Toolbar:** A modern, non-intrusive toolbar appears after capture with a thumbnail preview.
- **Smart Actions:**
  - **Copy:** One-click copy to clipboard (supports auto-copy).
  - **Save:** Downloads the screenshot as a PNG with a timestamped filename.
  - **Timer:** Auto-closes the toolbar after 10 seconds of inactivity.
- **Clean Capture:** Automatically hides scrollbars and extension UI elements before taking the screenshot to ensure a clean look.

## Installation

1.  Open Chrome and go to `chrome://extensions`.
2.  Enable **Developer mode** (toggle in the top right).
3.  Click **Load unpacked**.
4.  Select the `smart-screenshot` folder.

## Usage

1.  Click the extension icon in the toolbar.
2.  Select a mode:
    - **Capture Area:** Click and drag.
    - **Capture Element:** Hover over elements. Use `Arrow Up` to select parent, `Arrow Down` to select child. Click to capture.
    - **Capture Full Page:** Click and wait for the scrolling to finish.
3.  Use the floating toolbar to **Copy** or **Save** your screenshot.

## Permissions

- `activeTab`: To capture the current tab.
- `scripting`: To inject the capture logic.
- `downloads`: To save the screenshot to your disk.
- `clipboardWrite`: To copy the image to clipboard.

## License

MIT
