// background.js (MV3 service worker)

// Rate limiting for captureVisibleTab (Chrome allows ~2 calls per second)
let lastCaptureTime = 0;
const MIN_CAPTURE_INTERVAL = 600; // milliseconds between captures

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_VISIBLE_TAB") {
    // Ensure we have a valid tab context
    if (!sender.tab || !sender.tab.id) {
      console.error("captureVisibleTab error: No valid tab context");
      sendResponse({
        ok: false,
        error: "No valid tab context for capture",
      });
      return true;
    }

    const windowId = sender.tab.windowId;
    const tabId = sender.tab.id;

    // Rate limiting: ensure minimum interval between captures
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    const waitTime = Math.max(0, MIN_CAPTURE_INTERVAL - timeSinceLastCapture);

    setTimeout(() => {
      lastCaptureTime = Date.now();

      // First, ensure the tab is active and focused
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || "Failed to activate tab";
          console.error("Tab activation error:", errorMsg);
          sendResponse({
            ok: false,
            error: errorMsg,
          });
          return;
        }

        // Small delay to ensure tab is fully focused and permissions are active
        setTimeout(() => {
          chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || "captureVisibleTab failed";
              console.error("captureVisibleTab error:", errorMsg);
              sendResponse({
                ok: false,
                error: errorMsg,
              });
              return;
            }
            if (!dataUrl) {
              sendResponse({
                ok: false,
                error: "Empty dataUrl from captureVisibleTab",
              });
              return;
            }
            sendResponse({ ok: true, dataUrl });
          });
        }, 100);
      });
    }, waitTime);

    // keep the message channel open for async response
    return true;
  }

  if (message.type === "DOWNLOAD") {
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
    return true;
  }
});
