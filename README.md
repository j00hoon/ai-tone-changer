# AI Tone Changer

A Manifest V3 browser extension that rewrites your text with AI — switch between Professional, Casual, Concise, Persuasive, Friendly, and more tones in any text field.

Available on **Chrome** and **Firefox**.

---

## Features

- **6 tones**: Professional, Casual, Concise, Persuasive, Friendly, Formal
- **Compare All mode**: Preview all tones side-by-side before applying
- **In-page wand button**: Select any text → click the magic wand → pick a tone
- **Keyboard shortcut**: `Ctrl+Shift+Y` to open the tone menu on any focused input
- **Popup UI**: Transform tab + Settings tab
- **Dual AI provider support**: OpenAI (`gpt-4o-mini`) or Anthropic (`claude-haiku-4-5-20251001`)
- Cross-browser compatible (Chrome 88+ / Firefox 109+)

---

## Getting Started

### 1. Load the extension

**Chrome / Edge**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

### 2. Configure your API key

1. Click the extension icon in the toolbar
2. Open the **Settings** tab
3. Choose your AI provider (OpenAI or Anthropic) and paste your API key

### 3. Use it

- **Select text** anywhere on a page → a wand button (✨) appears → click it → choose a tone
- **Or** focus any text field and press `Ctrl+Shift+Y`
- **Or** open the popup, paste text in the **Transform** tab, and click a tone button

---

## File Structure

```
manifest.json      # MV3 manifest (Chrome + Firefox)
background.js      # Service worker — handles LLM API calls
content.js         # Injected on all pages — floating wand UI, text replacement
popup.html/js/css  # Popup UI
icons/             # icon16, icon48, icon128
```

---

## API Keys

You need an API key from one of:
- [OpenAI](https://platform.openai.com/api-keys) — uses `gpt-4o-mini`
- [Anthropic](https://console.anthropic.com/) — uses `claude-haiku-4-5-20251001`

Keys are stored locally in browser storage and never sent anywhere except the chosen provider.

---

## License

MIT
