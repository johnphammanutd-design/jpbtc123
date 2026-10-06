const ext = typeof browser !== "undefined" ? browser : chrome;

// Danh sách model phải khớp với PROVIDERS trong background.js.
const PROVIDER_MODELS = {
  openai: [
    ["gpt-5-nano", "GPT-5 nano — rẻ nhất ($0.05/$0.40 mỗi 1M token)"],
    ["gpt-5-mini", "GPT-5 mini — chất lượng cao hơn"]
  ],
  google: [
    ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite ($0.10/$0.40)"],
    ["gemini-2.5-flash", "Gemini 2.5 Flash — chất lượng cao hơn"]
  ],
  deepseek: [["deepseek-chat", "DeepSeek chat ($0.14/$0.28)"]],
  anthropic: [
    ["claude-haiku-4-5", "Claude Haiku 4.5 ($1/$5)"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 ($2/$10)"],
    ["claude-opus-5-5", "Claude Opus 5.5 — chất lượng cao nhất ($4/$20)"]
  ]
};

const KEY_HINTS = {
  openai: "Lấy tại platform.openai.com → API keys.",
  google: "Lấy tại aistudio.google.com → Get API key.",
  deepseek: "Lấy tại platform.deepseek.com → API keys.",
  anthropic: "Lấy tại console.anthropic.com → API Keys."
};

let apiKeys = {};

function currentProvider() {
  return document.getElementById("provider").value;
}

function renderModels(selectedModel) {
  const modelSelect = document.getElementById("model");
  modelSelect.innerHTML = "";
  for (const [value, label] of PROVIDER_MODELS[currentProvider()]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  }
  if (selectedModel && PROVIDER_MODELS[currentProvider()].some(([v]) => v === selectedModel)) {
    modelSelect.value = selectedModel;
  }
}

function renderKeyField() {
  const provider = currentProvider();
  document.getElementById("apiKey").value = apiKeys[provider] || "";
  document.getElementById("keyHint").textContent =
    `${KEY_HINTS[provider]} Key chỉ lưu trong trình duyệt của bạn (storage.local) và chỉ gửi tới đúng API đó.`;
}

async function load() {
  const stored = await ext.storage.local.get({
    provider: "openai",
    model: "",
    apiKeys: {},
    defaultTone: "",
    voiceProfile: "",
    apiKey: "" // bản cũ chỉ có Anthropic
  });
  apiKeys = stored.apiKeys || {};
  if (stored.apiKey && !apiKeys.anthropic) apiKeys.anthropic = stored.apiKey;

  document.getElementById("provider").value = PROVIDER_MODELS[stored.provider]
    ? stored.provider
    : "openai";
  renderModels(stored.model);
  renderKeyField();
  document.getElementById("defaultTone").value = stored.defaultTone;
  document.getElementById("voiceProfile").value = stored.voiceProfile;
}

async function save() {
  apiKeys[currentProvider()] = document.getElementById("apiKey").value.trim();
  await ext.storage.local.set({
    provider: currentProvider(),
    model: document.getElementById("model").value,
    apiKeys,
    defaultTone: document.getElementById("defaultTone").value,
    voiceProfile: document.getElementById("voiceProfile").value.trim()
  });
  const status = document.getElementById("status");
  status.textContent = "Đã lưu ✓";
  setTimeout(() => (status.textContent = ""), 2000);
}

document.getElementById("provider").addEventListener("change", () => {
  renderModels();
  renderKeyField();
});
document.getElementById("save").addEventListener("click", save);
load();
