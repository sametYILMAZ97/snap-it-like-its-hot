// background.js (MV3 service worker)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_VISIBLE_TAB") {
    const windowId = sender.tab ? sender.tab.windowId : undefined;

    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("captureVisibleTab error:", chrome.runtime.lastError);
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message || "captureVisibleTab failed",
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
