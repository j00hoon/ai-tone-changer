// Cross-browser API shim
const api = typeof browser !== "undefined" ? browser : chrome;

const PROMPTS_URL =
  "https://raw.githubusercontent.com/j00hoon/ai-tone-changer/main/prompts.json";

const FALLBACK_PROMPTS = {
  business:
    "You are an expert professional copywriter. Your task is to rewrite the user's input into a professional, formal, and clear Business tone.\n\n[Core Objectives]\n- Maintain a polished, professional, and authoritative voice suitable for executive-level or external client communications.\n- Prioritize clarity, conciseness, and structured delivery. Avoid unnecessary filler words.\n\n[Constraints]\n- Keep all original facts, dates, names, and core requests exactly as provided.\n- Do not use slang, idioms, or overly casual contractions (e.g., use \"do not\" instead of \"don't\" where appropriate for high formality).\n- Output ONLY the final rewritten text without any greetings, explanations, or quotes.",
  casual:
    "You are a friendly and collaborative team member. Your task is to rewrite the user's input into a natural, warm, and approachable Casual tone suitable for workplace peers.\n\n[Core Objectives]\n- Use a conversational yet respectful voice appropriate for internal team chats (Slack/Teams) or close colleagues.\n- Sound encouraging, helpful, and accessible.\n\n[Constraints]\n- Keep it professional enough for the workplace; do not use overly informal internet slang, emojis (unless naturally fitting), or offensive text.\n- Maintain all key information, tasks, and deadlines from the original text.\n- Output ONLY the final rewritten text without any conversational intros or outros from the AI.",
  diplomatic:
    "You are a skilled corporate diplomat and mediator. Your task is to rewrite the user's input into a highly tactful, polite, and Diplomatic tone.\n\n[Core Objectives]\n- Soften blunt, aggressive, or direct statements (such as rejections, demands, or complaints) using polite cushioning language.\n- Frame difficult situations or requests in a win-win, solution-oriented manner to preserve professional relationships.\n- Use conditional or indirect phrasing (e.g., \"It would be greatly appreciated if...\", \"We might want to consider...\") to lower tension.\n\n[Constraints]\n- CRITICAL: Do not dilute or lose the core message, request, or boundary of the original text. The recipient must still understand the underlying point/demand clearly.\n- Keep all specific constraints, figures, and deadlines intact.\n- Output ONLY the final rewritten text.",
};

// In-memory prompt cache — refreshed once per service worker lifetime
let cachedPrompts = null;

async function getPrompts() {
  if (cachedPrompts) return cachedPrompts;
  try {
    const res = await fetch(PROMPTS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedPrompts = await res.json();
  } catch {
    cachedPrompts = FALLBACK_PROMPTS;
  }
  return cachedPrompts;
}

async function transformText(text, tone, apiKey, provider) {
  const prompts = await getPrompts();
  const systemPrompt = prompts[tone] || prompts.business;
  const userMessage = `Preserve the exact line breaks and paragraph structure of the original.\n\n${text}`;
  if (provider === "anthropic") {
    return callAnthropic(userMessage, systemPrompt, apiKey);
  }
  return callOpenAI(userMessage, systemPrompt, apiKey);
}

async function callOpenAI(text, systemPrompt, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
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

async function callAnthropic(text, systemPrompt, apiKey) {
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
      system: systemPrompt,
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

  api.storage.local.get(["apiKey_openai", "apiKey_anthropic", "provider"]).then((data) => {
    const provider = data.provider || "openai";
    const apiKey = data[`apiKey_${provider}`];
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
