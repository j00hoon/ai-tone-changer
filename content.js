// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;


let activeElement = null;
let floatingMenu = null;

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
    <div class="atc-buttons">
      <button class="atc-btn" data-tone="professional">💼 Professional</button>
      <button class="atc-btn" data-tone="casual">💬 Casual</button>
    </div>
    <div class="atc-status" style="display:none;"></div>
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
      width: 210px;
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
  menu.querySelectorAll(".atc-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleToneClick(btn.dataset.tone));
  });

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
  const MENU_W = 214;
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

function showMenu() {
  if (floatingMenu) return;
  floatingMenu = createFloatingMenu();
  positionMenu(floatingMenu);
}

function removeMenu() {
  if (floatingMenu) {
    floatingMenu.remove();
    floatingMenu = null;
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

function replaceTextInElement(el, original, replacement) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      const before = el.value.substring(0, start);
      const after = el.value.substring(end);
      el.value = before + replacement + after;
      el.selectionStart = start;
      el.selectionEnd = start + replacement.length;
    } else {
      el.value = replacement;
      el.selectionStart = 0;
      el.selectionEnd = replacement.length;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    document.execCommand("selectAll", false, null);

    // Wrap in <p> to match the DOM structure LinkedIn/Slack expect for non-empty state.
    // insertText produces a bare text node; insertHTML produces <p>text</p> which
    // editors use to distinguish empty (<p><br></p>) from non-empty state.
    const safe = replacement
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "</p><p>");
    document.execCommand("insertHTML", false, `<p>${safe}</p>`);

    // Defer selection collapse until after MutationObserver / React callbacks run,
    // so the editor doesn't re-select everything before we collapse.
    requestAnimationFrame(() => {
      el.focus();
      const sel = window.getSelection();
      if (sel?.rangeCount) sel.collapseToEnd();
    });
  }
}

// --- Core transform logic ---

async function handleToneClick(tone) {
  if (!activeElement) return;

  const text = getTextFromElement(activeElement).trim();
  if (!text) {
    showStatus("error", "No text found in the input field.");
    return;
  }

  setButtonsDisabled(true);
  showStatus("loading", "Converting…");

  try {
    const response = await api.runtime.sendMessage({ type: "TRANSFORM_TEXT", text, tone });
    if (response.error) {
      showStatus("error", response.error);
    } else {
      replaceTextInElement(activeElement, text, response.result);
      showStatus("success", "Done!");
      setTimeout(removeMenu, 1200);
    }
  } catch (err) {
    showStatus("error", "Extension error. Please try again.");
  } finally {
    setButtonsDisabled(false);
  }
}

function showStatus(type, msg) {
  if (!floatingMenu) return;
  const el = floatingMenu.querySelector(".atc-status");
  el.className = `atc-status ${type}`;
  el.textContent = msg;
  el.style.display = "block";
}

function setButtonsDisabled(disabled) {
  if (!floatingMenu) return;
  floatingMenu.querySelectorAll(".atc-btn").forEach((b) => (b.disabled = disabled));
}

// --- Event listeners ---

document.addEventListener("focusin", (e) => {
  if (isEditable(e.target)) activeElement = e.target;
});

// Capture phase fires before page scripts (React, Gmail, etc.) can intercept
let lastToggleMs = 0;
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { removeMenu(); return; }

  if (e.key.toLowerCase() === "y" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    const now = Date.now();
    if (now - lastToggleMs < 400) return; // debounce: skip if commands API also fires
    lastToggleMs = now;
    e.stopImmediatePropagation(); // prevent Gmail/Slack/etc. from seeing the key
    tryOpenMenu();
  }
}, { capture: true });

// Close menu when clicking outside
document.addEventListener("mousedown", (e) => {
  if (floatingMenu && !floatingMenu.contains(e.target)) {
    removeMenu();
  }
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
