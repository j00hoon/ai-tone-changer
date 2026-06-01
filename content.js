// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;


let activeElement = null;
let floatingMenu = null;
let selectionBtn = null;
let savedRange = null;    // range saved when 🪄 is clicked, used to restore partial selection
let savedInputSel = null; // { start, end } for input/textarea
let lastMouseUp = { x: 0, y: 0 };
let compareMode = false;
let compareModeLoaded = false;

async function ensureCompareModeLoaded() {
  if (compareModeLoaded) return;
  if (!api?.storage?.local) return;
  const data = await api.storage.local.get("compareMode");
  compareMode = !!data.compareMode;
  compareModeLoaded = true;
}

// --- Element detection helpers ---

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    return !["hidden", "submit", "button", "reset", "checkbox", "radio", "file"].includes(t);
  }
  return tag === "TEXTAREA" || el.isContentEditable;
}

// Traverse shadow DOM roots to find the truly focused element
function deepActiveElement(root) {
  const el = root.activeElement;
  if (!el) return null;
  return el.shadowRoot ? deepActiveElement(el.shadowRoot) || el : el;
}

function resolveEditable() {
  // 1. Last tracked element — trust it while still in the DOM, even if focus
  //    temporarily shifted when the shortcut key was pressed
  if (activeElement?.isConnected) return activeElement;

  // 2. Shadow-DOM-aware document.activeElement (handles web components)
  const deep = deepActiveElement(document);
  if (isEditable(deep)) return deep;

  // 3. CSS :focus as last resort
  return document.querySelector(
    '[contenteditable]:focus, input:focus, textarea:focus'
  ) || null;
}

// --- Floating menu UI ---

