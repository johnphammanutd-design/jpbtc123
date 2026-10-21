const ext = typeof browser !== "undefined" ? browser : chrome;

// Danh sách model phải khớp với PROVIDERS trong background.js.
// Giá USD / 1M token (input, output), khảo sát 10/2026.
const MODELS = [
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5", in: 1.0, out: 5.0, note: "rẻ nhất nhà Claude (mặc định)" },
  { provider: "anthropic", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", in: 2.0, out: 10.0, note: "cân bằng giá/chất lượng" },
  { provider: "anthropic", id: "claude-opus-5-5", label: "Claude Opus 5.5", in: 4.0, out: 20.0, note: "chất lượng cao nhất" },
  { provider: "openai", id: "gpt-5-nano", label: "OpenAI GPT-5 nano", in: 0.05, out: 0.4, note: "rẻ nhất thị trường" },
  { provider: "openai", id: "gpt-5-mini", label: "OpenAI GPT-5 mini", in: 0.25, out: 2.0, note: "" },
  { provider: "google", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", in: 0.1, out: 0.4, note: "" },
  { provider: "google", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", in: 0.3, out: 2.5, note: "" },
  { provider: "deepseek", id: "deepseek-chat", label: "DeepSeek chat", in: 0.14, out: 0.28, note: "" }
];

const PROVIDER_NAMES = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
  google: "Google Gemini",
  deepseek: "DeepSeek"
};

const KEY_HINTS = {
  openai: "Lấy tại platform.openai.com → API keys.",
  google: "Lấy tại aistudio.google.com → Get API key.",
  deepseek: "Lấy tại platform.deepseek.com → API keys.",
  anthropic: "Lấy tại console.anthropic.com → API Keys."
};

// Token trung bình đo theo prompt hiện tại của extension.
// Đã tính bản dịch tiếng Việt và phương án góc nhìn chuyên gia (bật mặc định).
const SUGGEST_TOKENS = { in: 1500, out: 600 }; // 1 lần gợi ý trả lời
const SCAN_TOKENS = { in: 2000, out: 1500 }; // 1 lần quét 30 comment
const ANTHROPIC_MONTHLY_CREDIT = 200; // USD, gói có credit API hàng tháng

let apiKeys = {};

function currentProvider() {
  return document.getElementById("provider").value;
}

function modelsOf(provider) {
  return MODELS.filter((m) => m.provider === provider);
}

function costPerAction(model, tokens) {
  return (tokens.in / 1e6) * model.in + (tokens.out / 1e6) * model.out;
}

function monthlyCost(model) {
  const suggestsPerDay = Number(document.getElementById("suggestsPerDay").value) || 0;
  const scansPerDay = Number(document.getElementById("scansPerDay").value) || 0;
  return (
    30 *
    (suggestsPerDay * costPerAction(model, SUGGEST_TOKENS) +
      scansPerDay * costPerAction(model, SCAN_TOKENS))
  );
}

function money(usd) {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return "$" + (usd < 1 ? usd.toFixed(3) : usd.toFixed(2));
}

function renderModels(selectedModel) {
  const modelSelect = document.getElementById("model");
  modelSelect.replaceChildren();
  for (const m of modelsOf(currentProvider())) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label} ($${m.in}/$${m.out} mỗi 1M token)${m.note ? " — " + m.note : ""}`;
    modelSelect.appendChild(opt);
  }
  if (selectedModel && modelsOf(currentProvider()).some((m) => m.id === selectedModel)) {
    modelSelect.value = selectedModel;
  }
}

function renderKeyField() {
  const provider = currentProvider();
  document.getElementById("apiKey").value = apiKeys[provider] || "";
  document.getElementById("keyHint").textContent =
    `${KEY_HINTS[provider]} Key chỉ lưu trong trình duyệt của bạn (storage.local) và chỉ gửi tới đúng API đó.`;
}

// Bảng so sánh chi phí tháng của mọi model theo mức dùng đã nhập.
// Bấm vào một dòng để chọn luôn model đó.
function renderCostTable() {
  const tbody = document.getElementById("costRows");
  tbody.replaceChildren();
  const selectedId = document.getElementById("model").value;
  const rows = MODELS.map((m) => ({ m, cost: monthlyCost(m) })).sort(
    (a, b) => a.cost - b.cost
  );
  for (const { m, cost } of rows) {
    const tr = document.createElement("tr");
    tr.className = m.id === selectedId ? "selected" : "";
    const perSuggest = costPerAction(m, SUGGEST_TOKENS);
    const creditNote =
      m.provider === "anthropic"
        ? `${((cost / ANTHROPIC_MONTHLY_CREDIT) * 100).toFixed(1)}% credit $200`
        : "trả tiền túi";
    const cells = [m.label, money(perSuggest), money(cost), creditNote];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 2) {
        const b = document.createElement("b");
        b.textContent = text;
        td.appendChild(b);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    });
    tr.addEventListener("click", () => {
      document.getElementById("provider").value = m.provider;
      renderModels(m.id);
      renderKeyField();
      renderCostTable();
    });
    tbody.appendChild(tr);
  }
}

function renderAll(selectedModel) {
  renderModels(selectedModel);
  renderKeyField();
  renderCostTable();
}

async function load() {
  const stored = await ext.storage.local.get({
    provider: "anthropic",
    model: "",
    apiKeys: {},
    defaultTone: "",
    voiceProfile: "",
    replyLanguage: "en-US",
    audienceProfile: "Người Mỹ lớn tuổi, trên 60 tuổi",
    showTranslation: true,
    expertAngle: true,
    apiKey: "" // bản cũ chỉ có Anthropic
  });
  apiKeys = stored.apiKeys || {};
  if (stored.apiKey && !apiKeys.anthropic) apiKeys.anthropic = stored.apiKey;

  document.getElementById("provider").value = PROVIDER_NAMES[stored.provider]
    ? stored.provider
    : "anthropic";
  document.getElementById("defaultTone").value = stored.defaultTone;
  document.getElementById("voiceProfile").value = stored.voiceProfile;
  document.getElementById("replyLanguage").value = stored.replyLanguage;
  document.getElementById("audienceProfile").value = stored.audienceProfile;
  document.getElementById("showTranslation").checked = stored.showTranslation !== false;
  document.getElementById("expertAngle").checked = stored.expertAngle !== false;
  renderAll(stored.model);
}

async function save() {
  apiKeys[currentProvider()] = document.getElementById("apiKey").value.trim();
  await ext.storage.local.set({
    provider: currentProvider(),
    model: document.getElementById("model").value,
    apiKeys,
    defaultTone: document.getElementById("defaultTone").value,
    voiceProfile: document.getElementById("voiceProfile").value.trim(),
    replyLanguage: document.getElementById("replyLanguage").value,
    audienceProfile: document.getElementById("audienceProfile").value.trim(),
    showTranslation: document.getElementById("showTranslation").checked,
    expertAngle: document.getElementById("expertAngle").checked
  });
  const status = document.getElementById("status");
  status.textContent = "Đã lưu ✓";
  setTimeout(() => (status.textContent = ""), 2000);
}

document.getElementById("provider").addEventListener("change", () => renderAll());
document.getElementById("model").addEventListener("change", renderCostTable);
document.getElementById("suggestsPerDay").addEventListener("input", renderCostTable);
document.getElementById("scansPerDay").addEventListener("input", renderCostTable);
document.getElementById("save").addEventListener("click", save);
load();
