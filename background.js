// background.js (MV3 service worker)
// Chrome Extension API globals are provided by the browser runtime

/**
 * @typedef {Object} CaptureMessage
 * @property {string} type - Message type
 * @property {string} [dataUrl] - Data URL for download
 * @property {string} [filename] - Filename for download
 */

/**
 * @typedef {Object} Response
 * @property {boolean} ok - Success status
 * @property {string} [error] - Error message
 * @property {string} [dataUrl] - Captured image data URL
 * @property {number} [downloadId] - Download ID
 */

/**
 * @typedef {Object} MessageSender
 * @property {Object} [tab] - Tab information
 * @property {number} [tab.id] - Tab ID
 * @property {number} [tab.windowId] - Window ID
 */

// Rate limiting for captureVisibleTab (Chrome allows ~2 calls per second)
// Use a serialized queue to avoid overlapping calls and quota errors.
const MIN_CAPTURE_INTERVAL = 600; // ms between captures
let _captureQueue = Promise.resolve();
let _nextCaptureAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs capture tasks in series and enforces a minimum delay between them.
 * Ensures that failures don't break the queue.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueueCapture(task) {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, _nextCaptureAt - now);
    if (waitMs) await sleep(waitMs);
    // Reserve the next slot before running, so rapid enqueues still serialize properly.
    _nextCaptureAt = Date.now() + MIN_CAPTURE_INTERVAL;
    return task();
  };

  // Chain on both resolve/reject to keep queue alive.
  _captureQueue = _captureQueue.then(run, run);
  return _captureQueue;
}

/**
 * Handles tab activation and ensures it's focused
 * @param {number} tabId - Tab ID
 * @param {function(string|null): void} callback - Callback function with error parameter
 */
function activateTab(tabId, callback) {
  chrome.tabs.update(tabId, { active: true }, (_tab) => {
    if (chrome.runtime.lastError) {
      const errorMsg = chrome.runtime.lastError.message || "Failed to activate tab";
      console.error("Tab activation error:", errorMsg);
      callback(errorMsg);
      return;
    }
    callback(null);
  });
}

/**
 * Captures visible tab after ensuring proper focus
 * @param {number} windowId - Window ID
 * @param {function(string|null, string|null): void} callback - Callback with error and dataUrl parameters
 */
function captureTab(windowId, callback) {
  chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      const errorMsg = chrome.runtime.lastError.message || "captureVisibleTab failed";
      console.error("captureVisibleTab error:", errorMsg);
      callback(errorMsg, null);
      return;
    }
    if (!dataUrl) {
      callback("Empty dataUrl from captureVisibleTab", null);
      return;
    }
    callback(null, dataUrl);
  });
}

/**
 * Handles CAPTURE_VISIBLE_TAB message
 * @param {MessageSender} sender - Message sender
 * @param {function(Response): void} sendResponse - Response callback
 */
function handleCaptureVisibleTab(sender, sendResponse) {
  // Ensure we have a valid tab context
  if (!sender.tab || !sender.tab.id) {
    console.error("captureVisibleTab error: No valid tab context");
    sendResponse({
      ok: false,
      error: "No valid tab context for capture",
    });
    return;
  }

  const windowId = sender.tab.windowId;
  const tabId = sender.tab.id;

  enqueueCapture(async () => {
    const activationError = await new Promise((resolve) =>
      activateTab(tabId, resolve)
    );
    if (activationError) {
      sendResponse({ ok: false, error: activationError });
      return;
    }

    // Small delay to ensure tab is fully focused and permissions are active
    await sleep(120);

    const result = await new Promise((resolve) =>
      captureTab(windowId, (err, dataUrl) => resolve({ err, dataUrl }))
    );

    if (result.err) {
      sendResponse({ ok: false, error: result.err });
      return;
    }

    sendResponse({ ok: true, dataUrl: result.dataUrl });
  }).catch((err) => {
    console.error("Unexpected capture queue error:", err);
    sendResponse({ ok: false, error: "Unexpected capture failure" });
  });
}

/**
 * Handles DOWNLOAD message
 * @param {CaptureMessage} message - Message data
 * @param {function(Response): void} sendResponse - Response callback
 */
function handleDownload(message, sendResponse) {
  if (!message || typeof message.dataUrl !== "string") {
    sendResponse({ ok: false, error: "Invalid download request" });
    return;
  }
  // Only allow downloading data URLs produced by this extension.
  if (!message.dataUrl.startsWith("data:image/")) {
    sendResponse({ ok: false, error: "Refusing to download non-image URL" });
    return;
  }

  chrome.downloads.download(
    {
      url: message.dataUrl,
      filename: message.filename,
      saveAs: false, // Set to true if you want "Save As" dialog every time
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    }
  );
}

/**
 * Message listener for chrome runtime messages
 * @param {CaptureMessage} message - Message from content script
 * @param {MessageSender} sender - Message sender
 * @param {function(Response): void} sendResponse - Response callback
 * @returns {boolean} - True to keep message channel open
 * @suppress {deprecated} addListener is the correct API for Manifest V3
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Basic hardening: only accept messages from this extension.
  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    handleCaptureVisibleTab(sender, sendResponse);
    return true; // keep the message channel open for async response
  }

  if (message.type === "DOWNLOAD") {
    handleDownload(message, sendResponse);
    return true; // keep the message channel open for async response
  }

  return false;
});
