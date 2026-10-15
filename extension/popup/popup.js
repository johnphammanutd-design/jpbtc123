const ext = typeof browser !== "undefined" ? browser : chrome;

const PROVIDER_NAMES = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
  google: "Google Gemini",
  deepseek: "DeepSeek"
};

const DEFAULT_MODELS = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-5-nano",
  google: "gemini-2.5-flash-lite",
  deepseek: "deepseek-chat"
};

async function load() {
  const stored = await ext.storage.local.get({
    provider: "anthropic",
    model: "",
    apiKeys: {},
    apiKey: "" // bản cũ
  });
  const provider = PROVIDER_NAMES[stored.provider] ? stored.provider : "anthropic";
  const hasKey = Boolean(
    stored.apiKeys?.[provider] || (provider === "anthropic" && stored.apiKey)
  );

  const keyStatus = document.getElementById("keyStatus");
  keyStatus.textContent = hasKey ? "Đã cài ✓" : "Chưa có — vào Cài đặt";
  keyStatus.className = "value " + (hasKey ? "ok" : "warn");

  document.getElementById("provider").textContent = PROVIDER_NAMES[provider];
  document.getElementById("model").textContent =
    stored.model || DEFAULT_MODELS[provider];
}

document.getElementById("openOptions").addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});

document.getElementById("openYoutube").addEventListener("click", () => {
  ext.tabs.create({ url: "https://www.youtube.com/" });
});

load();
