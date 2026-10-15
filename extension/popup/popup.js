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

// ---- Kiểm tra & cập nhật phiên bản ----
// Lưu ý: Chrome không cho extension tự ghi đè file của nó, nên "cập nhật"
// gồm 3 bước gói gọn trong popup: kiểm tra → tải zip → giải nén đè → Reload.

const GITHUB_REPO = "johnphammanutd-design/jpbtc123";
const GITHUB_BRANCH = "claude/extension-ai-comment-war-4t475x";
const MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/extension/manifest.json`;
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH.replace(/\//g, "%2F")}.zip`;

// So sánh phiên bản dạng a.b.c; trả về true nếu latest mới hơn current.
function isNewer(latest, current) {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

document.getElementById("version").textContent =
  "v" + ext.runtime.getManifest().version;

document.getElementById("checkUpdate").addEventListener("click", async () => {
  const status = document.getElementById("updateStatus");
  status.textContent = "Đang kiểm tra…";
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    const current = ext.runtime.getManifest().version;
    if (isNewer(remote.version, current)) {
      document.getElementById("latestVersion").textContent = "v" + remote.version;
      document.getElementById("updateRow").style.display = "";
      document.getElementById("downloadUpdate").style.display = "";
      status.textContent =
        "Có bản mới! Tải về → giải nén đè lên thư mục extension → bấm Reload bên dưới.";
    } else {
      status.textContent = `Bạn đang dùng bản mới nhất (v${current}).`;
    }
  } catch (e) {
    status.textContent =
      "Không kiểm tra được (repo riêng tư hoặc mất mạng): " + e.message;
  }
});

document.getElementById("downloadUpdate").addEventListener("click", () => {
  ext.tabs.create({ url: DOWNLOAD_URL });
});

document.getElementById("reloadExt").addEventListener("click", () => {
  ext.runtime.reload();
});

load();
