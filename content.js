// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;


let activeElement = null;
let floatingMenu = null;
let selectionBtn = null;
let savedRange = null;    // range saved when 🪄 is clicked, used to restore partial selection
let savedInputSel = null; // { start, end } for input/textarea
let lastMouseUp = { x: 0, y: 0 };

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
      <button class="atc-btn" data-tone="business">💼 Business</button>
      <button class="atc-btn" data-tone="casual">💬 Casual</button>
      <button class="atc-btn" data-tone="diplomatic">🤝 Diplomatic</button>
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
      width: 290px;
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
  const MENU_W = 294;
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
    const MENU_W = 294;
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
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const start = isPartial && savedInputSel ? savedInputSel.start : 0;
    const end   = isPartial && savedInputSel ? savedInputSel.end   : el.value.length;
    el.value = el.value.substring(0, start) + replacement + el.value.substring(end);
    el.selectionStart = start;
    el.selectionEnd   = start + replacement.length;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (el.isContentEditable) {
    el.focus();

    if (isPartial && savedRange) {
      // Restore saved selection → replace only that portion
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      document.execCommand("insertText", false, replacement);
    } else {
      // No selection → replace entire content
      document.execCommand("selectAll", false, null);
      const safe = replacement
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "</p><p>");
      document.execCommand("insertHTML", false, `<p>${safe}</p>`);
    }

    requestAnimationFrame(() => {
      el.focus();
      window.getSelection()?.collapseToEnd();
    });
  }
}

// --- Core transform logic ---

async function handleToneClick(tone) {
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
