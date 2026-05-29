// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

const SYSTEM_PROMPTS = {
  professional:
    "You are a professional writing assistant. Rewrite the following text in clear, formal, and polished business English. " +
    "Maintain the original meaning. Return only the rewritten text without any explanation.",
  casual:
    "You are a friendly writing assistant. Rewrite the following text in natural, warm, and conversational English. " +
    "Maintain the original meaning. Return only the rewritten text without any explanation.",
};

async function transformText(text, tone, apiKey, provider) {
  if (provider === "anthropic") {
    return callAnthropic(text, tone, apiKey);
  }
  return callOpenAI(text, tone, apiKey);
}

async function callOpenAI(text, tone, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[tone] },
        { role: "user", content: text },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function callAnthropic(text, tone, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPTS[tone],
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

api.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-tone-menu") return;

  // Visual badge confirms command fired (no DevTools needed)
  api.action.setBadgeText({ text: "✓" });
  api.action.setBadgeBackgroundColor({ color: "#4f46e5" });
  setTimeout(() => api.action.setBadgeText({ text: "" }), 2000);

  // getLastFocused is more reliable than currentWindow in background scripts
  const win = await api.windows.getLastFocused({ populate: true }).catch(() => null);
  const tab = win?.tabs?.find((t) => t.active);
  if (!tab?.id) return;

  api.tabs.sendMessage(tab.id, { type: "OPEN_TONE_MENU" }).catch(() => {});
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "TRANSFORM_TEXT") return false;

  const { text, tone } = message;

  api.storage.local.get(["apiKey", "provider"]).then(({ apiKey, provider = "openai" }) => {
    if (!apiKey) {
      sendResponse({ error: "API key not set. Please configure it in the extension popup." });
      return;
    }
    transformText(text, tone, apiKey, provider)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message }));
  });

  // Return true to keep the message channel open for the async response
  return true;
});
