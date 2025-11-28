function sendMessageToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab) return;

    if (
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("edge://") ||
      activeTab.url.startsWith("about:")
    ) {
      document.body.innerHTML =
        '<div style="padding:10px; color:#d32f2f; font-family:system-ui; font-size:13px;">Cannot screenshot internal browser pages. Please try on a regular website.</div>';
      return;
    }

    function send(retry = true) {
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Message failed, trying injection:",
            chrome.runtime.lastError.message
          );

          if (retry) {
            // Try injecting the content script
            chrome.scripting.executeScript(
              {
                target: { tabId: activeTab.id },
                files: ["contentScript.js"],
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "Injection failed:",
                    chrome.runtime.lastError.message
                  );
                  document.body.innerHTML = `<div style="padding:10px; color:#d32f2f;">Error: ${chrome.runtime.lastError.message}</div>`;
                } else {
                  // Retry sending message once
                  send(false);
                }
              }
            );
          } else {
            // Failed after retry
            console.error("Failed to send message even after injection.");
          }
        } else {
          // Success
          window.close();
        }
      });
    }

    send();
  });
}

document.getElementById("elementCapture").addEventListener("click", () => {
  sendMessageToActiveTab({ type: "startElementCapture" });
});

document.getElementById("areaCapture").addEventListener("click", () => {
  sendMessageToActiveTab({ type: "startAreaCapture" });
});

document.getElementById("fullPage").addEventListener("click", () => {
  sendMessageToActiveTab({ type: "captureFullPage" });
});
