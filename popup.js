// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

// --- State ---
let selectedTone = "business";
let popupCompareMode = false;

// --- DOM refs ---
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const toneBtns = document.querySelectorAll(".tone-btn");
const inputText = document.getElementById("input-text");
const btnTransform = document.getElementById("btn-transform");
const resultBox = document.getElementById("result-box");
const compareResults = document.getElementById("compare-results");
const singleToneUi = document.getElementById("single-tone-ui");
const modeBtns = document.querySelectorAll(".mode-btn");
const providerSelect = document.getElementById("provider-select");
const apiKeyInput = document.getElementById("api-key-input");
const btnToggleKey = document.getElementById("btn-toggle-key");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");
const apiKeyLink = document.getElementById("api-key-link");

const API_KEY_URLS = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

function updateApiKeyLink(provider) {
  apiKeyLink.href = API_KEY_URLS[provider] || "#";
}

// --- Tab switching ---
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// --- Mode toggle ---
function applyMode(mode) {
  popupCompareMode = mode === "compare";
  modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  singleToneUi.style.display = popupCompareMode ? "none" : "";
  btnTransform.textContent = popupCompareMode ? "✨ Compare All Tones" : "Transform";
  resultBox.style.display = "none";
  compareResults.innerHTML = "";
}

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    applyMode(btn.dataset.mode);
    api.storage.local.set({ compareMode: popupCompareMode });
  });
});

// Load saved mode
api.storage.local.get("compareMode").then((data) => {
  if (data.compareMode) applyMode("compare");
});

// --- Tone selection ---
toneBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    toneBtns.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedTone = btn.dataset.tone;
  });
});

// --- Transform (popup input) ---
btnTransform.addEventListener("click", async () => {
  const text = inputText.value.trim();
  if (!text) {
    showResult("Please enter some text to transform.", true);
    return;
  }

  btnTransform.disabled = true;
  const originalLabel = btnTransform.textContent;
  btnTransform.textContent = popupCompareMode ? "Comparing…" : "Transforming…";
  hideResult();
  compareResults.innerHTML = "";

  if (popupCompareMode) {
    const response = await api.runtime.sendMessage({ type: "COMPARE_TONES", text });
    btnTransform.disabled = false;
    btnTransform.textContent = originalLabel;
    if (response.error) {
      showResult(response.error, true);
    } else {
      showCompareResults(response.result);
    }
  } else {
    const response = await api.runtime.sendMessage({ type: "TRANSFORM_TEXT", text, tone: selectedTone });
    btnTransform.disabled = false;
    btnTransform.textContent = originalLabel;
    if (response.error) {
      showResult(response.error, true);
    } else {
      showResult(response.result, false);
    }
  }
});

// Allow Ctrl+Enter to trigger transform
inputText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) btnTransform.click();
});

// --- Settings: load saved values ---
api.storage.local.get(["apiKey_openai", "apiKey_anthropic", "provider"]).then((data) => {
  const provider = data.provider || "openai";
  providerSelect.value = provider;
  apiKeyInput.value = data[`apiKey_${provider}`] || "";
  updateApiKeyLink(provider);
});

// When provider changes, load that provider's saved key
providerSelect.addEventListener("change", () => {
  const provider = providerSelect.value;
  api.storage.local.get([`apiKey_${provider}`]).then((data) => {
    apiKeyInput.value = data[`apiKey_${provider}`] || "";
  });
  updateApiKeyLink(provider);
});

// --- Settings: show/hide API key ---
btnToggleKey.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  btnToggleKey.textContent = isPassword ? "Hide" : "Show";
});

// --- Settings: save ---
btnSave.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;

  if (!apiKey) {
    flashSaveStatus("Please enter an API key.", false);
    return;
  }

  api.storage.local.set({ [`apiKey_${provider}`]: apiKey, provider }).then(() => {
    flashSaveStatus("Saved!", true);
  });
});

// --- Compare results ---
function showCompareResults(results) {
  const tones = [
    { key: "business",   icon: "💼", label: "Business"   },
    { key: "casual",     icon: "💬", label: "Casual"     },
    { key: "diplomatic", icon: "🤝", label: "Diplomatic" },
  ];

  compareResults.innerHTML = "";
  tones.forEach(({ key, icon, label }) => {
    const text = results[key] || "";
    const card = document.createElement("div");
    card.className = "compare-card";

    const header = document.createElement("div");
    header.className = "compare-card-header";

    const titleEl = document.createElement("span");
    titleEl.textContent = `${icon} ${label}`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    });

    header.appendChild(titleEl);
    header.appendChild(copyBtn);

    const textEl = document.createElement("div");
    textEl.className = "compare-card-text";
    textEl.textContent = text;

    card.appendChild(header);
    card.appendChild(textEl);
    compareResults.appendChild(card);
  });
}

// --- Helpers ---
function showResult(text, isError) {
  resultBox.textContent = text;
  resultBox.className = `result-box${isError ? " error" : ""}`;
  resultBox.style.display = "block";
}

function hideResult() {
  resultBox.style.display = "none";
}

function flashSaveStatus(msg, success) {
  saveStatus.textContent = msg;
  saveStatus.style.color = success ? "#48bb78" : "#c53030";
  setTimeout(() => (saveStatus.textContent = ""), 2500);
}