function createFloatingMenu() {
  const menu = document.createElement("div");
  menu.id = "atc-menu";
  menu.innerHTML = `
    <div class="atc-header">
      <span class="atc-title">AI Tone Changer</span>
      <button class="atc-close" title="Close">✕</button>
    </div>
    <div class="atc-mode-toggle">
      <button class="atc-mode-btn ${!compareMode ? "active" : ""}" data-mode="single">Single</button>
      <button class="atc-mode-btn ${compareMode ? "active" : ""}" data-mode="compare">Compare All</button>
    </div>
    <div class="atc-single-ui"${compareMode ? ' style="display:none"' : ""}>
      <div class="atc-buttons">
        <button class="atc-btn" data-tone="business">💼 Business</button>
        <button class="atc-btn" data-tone="casual">💬 Casual</button>
        <button class="atc-btn" data-tone="diplomatic">🤝 Diplomatic</button>
      </div>
    </div>
    <div class="atc-compare-ui"${!compareMode ? ' style="display:none"' : ""}>
      <button class="atc-compare-btn">✨ Compare All Tones</button>
    </div>
    <div class="atc-status" style="display:none;"></div>
    <div class="atc-results" style="display:none;"></div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #atc-menu {
      position: fixed;
      z-index: 2147483647;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      padding: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      width: 310px;
      user-select: none;
    }
    .atc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .atc-title { font-weight: 600; color: #1a202c; }
    .atc-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #718096;
      font-size: 12px;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .atc-close:hover { background: #f7fafc; color: #1a202c; }
    .atc-buttons { display: flex; gap: 6px; }
    .atc-btn {
      flex: 1;
      padding: 7px 6px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #f7fafc;
      cursor: pointer;
      font-size: 12px;
      color: #2d3748;
      transition: all 0.15s;
    }
    .atc-btn:hover { background: #4f46e5; color: #fff; border-color: #4f46e5; }
    .atc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .atc-mode-toggle {
      display: flex;
      gap: 3px;
      background: #f1f5f9;
      border-radius: 7px;
      padding: 3px;
      margin-bottom: 8px;
    }
    .atc-mode-btn {
      flex: 1;
      padding: 4px 6px;
      border: none;
      border-radius: 5px;
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      color: #718096;
      transition: all 0.15s;
    }
    .atc-mode-btn.active { background: #fff; color: #2d3748; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .atc-compare-btn {
      width: 100%;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #f7fafc;
      cursor: pointer;
      font-size: 12px;
      color: #2d3748;
      transition: all 0.15s;
    }
    .atc-compare-btn:hover { background: #4f46e5; color: #fff; border-color: #4f46e5; }
    .atc-compare-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .atc-results { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .atc-result-item {
      padding: 7px 9px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .atc-result-item:hover { border-color: #4f46e5; background: #f5f3ff; }
    .atc-result-label { font-size: 11px; font-weight: 600; color: #4f46e5; margin-bottom: 3px; }
    .atc-result-preview {
      font-size: 11px;
      color: #4a5568;
      line-height: 1.4;
      max-height: 80px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .atc-status {
      margin-top: 8px;
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 11px;
      text-align: center;
    }
    .atc-status.loading { background: #ebf8ff; color: #2b6cb0; }
    .atc-status.error   { background: #fff5f5; color: #c53030; }
    .atc-status.success { background: #f0fff4; color: #276749; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(menu);

  menu.querySelector(".atc-close").addEventListener("click", removeMenu);

  menu.querySelectorAll(".atc-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      compareMode = mode === "compare";
      api?.storage?.local?.set({ compareMode });
      menu.querySelectorAll(".atc-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      menu.querySelector(".atc-single-ui").style.display = compareMode ? "none" : "";
      menu.querySelector(".atc-compare-ui").style.display = compareMode ? "" : "none";
      menu.querySelector(".atc-results").style.display = "none";
      menu.querySelector(".atc-status").style.display = "none";
    });
  });

  menu.querySelectorAll(".atc-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleToneClick(btn.dataset.tone));
  });

  menu.querySelector(".atc-compare-btn").addEventListener("click", handleCompareClick);

  // Drag by header
  const header = menu.querySelector(".atc-header");
  header.style.cursor = "grab";
  let dragging = false, ox = 0, oy = 0;

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest(".atc-close")) return;
    dragging = true;
    ox = e.clientX - menu.getBoundingClientRect().left;
    oy = e.clientY - menu.getBoundingClientRect().top;
    header.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    let left = e.clientX - ox;
    let top  = e.clientY - oy;
    left = Math.max(0, Math.min(left, window.innerWidth  - menu.offsetWidth));
    top  = Math.max(0, Math.min(top,  window.innerHeight - menu.offsetHeight));
    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;
  });

  document.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; header.style.cursor = "grab"; }
  });

  return menu;
}

function positionMenu(menu) {
  if (!activeElement) return;
  const rect = activeElement.getBoundingClientRect();
  const MENU_W = 314;
  const MENU_H = 110;
  const GAP = 6;

  // position:fixed uses viewport coords — never add scrollY/scrollX
  let top = rect.bottom + GAP;
  let left = rect.left;

  if (top + MENU_H > window.innerHeight) top = rect.top - MENU_H - GAP;
  if (left + MENU_W > window.innerWidth)  left = window.innerWidth - MENU_W - GAP;
  if (top < GAP)  top = GAP;
  if (left < GAP) left = GAP;

  menu.style.top  = `${top}px`;
  menu.style.left = `${left}px`;
}

function showMenu(anchorX, anchorY) {
  if (floatingMenu) return;
  floatingMenu = createFloatingMenu();
  if (anchorX !== undefined) {
    const MENU_W = 314;
    const left = Math.min(anchorX, window.innerWidth - MENU_W - 6);
    floatingMenu.style.left = `${Math.max(6, left)}px`;
    floatingMenu.style.top  = `${Math.max(6, anchorY)}px`;
  } else {
    positionMenu(floatingMenu);
  }
}

function removeMenu() {
  if (floatingMenu) { floatingMenu.remove(); floatingMenu = null; }
}

// --- Selection button (🪄) ---

function createSelectionBtn() {
  removeSelectionBtn();

  if (!document.getElementById("atc-sel-style")) {
    const s = document.createElement("style");
    s.id = "atc-sel-style";
    s.textContent = `
      #atc-sel-btn {
        position: fixed;
        z-index: 2147483646;
        width: 34px; height: 34px;
        background: #4f46e5;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 17px;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(79,70,229,.45);
        transition: transform .15s, box-shadow .15s;
        user-select: none;
      }
      #atc-sel-btn:hover { transform: scale(1.12); box-shadow: 0 4px 14px rgba(79,70,229,.6); }
    `;
    document.head.appendChild(s);
  }

  const btn = document.createElement("div");
  btn.id = "atc-sel-btn";
  btn.textContent = "🪄";
  btn.title = "AI Tone Changer";
  document.body.appendChild(btn);

  // preventDefault on mousedown preserves the text selection
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();

    // Save selection BEFORE removing button and showing menu
    const el = resolveEditable();
    if (el) {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        savedInputSel = { start: el.selectionStart, end: el.selectionEnd };
      } else if (el.isContentEditable) {
        const sel = window.getSelection();
        if (sel?.rangeCount > 0 && sel.toString().trim()) {
          savedRange = sel.getRangeAt(0).cloneRange();
        }
      }
    }

    removeSelectionBtn();
    activeElement = el || resolveEditable();
    showMenu(rect.left - 90, rect.bottom + 8);
  });

  selectionBtn = btn;
  return btn;
}

function removeSelectionBtn() {
  if (selectionBtn) { selectionBtn.remove(); selectionBtn = null; }
}

function positionSelectionBtn() {
  if (!selectionBtn) return;
  const btn = selectionBtn;
  const GAP = 8;

  // Contenteditable: position above the actual text selection
  const sel = window.getSelection();
  if (sel?.rangeCount > 0 && sel.toString().trim()) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      let top  = rect.top - 34 - GAP;
      if (top < 0) top = rect.bottom + GAP;
      btn.style.top  = `${Math.max(6, top)}px`;
      btn.style.left = `${Math.max(6, Math.min(lastMouseUp.x - 17, window.innerWidth - 40))}px`;
      return;
    }
    // Range rect is empty (e.g. Gmail on Chrome) — use last mouse position
    btn.style.top  = `${Math.max(6, lastMouseUp.y - 34 - GAP)}px`;
    btn.style.left = `${Math.max(6, Math.min(lastMouseUp.x - 17, window.innerWidth - 40))}px`;
    return;
  }

  // input / textarea fallback: position above the element itself
  const el = activeElement;
  if (el) {
    const rect = el.getBoundingClientRect();
    btn.style.top  = `${Math.max(6, rect.top - 34 - GAP)}px`;
    btn.style.left = `${Math.max(6, Math.min(rect.left + rect.width / 2 - 17, window.innerWidth - 40))}px`;
  }
}

// --- Text helpers ---

function getTextFromElement(el) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) return el.value.substring(start, end);
    return el.value;
  }
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) return sel.toString();
    return el.innerText;
  }
  return "";
}

function replaceTextInElement(el, original, replacement, isPartial = false) {
  // If element was detached by SPA re-render, try to find a fresh one
  if (!el?.isConnected) {
    const fresh = resolveEditable();
    if (!fresh) return;
    el = fresh;
    activeElement = fresh;
    // Partial selection no longer valid on a fresh element
    isPartial = false;
  }

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const start = isPartial && savedInputSel ? savedInputSel.start : 0;
    const end   = isPartial && savedInputSel ? savedInputSel.end   : el.value.length;
    const newValue = el.value.substring(0, start) + replacement + el.value.substring(end);

    // Use native setter so React/Vue controlled inputs pick up the change
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, newValue);
    else el.value = newValue;

    el.selectionStart = start;
    el.selectionEnd   = start + replacement.length;
    el.dispatchEvent(new InputEvent("input",  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (el.isContentEditable) {
    el.focus();

    // Validate saved range — DOM may have mutated during async LLM call
    const rangeValid = isPartial && savedRange &&
      savedRange.startContainer?.isConnected &&
      savedRange.endContainer?.isConnected;

    let success = false;

    if (rangeValid) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
        success = document.execCommand("insertText", false, replacement);
      } catch (_) { success = false; }
    }

    if (!success) {
      // Full replacement fallback
      try {
        document.execCommand("selectAll", false, null);
        const safe = replacement
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "</p><p>");
        document.execCommand("insertHTML", false, `<p>${safe}</p>`);
      } catch (_) {
        // Last resort: direct assignment
        el.innerText = replacement;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    }

    requestAnimationFrame(() => {
      el.focus();
      window.getSelection()?.collapseToEnd();
    });
  }
}

// --- Core transform logic ---

async function handleToneClick(tone) {
  if (!activeElement?.isConnected) activeElement = resolveEditable();
  if (!activeElement) return;

  // Use saved selection text (from 🪄 click) if available, otherwise full text
  const isPartial = !!(savedRange || savedInputSel);
  const text = isPartial
    ? getSavedSelectionText(activeElement)
    : getTextFromElement(activeElement).trim();

  if (!text) {
    showStatus("error", "No text found in the input field.");
    savedRange = null; savedInputSel = null;
    return;
  }

  setButtonsDisabled(true);
  showStatus("loading", "Converting…");

  try {
    const response = await api.runtime.sendMessage({ type: "TRANSFORM_TEXT", text, tone });
    if (response.error) {
      showStatus("error", response.error);
    } else {
      replaceTextInElement(activeElement, text, response.result, isPartial);
      if (floatingMenu) floatingMenu.querySelector(".atc-results").style.display = "none";
      showStatus("success", "Done!");
      setTimeout(removeMenu, 1200);
    }
  } catch (err) {
    showStatus("error", "Extension error. Please try again.");
  } finally {
    setButtonsDisabled(false);
    savedRange = null; savedInputSel = null;
  }
}

function getSavedSelectionText(el) {
  if (savedInputSel && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
    return el.value.substring(savedInputSel.start, savedInputSel.end).trim();
  }
  if (savedRange) {
    return savedRange.toString().trim();
  }
  return getTextFromElement(el).trim();
}

function showStatus(type, msg) {
  if (!floatingMenu) return;
  const el = floatingMenu.querySelector(".atc-status");
  el.className = `atc-status ${type}`;
  el.textContent = msg;
  el.style.display = "block";
}

function hideStatus() {
  if (!floatingMenu) return;
  floatingMenu.querySelector(".atc-status").style.display = "none";
}

async function handleCompareClick() {
  if (!activeElement?.isConnected) activeElement = resolveEditable();
  if (!activeElement) return;

  const isPartial = !!(savedRange || savedInputSel);
  const text = isPartial
    ? getSavedSelectionText(activeElement)
    : getTextFromElement(activeElement).trim();

  if (!text) {
    showStatus("error", "No text found in the input field.");
    savedRange = null; savedInputSel = null;
    return;
  }

  const compareBtn = floatingMenu?.querySelector(".atc-compare-btn");
  if (compareBtn) compareBtn.disabled = true;
  floatingMenu.querySelector(".atc-results").style.display = "none";
  showStatus("loading", "Comparing all tones…");

  try {
    const response = await api.runtime.sendMessage({ type: "COMPARE_TONES", text });
    hideStatus();
    if (!response) {
      showStatus("error", "No response from background. Try reloading the page.");
      savedRange = null; savedInputSel = null;
    } else if (response.error) {
      showStatus("error", response.error);
      savedRange = null; savedInputSel = null;
    } else if (compareMode && floatingMenu) {
      showCompareResults(response.result, isPartial);
    }
  } catch (err) {
    showStatus("error", err?.message || "Extension error. Please try again.");
    savedRange = null; savedInputSel = null;
  } finally {
    if (compareBtn) compareBtn.disabled = false;
  }
}

function showCompareResults(results, isPartial) {
  const container = floatingMenu?.querySelector(".atc-results");
  if (!container) return;

  const tones = [
    { key: "business",   icon: "💼", label: "Business"   },
    { key: "casual",     icon: "💬", label: "Casual"     },
    { key: "diplomatic", icon: "🤝", label: "Diplomatic" },
  ];

  container.innerHTML = "";
  tones.forEach(({ key, icon, label }) => {
    const fullText = results[key] || "";

    const item = document.createElement("div");
    item.className = "atc-result-item";

    const labelEl = document.createElement("div");
    labelEl.className = "atc-result-label";
    labelEl.textContent = `${icon} ${label}`;

    const previewEl = document.createElement("div");
    previewEl.className = "atc-result-preview";
    previewEl.textContent = fullText;

    item.appendChild(labelEl);
    item.appendChild(previewEl);
    item.addEventListener("click", () => {
      replaceTextInElement(activeElement, "", fullText, isPartial);
      savedRange = null; savedInputSel = null;
      removeMenu();
    });

    container.appendChild(item);
  });

  container.style.display = "flex";
}

function setButtonsDisabled(disabled) {
  if (!floatingMenu) return;
  floatingMenu.querySelectorAll(".atc-btn").forEach((b) => (b.disabled = disabled));
}

// --- Event listeners ---

document.addEventListener("focusin", (e) => {
  if (isEditable(e.target)) {
    activeElement = e.target;
    ensureCompareModeLoaded().catch(() => {});
  }
});

// Capture phase fires before page scripts (React, Gmail, etc.) can intercept
let lastToggleMs = 0;
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { removeMenu(); return; }

  if (e.key?.toLowerCase() === "y" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    const now = Date.now();
    if (now - lastToggleMs < 400) return; // debounce: skip if commands API also fires
    lastToggleMs = now;
    e.stopImmediatePropagation(); // prevent Gmail/Slack/etc. from seeing the key
    tryOpenMenu();
  }
}, { capture: true });

// Show/hide 🪄 button on any selection change (mouse drag OR keyboard Shift+arrows)
let selChangeTimer = null;
document.addEventListener("selectionchange", () => {
  clearTimeout(selChangeTimer);
  selChangeTimer = setTimeout(() => {
    if (floatingMenu) return;

    const el = resolveEditable();
    if (!el) { removeSelectionBtn(); return; }

    let hasSelection = false;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      hasSelection = el.selectionStart !== el.selectionEnd;
    } else {
      hasSelection = !!window.getSelection()?.toString().trim();
    }

    if (hasSelection) {
      if (!selectionBtn) createSelectionBtn();
      positionSelectionBtn();
    } else {
      removeSelectionBtn();
    }
  }, 60); // 60ms debounce — responsive but not excessive
});

// Track mouse position for wand button positioning
document.addEventListener("mousedown", () => { lastMouseUp = { x: 0, y: 0 }; });
document.addEventListener("mouseup", (e) => { lastMouseUp = { x: e.clientX, y: e.clientY }; });

// Close menu when clicking outside
document.addEventListener("mousedown", (e) => {
  if (floatingMenu && !floatingMenu.contains(e.target)) removeMenu();
});

function tryOpenMenu() {
  activeElement = resolveEditable();
  if (activeElement) {
    if (floatingMenu) removeMenu();
    else showMenu();
  }
}

// Handles commands API fallback (background.js) and popup button
api.runtime.onMessage.addListener((message) => {
  if (message.type !== "OPEN_TONE_MENU") return;
  const now = Date.now();
  if (now - lastToggleMs < 400) return; // already handled by capture listener
  lastToggleMs = now;
  tryOpenMenu();
});
