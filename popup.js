function showPopupError(message) {
  // Avoid injecting HTML (message may contain characters like < or > from error strings)
  document.body.textContent = "";
  const div = document.createElement("div");
  div.style.padding = "10px";
  div.style.color = "#d32f2f";
  div.style.fontFamily = "system-ui";
  div.style.fontSize = "13px";
  div.style.lineHeight = "1.4";
  div.textContent = String(message ?? "");
  document.body.appendChild(div);
}

function isRestrictedUrl(url) {
  if (!url || typeof url !== "string") return true;
  const lower = url.toLowerCase();

  // Internal / privileged pages
  if (
    lower.startsWith("chrome://") ||
    lower.startsWith("edge://") ||
    lower.startsWith("about:") ||
    lower.startsWith("chrome-extension://")
  ) {
    return true;
  }

  // Web Store pages are not scriptable
  if (
    lower.startsWith("https://chrome.google.com/webstore") ||
    lower.startsWith("https://chromewebstore.google.com/") ||
    lower.startsWith("https://microsoftedge.microsoft.com/addons")
  ) {
    return true;
  }

  return false;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "sendMessage failed"));
        return;
      }
      resolve(response);
    });
  });
}

async function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["contentScript.js"],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              chrome.runtime.lastError.message || "Content script injection failed"
            )
          );
          return;
        }
        resolve();
      }
    );
  });
}

async function waitForContentScript(tabId, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await sendMessageToTab(tabId, { type: "PING" });
      return;
    } catch {
      // Not ready yet
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  throw new Error("Content script did not respond in time");
}

async function sendMessageToActiveTab(message) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) return;

    if (isRestrictedUrl(activeTab.url)) {
      showPopupError(
        "Cannot screenshot this page (browser-internal / store / restricted page). Please try on a regular website."
      );
      return;
    }

    // Try sending first (in case the script is already injected)
    try {
      await sendMessageToTab(activeTab.id, message);
      window.close();
      return;
    } catch (err) {
      console.warn("Message failed, trying injection:", err?.message || err);
    }

    // Inject and wait for handshake
    await injectContentScript(activeTab.id);
    await waitForContentScript(activeTab.id);

    // Send the real message
    await sendMessageToTab(activeTab.id, message);
    window.close();
  } catch (e) {
    console.error(e);
    showPopupError("Unexpected error. Please refresh the page and try again.");
  }
}

document.getElementById("elementCapture").addEventListener("click", () => {
  void sendMessageToActiveTab({ type: "startElementCapture" });
});

document.getElementById("areaCapture").addEventListener("click", () => {
  void sendMessageToActiveTab({ type: "startAreaCapture" });
});

document.getElementById("fullPage").addEventListener("click", () => {
  void sendMessageToActiveTab({ type: "captureFullPage" });
});
