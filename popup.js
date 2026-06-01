// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

// --- State ---
let selectedTone = "business";

// --- DOM refs ---
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const toneBtns = document.querySelectorAll(".tone-btn");
const inputText = document.getElementById("input-text");
const btnTransform = document.getElementById("btn-transform");
const resultBox = document.getElementById("result-box");
const providerSelect = document.getElementById("provider-select");
const apiKeyInput = document.getElementById("api-key-input");
const btnToggleKey = document.getElementById("btn-toggle-key");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

// --- Tab switching ---
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
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
  btnTransform.textContent = "Transforming…";
  hideResult();

  const response = await api.runtime.sendMessage({
    type: "TRANSFORM_TEXT",
    text,
    tone: selectedTone,
  });

  btnTransform.disabled = false;
  btnTransform.textContent = "Transform";

  if (response.error) {
    showResult(response.error, true);
  } else {
    showResult(response.result, false);
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
});

// When provider changes, load that provider's saved key
providerSelect.addEventListener("change", () => {
  api.storage.local.get([`apiKey_${providerSelect.value}`]).then((data) => {
    apiKeyInput.value = data[`apiKey_${providerSelect.value}`] || "";
  });
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
