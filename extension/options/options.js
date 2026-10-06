const ext = typeof browser !== "undefined" ? browser : chrome;

const fields = ["apiKey", "model", "defaultTone", "voiceProfile"];

async function load() {
  const stored = await ext.storage.local.get({
    apiKey: "",
    model: "claude-opus-5-5",
    defaultTone: "",
    voiceProfile: ""
  });
  for (const field of fields) {
    document.getElementById(field).value = stored[field];
  }
}

async function save() {
  const values = {};
  for (const field of fields) {
    values[field] = document.getElementById(field).value.trim();
  }
  await ext.storage.local.set(values);
  const status = document.getElementById("status");
  status.textContent = "Đã lưu ✓";
  setTimeout(() => (status.textContent = ""), 2000);
}

document.getElementById("save").addEventListener("click", save);
load();
