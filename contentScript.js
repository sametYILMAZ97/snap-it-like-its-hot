// contentScript.js

(function () {
  if (window.hasSmartScreenshotLoaded) return;
  window.hasSmartScreenshotLoaded = true;

  // ---------- State ----------

  let pickerActive = false;
  let highlightBox = null;
  let lastTarget = null;
  let currentCandidate = null;
  let toolbar = null;
  let currentDataUrl = null;
  let infoOverlay = null;
  let loadingOverlay = null;
  let elementInfoBox = null;

  // ---------- Styles ----------

  const THEME = {
    bg: "#1a1b1e",
    surface: "#25262b",
    text: "#e9ecef",
    primary: "#4dabf7",
    success: "#69db7c",
    danger: "#ff6b6b",
    shadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
  };

  // ---------- AREA PICKER State ----------

  let areaActive = false;
  let areaOverlay = null;
  let areaSelectionBox = null;
  let startX = 0;
  let startY = 0;
  let isDragging = false;

  const Z_INDEX_BASE = 2147483640;
  const UI_ATTR_NAME = "data-smart-screenshot-ui";
  const UI_ATTR_VALUE = "1";

  // ---------- Utils ----------

  function markAsUi(el) {
    if (!el) return;
    el.setAttribute(UI_ATTR_NAME, UI_ATTR_VALUE);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForFrame() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }

  function ensureStyles() {
    if (document.getElementById("smart-screenshot-styles")) return;
    const style = document.createElement("style");
    style.id = "smart-screenshot-styles";
    style.textContent = `
      @keyframes smartScreenshotSpin { to { transform: rotate(360deg); } }
      @keyframes smartScreenshotTimer { from { width: 100%; } to { width: 0%; } }
    `;
    document.head.appendChild(style);
  }

  function findAndHideStickyElements(excludeElement = null) {
    /** @type {Array<{ element: Element, prev: Record<string, { value: string, priority: string }> }>} */
    const hidden = [];

    // Only consider overlays that can actually affect a screenshot: fixed/sticky AND intersect viewport.
    const all = document.body ? document.body.getElementsByTagName("*") : document.getElementsByTagName("*");
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const el of all) {
      // Skip the element we want to capture (and its subtree)
      if (excludeElement && (el === excludeElement || excludeElement.contains(el))) {
        continue;
      }

      // Never hide our own UI (toolbars/overlays), even though they are fixed-position.
      if (el.getAttribute && el.getAttribute(UI_ATTR_NAME) === UI_ATTR_VALUE) {
        continue;
      }

      if (!(el instanceof Element)) continue;

      const style = window.getComputedStyle(el);
      const position = style.position;
      if (position !== "sticky" && position !== "fixed") continue;

      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue;

      const prev = {
        visibility: {
          value: el.style.getPropertyValue("visibility"),
          priority: el.style.getPropertyPriority("visibility"),
        },
        opacity: {
          value: el.style.getPropertyValue("opacity"),
          priority: el.style.getPropertyPriority("opacity"),
        },
        pointerEvents: {
          value: el.style.getPropertyValue("pointer-events"),
          priority: el.style.getPropertyPriority("pointer-events"),
        },
      };

      // Hide without layout reflow.
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("pointer-events", "none", "important");

      hidden.push({ element: el, prev });
    }

    return hidden;
  }

  function restoreStickyElements(hidden) {
    for (const { element, prev } of hidden) {
      for (const [prop, saved] of Object.entries(prev)) {
        if (!saved.value) {
          element.style.removeProperty(prop);
        } else {
          element.style.setProperty(prop, saved.value, saved.priority);
        }
      }
    }
  }

  function makeElementNonSticky(el) {
    const originalPosition = el.style.position;
    const originalTop = el.style.top;
    const originalLeft = el.style.left;
    const originalRight = el.style.right;
    const originalBottom = el.style.bottom;
    const originalZIndex = el.style.zIndex;
    
    el.style.position = "relative";
    el.style.top = "auto";
    el.style.left = "auto";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.zIndex = "auto";
    
    return {
      element: el,
      originalPosition,
      originalTop,
      originalLeft,
      originalRight,
      originalBottom,
      originalZIndex,
    };
  }

  function restoreElementPositioning(positionState) {
    const { element, originalPosition, originalTop, originalLeft, originalRight, originalBottom, originalZIndex } = positionState;
    element.style.position = originalPosition;
    element.style.top = originalTop;
    element.style.left = originalLeft;
    element.style.right = originalRight;
    element.style.bottom = originalBottom;
    element.style.zIndex = originalZIndex;
  }

  // ---------- Toast Notification System ----------

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    markAsUi(toast);

    // Styles
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "30px",
      left: "50%",
      transform: "translateX(-50%) translateY(20px)",
      background: type === "error" ? THEME.danger : THEME.surface,
      color: "#fff",
      padding: "12px 24px",
      borderRadius: "8px",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      boxShadow: THEME.shadow,
      zIndex: String(Z_INDEX_BASE + 10),
      opacity: "0",
      transition: "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      pointerEvents: "none",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    const span = document.createElement("span");
    span.textContent = String(message ?? "");
    toast.appendChild(span);
    document.body.appendChild(toast);

    // Animate In
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });

    // Animate Out & Remove
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---------- UI Hiding Helpers ----------

  let scrollBarStyleElement = null;

  function hideScrollbars() {
    if (scrollBarStyleElement) return;
    scrollBarStyleElement = document.createElement("style");
    scrollBarStyleElement.innerHTML =
      "body::-webkit-scrollbar { display: none; } body { -ms-overflow-style: none; scrollbar-width: none; }";
    document.head.appendChild(scrollBarStyleElement);
  }

  function showScrollbars() {
    if (scrollBarStyleElement) {
      scrollBarStyleElement.remove();
      scrollBarStyleElement = null;
    }
  }

  function getUiElements() {
    return Array.from(
      document.querySelectorAll(`[${UI_ATTR_NAME}="${UI_ATTR_VALUE}"]`)
    );
  }

  function hideUi(uiElements) {
    uiElements.forEach((el) => {
      if (!el._prevDisplay) {
        el._prevDisplay = el.style.display || "";
      }
      el.style.display = "none";
    });
  }

  function showUi(uiElements) {
    uiElements.forEach((el) => {
      if (el._prevDisplay !== undefined) {
        el.style.display = el._prevDisplay;
        delete el._prevDisplay;
      } else {
        el.style.display = "";
      }
    });
  }

  async function captureCleanShot() {
    const uiElements = getUiElements();
    hideUi(uiElements);
    hideScrollbars();
    await waitForFrame();

    try {
      return await captureVisibleTabImage();
    } finally {
      showScrollbars();
      showUi(uiElements);
    }
  }

  function captureVisibleTabImage() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: "CAPTURE_VISIBLE_TAB" },
          (response) => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || "Unknown capture error";
              console.error("Capture error:", errorMsg);
              reject(new Error(errorMsg));
              return;
            }
            if (!response || !response.ok || !response.dataUrl) {
              const errorMsg = response?.error || "captureVisibleTab failed";
              console.error("Capture failed:", errorMsg);
              reject(new Error(errorMsg));
              return;
            }
            resolve(response.dataUrl);
          }
        );
      } catch (e) {
        console.error("Exception during capture:", e);
        reject(e);
      }
    });
  }

  // ---------- INFO + LOADING OVERLAYS ----------

  function showInfoOverlay(text) {
    if (infoOverlay) {
      if (text) infoOverlay.querySelector("span").textContent = text;
      return;
    }

    infoOverlay = document.createElement("div");
    markAsUi(infoOverlay);

    Object.assign(infoOverlay.style, {
      position: "fixed",
      top: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "10px 20px",
      background: "rgba(26, 27, 30, 0.9)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      color: "#fff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "13px",
      fontWeight: "500",
      borderRadius: "8px",
      zIndex: String(Z_INDEX_BASE + 1),
      pointerEvents: "none",
      transition: "opacity 0.2s",
      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    });

    const msg = text || "Smart Screenshot active. Press Esc to cancel.";
    const span = document.createElement("span");
    span.textContent = msg;
    infoOverlay.appendChild(span);
    document.body.appendChild(infoOverlay);
  }

  function hideInfoOverlay() {
    if (infoOverlay) {
      infoOverlay.style.opacity = "0";
      setTimeout(() => {
        if (infoOverlay) infoOverlay.remove();
        infoOverlay = null;
      }, 200);
    }
  }

  function showLoadingOverlay(text) {
    ensureStyles();
    if (loadingOverlay) {
      const span = loadingOverlay.querySelector("span");
      if (span) span.textContent = text;
      return;
    }

    loadingOverlay = document.createElement("div");
    markAsUi(loadingOverlay);

    Object.assign(loadingOverlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0, 0, 0, 0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: String(Z_INDEX_BASE + 2),
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s",
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: THEME.surface,
      color: "#fff",
      padding: "16px 24px",
      borderRadius: "12px",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      boxShadow: THEME.shadow,
      display: "flex",
      alignItems: "center",
      gap: "12px",
    });

    // Simple CSS Spinner
    const spinner = document.createElement("div");
    spinner.style.width = "16px";
    spinner.style.height = "16px";
    spinner.style.border = "2px solid #555";
    spinner.style.borderTopColor = "#fff";
    spinner.style.borderRadius = "50%";
    spinner.style.animation = "smartScreenshotSpin 1s linear infinite";

    const span = document.createElement("span");
    span.textContent = text;

    box.appendChild(spinner);
    box.appendChild(span);
    loadingOverlay.appendChild(box);
    document.body.appendChild(loadingOverlay);

    requestAnimationFrame(() => (loadingOverlay.style.opacity = "1"));
  }

  function hideLoadingOverlay() {
    if (loadingOverlay) {
      loadingOverlay.style.opacity = "0";
      setTimeout(() => {
        if (loadingOverlay) loadingOverlay.remove();
        loadingOverlay = null;
      }, 200);
    }
  }

  // ---------- TOOLBAR / RESULT UI ----------

  function removeToolbarUi() {
    if (toolbar) {
      toolbar.style.opacity = "0";
      toolbar.style.transform = "translate(-50%, 10px)";
      setTimeout(() => {
        if (toolbar) toolbar.remove();
        toolbar = null;
      }, 200);
    }
  }

  function closeSession() {
    removeToolbarUi();
    currentDataUrl = null;
  }

  async function copyDataUrlToClipboard(dataUrl) {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }

  function createBtn(text, iconSvg, onClick, variant = "secondary") {
    const btn = document.createElement("button");

    const bg =
      variant === "primary"
        ? THEME.primary
        : variant === "success"
        ? THEME.success
        : "rgba(255, 255, 255, 0.1)";

    Object.assign(btn.style, {
      background: bg,
      color: "#fff",
      border: "1px solid rgba(255, 255, 255, 0.05)",
      padding: "8px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "13px",
      fontWeight: "600",
      fontFamily: "system-ui, -apple-system, sans-serif",
      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      position: "relative",
      zIndex: "2", // above timer bar
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    });

    btn.onmouseover = () => {
      btn.style.transform = "translateY(-1px)";
      btn.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)";
      btn.style.filter = "brightness(1.1)";
    };
    btn.onmouseout = () => {
      btn.style.transform = "translateY(0)";
      btn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
      btn.style.filter = "brightness(1)";
    };
    btn.onmousedown = () => (btn.style.transform = "translateY(0) scale(0.98)");
    btn.onmouseup = () => (btn.style.transform = "translateY(-1px)");

    if (iconSvg) {
      const icon = document.createElement("div");
      icon.innerHTML = iconSvg;
      Object.assign(icon.style, {
        width: "16px",
        height: "16px",
        fill: "currentColor",
        display: "flex",
      });
      btn.appendChild(icon);
    }

    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      btn.appendChild(span);
    }

    btn.onclick = onClick;
    return btn;
  }

  function showToolbar() {
    ensureStyles();
    if (toolbar) toolbar.remove();

    toolbar = document.createElement("div");
    markAsUi(toolbar);

    Object.assign(toolbar.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translate(-50%, -20px)",
      zIndex: String(Z_INDEX_BASE + 3),
      background: THEME.surface,
      padding: "12px",
      borderRadius: "12px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      boxShadow: THEME.shadow,
      opacity: "0",
      overflow: "hidden", // Clip progress bar
      transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
    });

    // Label (Preview thumbnail?)
    const preview = document.createElement("div");
    Object.assign(preview.style, {
      width: "40px",
      height: "40px",
      background: `url(${currentDataUrl}) center/cover no-repeat`,
      borderRadius: "6px",
      border: "1px solid #555",
      flexShrink: "0",
    });
    toolbar.appendChild(preview);

    // Actions
    const copyIcon = `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    const downloadIcon = `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

    // Copy Button
    const copyBtn = createBtn(
      "Copy",
      copyIcon,
      async () => {
        if (!navigator.clipboard) {
          showToast(
            "Clipboard not supported on this page (try HTTPS)",
            "error"
          );
          return;
        }
        const originalText = copyBtn.querySelector("span").textContent;
        copyBtn.querySelector("span").textContent = "Copying...";

        const ok = await copyDataUrlToClipboard(currentDataUrl);
        if (ok) {
          showToast("Screenshot copied to clipboard!");
          copyBtn.querySelector("span").textContent = "Copied!";
          setTimeout(
            () => (copyBtn.querySelector("span").textContent = originalText),
            2000
          );
        } else {
          showToast("Failed to copy image", "error");
          copyBtn.querySelector("span").textContent = originalText;
        }
      },
      "primary"
    );

    // Download Button
    const downloadBtn = createBtn(
      "Save",
      downloadIcon,
      () => {
        downloadBtn.querySelector("span").textContent = "Saving...";
        const filename = `screenshot_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.png`;

        chrome.runtime.sendMessage(
          {
            type: "DOWNLOAD",
            dataUrl: currentDataUrl,
            filename: filename,
          },
          (res) => {
            if (chrome.runtime.lastError || (res && !res.ok)) {
              showToast("Download failed. Check console.", "error");
            } else {
              showToast("Download started");
            }
            downloadBtn.querySelector("span").textContent = "Save";
          }
        );
      },
      "success"
    );

    // Close Button (Icon only)
    const closeBtn = createBtn("", closeIcon, closeSession);
    closeBtn.style.padding = "8px"; // square it up

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(downloadBtn);

    const sep = document.createElement("div");
    sep.style.width = "1px";
    sep.style.height = "24px";
    sep.style.background = "rgba(255, 255, 255, 0.1)";
    sep.style.margin = "0 4px";
    toolbar.appendChild(sep);

    toolbar.appendChild(closeBtn);

    // Timer Progress Bar
    const timerBar = document.createElement("div");
    Object.assign(timerBar.style, {
      position: "absolute",
      bottom: "0",
      left: "0",
      height: "3px",
      background: THEME.primary,
      width: "100%",
      animation: "smartScreenshotTimer 10s linear forwards",
      borderRadius: "0 0 16px 16px",
    });

    toolbar.appendChild(timerBar);

    // Timer logic
    timerBar.onanimationend = () => closeSession();

    toolbar.onmouseenter = () => {
      timerBar.style.animationPlayState = "paused";
      timerBar.style.opacity = "0.5";
    };
    toolbar.onmouseleave = () => {
      timerBar.style.animationPlayState = "running";
      timerBar.style.opacity = "1";
    };

    document.body.appendChild(toolbar);

    // Animate In
    requestAnimationFrame(() => {
      toolbar.style.opacity = "1";
      toolbar.style.transform = "translate(-50%, 0)";
    });

    // Auto-copy attempt
    copyDataUrlToClipboard(currentDataUrl).then((ok) => {
      if (ok) showToast("Copied to clipboard!");
    });
  }

  function handleCanvasResult(canvas) {
    try {
      currentDataUrl = canvas.toDataURL("image/png");
      showToolbar();
    } catch (e) {
      showToast("Failed to process screenshot", "error");
      console.error(e);
    }
  }

  // ---------- ELEMENT INFO BUBBLE ----------

  function ensureElementInfoBox() {
    if (elementInfoBox) return;
    elementInfoBox = document.createElement("div");
    markAsUi(elementInfoBox);

    Object.assign(elementInfoBox.style, {
      position: "absolute",
      padding: "6px 10px",
      borderRadius: "6px",
      background: THEME.primary,
      color: "#fff",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "12px",
      fontWeight: "500",
      pointerEvents: "none",
      zIndex: String(Z_INDEX_BASE + 1),
      maxWidth: "240px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      boxShadow: "0 4px 8px rgba(0,0,0,0.2)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
    });

    document.body.appendChild(elementInfoBox);
  }

  function updateElementInfoBox(rect, el) {
    ensureElementInfoBox();

    const tagName = el.tagName.toLowerCase();
    const id = el.id ? "#" + el.id : "";
    const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

    elementInfoBox.textContent = "";
    const strong = document.createElement("span");
    strong.style.fontWeight = "bold";
    strong.textContent = `${tagName}${id}`;
    const details = document.createElement("span");
    details.style.opacity = "0.8";
    details.textContent = ` | ${size}`;
    elementInfoBox.appendChild(strong);
    elementInfoBox.appendChild(details);

    const top = window.scrollY + rect.top - 28;
    const left = window.scrollX + rect.left;

    elementInfoBox.style.top = `${Math.max(top, window.scrollY + 4)}px`;
    elementInfoBox.style.left = `${Math.max(left, window.scrollX + 4)}px`;
    elementInfoBox.style.display = "block";
  }

  function hideElementInfoBox() {
    if (elementInfoBox) elementInfoBox.style.display = "none";
  }

  // ---------- ELEMENT PICKER ----------

  function isRelevantElement(el) {
    if (!el || !el.getBoundingClientRect) return false;

    // Ignore our own UI
    if (el.getAttribute && el.getAttribute(UI_ATTR_NAME) === UI_ATTR_VALUE)
      return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= 5 && rect.height >= 5;
  }

  function pickBestTarget(el) {
    // If the element itself is relevant and "leaf-like" (has text or is image), prefer it.
    // Otherwise, if it's a generic wrapper, we might want to look slightly deeper OR
    // if the user is hovering a specific small part, keep it.

    // For now, the standard elementFromPoint is usually what the user expects visually.
    // We just need to filter out full-screen overlays or transparent wrappers that
    // block the actual content.

    let current = el;
    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (isRelevantElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return el; // fallback
  }

  function startElementPicker() {
    if (pickerActive) return;
    pickerActive = true;
    lastTarget = null;
    currentCandidate = null;
    showInfoOverlay(
      "Hover to select. Click to capture. Use Arrow Keys \u2191\u2193 to adjust."
    );

    document.body.style.cursor = "crosshair";

    if (!highlightBox) {
      highlightBox = document.createElement("div");
      markAsUi(highlightBox);
      Object.assign(highlightBox.style, {
        position: "absolute",
        border: `2px solid ${THEME.primary}`,
        background: "rgba(74, 144, 226, 0.1)",
        pointerEvents: "none",
        zIndex: String(Z_INDEX_BASE),
        transition: "all 0.1s ease-out",
      });
      document.body.appendChild(highlightBox);
    }

    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeyDown, true);
  }

  function stopElementPicker() {
    pickerActive = false;
    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeyDown, true);

    if (highlightBox) {
      highlightBox.remove();
      highlightBox = null;
    }
    hideElementInfoBox();
    document.body.style.cursor = "";
    hideInfoOverlay();
  }

  function updateHighlight(el) {
    if (!el) return;
    currentCandidate = el;
    const rect = el.getBoundingClientRect();

    if (highlightBox) {
      highlightBox.style.top = `${window.scrollY + rect.top}px`;
      highlightBox.style.left = `${window.scrollX + rect.left}px`;
      highlightBox.style.width = `${rect.width}px`;
      highlightBox.style.height = `${rect.height}px`;
    }
    updateElementInfoBox(rect, el);
  }

  function onPickerMouseMove(e) {
    if (!pickerActive) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    // Ignore our own UI
    let p = el;
    while (p) {
      if (p.getAttribute && p.getAttribute(UI_ATTR_NAME) === UI_ATTR_VALUE)
        return;
      p = p.parentElement;
    }

    lastTarget = el;
    const candidate = pickBestTarget(el);
    updateHighlight(candidate);
  }

  function onPickerClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();

    // Use currentCandidate which might have been adjusted by arrow keys
    const target = currentCandidate || lastTarget;
    stopElementPicker();
    if (target) captureElement(target).catch(console.error);
  }

  function onPickerKeyDown(e) {
    if (!pickerActive) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopElementPicker();
      return;
    }

    // Enter key takes the screenshot
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const target = currentCandidate || lastTarget;
      stopElementPicker();
      if (target) captureElement(target).catch(console.error);
      return;
    }

    // Allow manual adjustment of selection
    if (currentCandidate) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (
          currentCandidate.parentElement &&
          currentCandidate.parentElement !== document.body
        ) {
          updateHighlight(currentCandidate.parentElement);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        // Try to find a child. This is tricky as there can be many.
        // We'll pick the first relevant child.
        for (let child of currentCandidate.children) {
          if (isRelevantElement(child)) {
            updateHighlight(child);
            break;
          }
        }
      }
    }
  }

  function startAreaPicker() {
    if (areaActive) return;
    if (pickerActive) stopElementPicker();

    areaActive = true;
    showInfoOverlay("Click and drag to select an area.");

    document.body.style.cursor = "crosshair";

    areaOverlay = document.createElement("div");
    markAsUi(areaOverlay);
    Object.assign(areaOverlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      zIndex: String(Z_INDEX_BASE),
      cursor: "crosshair",
      background: "rgba(0, 0, 0, 0.05)",
    });

    areaSelectionBox = document.createElement("div");
    markAsUi(areaSelectionBox);
    Object.assign(areaSelectionBox.style, {
      position: "fixed",
      border: "2px dashed #fff",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
      display: "none",
      zIndex: String(Z_INDEX_BASE + 1),
      pointerEvents: "none",
    });

    areaOverlay.appendChild(areaSelectionBox);
    document.body.appendChild(areaOverlay);

    document.addEventListener("mousedown", onAreaMouseDown, true);
    document.addEventListener("mousemove", onAreaMouseMove, true);
    document.addEventListener("mouseup", onAreaMouseUp, true);
    document.addEventListener("keydown", onAreaKeyDown, true);
  }

  function stopAreaPicker() {
    areaActive = false;
    isDragging = false;

    document.removeEventListener("mousedown", onAreaMouseDown, true);
    document.removeEventListener("mousemove", onAreaMouseMove, true);
    document.removeEventListener("mouseup", onAreaMouseUp, true);
    document.removeEventListener("keydown", onAreaKeyDown, true);

    if (areaOverlay) {
      areaOverlay.remove();
      areaOverlay = null;
      areaSelectionBox = null;
    }

    document.body.style.cursor = "";
    hideInfoOverlay();
  }

  function onAreaMouseDown(e) {
    if (!areaActive) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;

    if (areaSelectionBox) {
      areaSelectionBox.style.left = `${startX}px`;
      areaSelectionBox.style.top = `${startY}px`;
      areaSelectionBox.style.width = "0px";
      areaSelectionBox.style.height = "0px";
      areaSelectionBox.style.display = "block";
    }
  }

  function onAreaMouseMove(e) {
    if (!areaActive || !isDragging || !areaSelectionBox) return;
    e.preventDefault();
    e.stopPropagation();

    const currentX = e.clientX;
    const currentY = e.clientY;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    areaSelectionBox.style.left = `${left}px`;
    areaSelectionBox.style.top = `${top}px`;
    areaSelectionBox.style.width = `${width}px`;
    areaSelectionBox.style.height = `${height}px`;
  }

  async function onAreaMouseUp(e) {
    if (!areaActive || !isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;

    const rect = areaSelectionBox.getBoundingClientRect();
    stopAreaPicker();

    if (rect.width < 5 || rect.height < 5) return;
    await captureArea(rect);
  }

  function onAreaKeyDown(e) {
    if (!areaActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopAreaPicker();
    }
  }

  async function captureArea(rect) {
    showLoadingOverlay("Processing area...");
    await waitForFrame();

    try {
      const dataUrl = await captureCleanShot();
      const canvas = await cropElementFromScreenshot(dataUrl, rect);
      handleCanvasResult(canvas);
    } catch (err) {
      showToast("Area capture failed", "error");
      console.error(err);
    } finally {
      hideLoadingOverlay();
    }
  }

  function cropElementFromScreenshot(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // captureVisibleTab returns a bitmap that may not equal devicePixelRatio.
        // Compute scale from the actual capture size for accurate, crisp cropping.
        const scaleX = img.width / Math.max(1, window.innerWidth);
        const scaleY = img.height / Math.max(1, window.innerHeight);

        let sx = Math.floor(rect.left * scaleX);
        let sy = Math.floor(rect.top * scaleY);
        let sw = Math.floor(rect.width * scaleX);
        let sh = Math.floor(rect.height * scaleY);

        // Clamp to image bounds
        if (sx < 0) {
          sw += sx;
          sx = 0;
        }
        if (sy < 0) {
          sh += sy;
          sy = 0;
        }
        if (sx + sw > img.width) sw = img.width - sx;
        if (sy + sh > img.height) sh = img.height - sy;

        if (sw <= 0 || sh <= 0) {
          reject(new Error("Element is outside viewport"));
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        const sourceW = Math.min(sw, img.width - sx);
        const sourceH = Math.min(sh, img.height - sy);
        if (sourceW > 0 && sourceH > 0) {
          ctx.drawImage(img, sx, sy, sourceW, sourceH, 0, 0, sourceW, sourceH);
        }
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function captureElement(el) {
    showLoadingOverlay("Processing element...");
    await waitForFrame();

    try {
      const elementStyle = window.getComputedStyle(el);
      const isElementSticky = elementStyle.position === "sticky" || elementStyle.position === "fixed";
      
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        showToast("Element capture failed", "error");
        console.error(new Error("Element has no size"));
        return;
      }

      const viewportHeight = window.innerHeight;
      const elementHeight = rect.height;
      
      // For sticky/fixed elements, always use simple capture (no multi-capture scrolling)
      if (isElementSticky) {
        // Just scroll to it and capture once
        const dataUrl = await captureCleanShotHidingStickyElements(el);
        const canvas = await cropElementFromScreenshot(dataUrl, rect);
        handleCanvasResult(canvas);
      }
      // Check if element is larger than viewport or extends beyond viewport
      else if (elementHeight > viewportHeight || 
          rect.top < 0 || 
          rect.bottom > viewportHeight) {
        // Use multi-capture stitching for large/off-screen elements
        const canvas = await captureElementWithStitching(el);
        handleCanvasResult(canvas);
      } else {
        // Element is fully visible, use simple capture
        const dataUrl = await captureCleanShotHidingStickyElements(el);
        const canvas = await cropElementFromScreenshot(dataUrl, rect);
        handleCanvasResult(canvas);
      }
    } catch (err) {
      showToast("Element capture failed", "error");
      console.error(err);
    } finally {
      hideLoadingOverlay();
    }
  }

  async function captureCleanShotHidingStickyElements(excludeElement = null) {
    const stickyElements = findAndHideStickyElements(excludeElement);
    const uiElements = getUiElements();
    hideUi(uiElements);
    hideScrollbars();
    await waitForFrame();

    try {
      return await captureVisibleTabImage();
    } finally {
      restoreStickyElements(stickyElements);
      showScrollbars();
      showUi(uiElements);
    }
  }

  async function captureElementWithStitching(el) {
    const stickyElements = findAndHideStickyElements(el);
    const elementPositionState = makeElementNonSticky(el);
    const uiElements = getUiElements();
    hideUi(uiElements);
    hideScrollbars();
    
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    
    try {
      // Get element's absolute position and size
      const rect = el.getBoundingClientRect();
      const elementTop = window.scrollY + rect.top;
      // Avoid horizontal scrolling (can cause incorrect cropping). Keep X stable.
      const elementLeft = originalScrollX;
      const elementWidth = rect.width;
      const elementHeight = rect.height;
      
      const viewportHeight = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      
      // Calculate how many captures we need
      const overlap = 80;
      const steps = [];
      
      // Element needs multiple captures
      let y = elementTop;
      const elementBottom = elementTop + elementHeight;
      
      while (y < elementBottom - viewportHeight) {
        steps.push(y);
        y += viewportHeight - overlap;
      }
      // Add final position to capture bottom of element
      steps.push(elementBottom - viewportHeight);
      
      // Create canvas for the element
      const canvas = document.createElement("canvas");
      // Determine scale from the first capture to avoid blurry output on HiDPI.
      // We'll initialize canvas sizes after the first capture.
      let scaleX = dpr;
      let scaleY = dpr;
      canvas.width = Math.floor(elementWidth * scaleX);
      canvas.height = Math.floor(elementHeight * scaleY);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      
      for (let i = 0; i < steps.length; i++) {
        const scrollY = steps[i];
        
        showUi(uiElements);
        showLoadingOverlay(
          `Capturing element ${Math.round(((i + 1) / steps.length) * 100)}%`
        );
        
        // Scroll to position
        window.scrollTo(elementLeft, scrollY);
        await sleep(400);
        
        // Hide UI and ensure sticky/fixed overlays remain hidden before capture
        hideUi(uiElements);
        for (const { element } of stickyElements) {
          element.style.setProperty("visibility", "hidden", "important");
          element.style.setProperty("opacity", "0", "important");
          element.style.setProperty("pointer-events", "none", "important");
        }
        await waitForFrame();
        
        // Capture the visible tab
        const dataUrl = await captureVisibleTabImage();

        // On first frame, compute actual capture scale and resize canvas accordingly.
        if (i === 0) {
          const probe = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
          });
          scaleX = probe.width / Math.max(1, window.innerWidth);
          scaleY = probe.height / Math.max(1, window.innerHeight);
          const newW = Math.floor(elementWidth * scaleX);
          const newH = Math.floor(elementHeight * scaleY);
          if (canvas.width !== newW || canvas.height !== newH) {
            canvas.width = newW;
            canvas.height = newH;
          }
          ctx.imageSmoothingEnabled = false;
        }
        
        // Calculate what part of this capture contains our element
        const captureViewportTop = scrollY;

        // Element's position relative to this capture
        const elementTopInCapture = Math.max(0, elementTop - captureViewportTop);
        const elementBottomInCapture = Math.min(viewportHeight, elementTop + elementHeight - captureViewportTop);
        
        const captureHeight = elementBottomInCapture - elementTopInCapture;
        
        if (captureHeight > 0) {
          // Draw this segment onto our element canvas
          await drawElementSegment(
            dataUrl,
            ctx,
            // Use the real capture scale (not assumed DPR)
            scaleX,
            scaleY,
            rect.left,  // Element's left position in viewport
            elementTopInCapture,  // Where element starts in this capture
            elementWidth,
            captureHeight,
            0,  // Always at left edge of element canvas
            Math.floor(Math.max(0, captureViewportTop - elementTop) * scaleY)  // Destination Y in element canvas
          );
        }
        
        // Rate limiting delay
        await sleep(250);
      }
      
      // Restore scroll position
      window.scrollTo(originalScrollX, originalScrollY);
      await waitForFrame();
      
      showUi(uiElements);
      showScrollbars();
      
      return canvas;
    } catch (err) {
      // Restore scroll position on error
      window.scrollTo(originalScrollX, originalScrollY);
      showUi(uiElements);
      showScrollbars();
      throw err;
    } finally {
      restoreElementPositioning(elementPositionState);
      restoreStickyElements(stickyElements);
    }
  }
  
  function drawElementSegment(dataUrl, ctx, scaleX, scaleY, sourceX, sourceY, sourceW, sourceH, destX, destY) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.floor(sourceX * scaleX);
        const sy = Math.floor(sourceY * scaleY);
        const sw = Math.floor(sourceW * scaleX);
        const sh = Math.floor(sourceH * scaleY);
        
        // Ensure we don't draw outside image bounds
        const actualSW = Math.min(sw, img.width - sx);
        const actualSH = Math.min(sh, img.height - sy);
        
        if (actualSW > 0 && actualSH > 0) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            img,
            sx,
            sy,
            actualSW,
            actualSH,
            Math.floor(destX),
            Math.floor(destY),
            actualSW,
            actualSH
          );
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  // ---------- FULL-PAGE CAPTURE ----------

  function drawSegmentOnCanvas(dataUrl, ctx, scaleY, scrollY, canvasHeight) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sw = img.width;
        let sh = img.height;
        const destX = 0;
        const destY = Math.floor(scrollY * scaleY);

        if (destY >= canvasHeight) {
          resolve();
          return;
        }
        if (destY + sh > canvasHeight) sh = canvasHeight - destY;

        if (sh > 0) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, sw, sh, destX, destY, sw, sh);
        }
        resolve();
      };
      img.onerror = () => {
        resolve();
      };
      img.src = dataUrl;
    });
  }

  async function captureFullPage() {
    showLoadingOverlay("Preparing...");
    const uiElements = getUiElements();
    hideUi(uiElements);
    hideScrollbars();
    await waitForFrame();

    // Hide sticky/fixed overlays (headers/sidebars) so they don't repeat in the stitched output.
    // (Excluded: extension UI elements)
    const hiddenStickies = findAndHideStickyElements(null);

    try {
      const scrollElem =
        document.scrollingElement || document.documentElement || document.body;
      const totalHeight = scrollElem.scrollHeight;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const overlap = 80;
      const steps = [];

      if (totalHeight <= viewportHeight) {
        steps.push(0);
      } else {
        let y = 0;
        while (y < totalHeight - viewportHeight) {
          steps.push(y);
          y += viewportHeight - overlap;
        }
        steps.push(totalHeight - viewportHeight);
      }

      // Determine scale from the actual captured bitmap (more reliable than devicePixelRatio)
      let scaleX = window.devicePixelRatio || 1;
      let scaleY = scaleX;

      /** @type {HTMLCanvasElement|null} */
      let canvas = null;
      /** @type {CanvasRenderingContext2D|null} */
      let ctx = null;
      const originalY = window.scrollY;

      for (let i = 0; i < steps.length; i++) {
        const scrollY = steps[i];

        // Show progress in loading overlay (but keep it hidden from capture)
        showUi(uiElements);
        showLoadingOverlay(
          `Stitching ${Math.round((i / steps.length) * 100)}%`
        );

        window.scrollTo(0, scrollY);
        await sleep(400); // Increased delay for page settling

        hideUi(uiElements);
        await waitForFrame();

        const dataUrl = await captureVisibleTabImage();

        if (!canvas || !ctx) {
          // Probe capture size
          const probe = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
          });
          scaleX = probe.width / Math.max(1, viewportWidth);
          scaleY = probe.height / Math.max(1, viewportHeight);

          canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewportWidth * scaleX);
          canvas.height = Math.floor(totalHeight * scaleY);
          ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = false;
        }

        await drawSegmentOnCanvas(dataUrl, ctx, scaleY, scrollY, canvas.height);
        
        // Additional delay between captures to respect rate limits
        await sleep(250);
      }

      window.scrollTo(0, originalY);

      showUi(uiElements);
      if (canvas) {
        handleCanvasResult(canvas);
      } else {
        throw new Error("Failed to initialize capture canvas");
      }
    } catch (err) {
      showUi(uiElements);
      showToast("Full-page capture failed", "error");
      console.error(err);
    } finally {
      restoreStickyElements(hiddenStickies);
      showScrollbars();
      hideLoadingOverlay();
    }
  }

  // ---------- MESSAGE HANDLER ----------

  /**
   * @suppress {deprecated} addListener is the correct API for content scripts
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "startElementCapture") {
      startElementPicker();
      sendResponse({ status: "started" });
    } else if (message.type === "startAreaCapture") {
      startAreaPicker();
      sendResponse({ status: "started" });
    } else if (message.type === "captureFullPage") {
      void captureFullPage().catch(console.error);
      sendResponse({ status: "started" });
    }
  });
})();
