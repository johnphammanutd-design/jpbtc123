// Background script: nơi duy nhất gọi API của nhà cung cấp AI.
// Content script gửi message { type: "suggest", payload } → trả về danh sách gợi ý.
// Hỗ trợ nhiều nhà cung cấp; mặc định là GPT-5 nano (rẻ nhất thị trường 10/2026).

const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_PROVIDER = "openai";

// Giá tham khảo 10/2026 (USD / 1M token input|output) ghi trong README.
const PROVIDERS = {
  openai: {
    defaultModel: "gpt-5-nano",
    models: ["gpt-5-nano", "gpt-5-mini"],
    url: "https://api.openai.com/v1/chat/completions"
  },
  google: {
    defaultModel: "gemini-2.5-flash-lite",
    models: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    url: "https://generativelanguage.googleapis.com/v1beta/models"
  },
  deepseek: {
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat"],
    url: "https://api.deepseek.com/chat/completions"
  },
  anthropic: {
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    url: "https://api.anthropic.com/v1/messages"
  }
};

const SYSTEM_PROMPT = `Bạn là trợ lý soạn câu trả lời comment cho chủ kênh video tiếng Việt.
Nhiệm vụ: đọc một comment dưới video và đề xuất các phương án trả lời để CHỦ KÊNH tự chọn, tự sửa và tự đăng.

Quy tắc bắt buộc:
- Mỗi câu trả lời dài 1–3 câu, văn nói tự nhiên, đúng kiểu người Việt bình luận trên mạng (có thể dùng "mình", "bạn", emoji tiết chế).
- Phản biện phải dựa trên lý lẽ hoặc nội dung video được cung cấp. KHÔNG bịa thông tin, không hứa hẹn thay chủ kênh.
- KHÔNG công kích cá nhân, không miệt thị, không tục tĩu, không khiêu khích leo thang.
- Nếu comment là troll/khiêu khích thuần túy, hãy nói rõ trong phân loại và khuyên bỏ qua hoặc chỉ đáp một câu hóa giải nhẹ nhàng.
- Nếu comment là góp ý có lý, phương án đầu tiên phải là ghi nhận góp ý một cách thiện chí.

Luôn trả lời bằng đúng một khối JSON (không kèm văn bản nào khác) theo mẫu:
{
  "phan_loai": "gop_y_co_ly" | "hieu_sai_noi_dung" | "che_vo_can_cu" | "troll",
  "nhan_xet": "<1 câu nhận xét ngắn về comment và nên phản ứng thế nào>",
  "goi_y": [
    { "giong": "phan_bien", "noi_dung": "..." },
    { "giong": "hai_huoc", "noi_dung": "..." },
    { "giong": "lich_su", "noi_dung": "..." }
  ]
}`;

function buildUserPrompt(payload, settings) {
  const parts = [];
  parts.push(`Tiêu đề video: ${payload.videoTitle || "(không rõ)"}`);
  if (payload.videoDescription) {
    parts.push(`Mô tả/ngữ cảnh video: ${payload.videoDescription.slice(0, 1500)}`);
  }
  if (settings.voiceProfile) {
    parts.push(`Giọng của kênh (viết đúng chất này): ${settings.voiceProfile}`);
  }
  if (settings.defaultTone) {
    parts.push(`Giọng ưu tiên của chủ kênh: ${settings.defaultTone}`);
  }
  parts.push(`Comment của "${payload.author || "người xem"}": ${payload.commentText}`);
  parts.push("Hãy phân loại comment và đề xuất 3 phương án trả lời theo đúng định dạng JSON.");
  return parts.join("\n\n");
}

// Bóc khối JSON đầu tiên trong văn bản trả về (phòng khi model kèm chữ thừa).
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Không tìm thấy JSON trong phản hồi của AI.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function getSettings() {
  const stored = await ext.storage.local.get({
    provider: DEFAULT_PROVIDER,
    model: "",
    apiKeys: {},
    defaultTone: "",
    voiceProfile: "",
    apiKey: "" // khóa Anthropic từ phiên bản cũ của extension
  });
  // Chuyển cấu hình cũ (chỉ có Anthropic) sang dạng đa nhà cung cấp.
  if (stored.apiKey && !stored.apiKeys.anthropic) {
    stored.apiKeys.anthropic = stored.apiKey;
    await ext.storage.local.set({ apiKeys: stored.apiKeys });
  }
  return stored;
}

async function readHttpError(res) {
  let detail = `HTTP ${res.status}`;
  try {
    const err = await res.json();
    detail = err?.error?.message || err?.message || detail;
  } catch (_) {
    /* giữ detail mặc định */
  }
  return detail;
}

// ---- Từng nhà cung cấp trả về chuỗi văn bản thô của model ----

async function callOpenAICompatible(url, apiKey, model, userPrompt, extraHeaders) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(extraHeaders || {})
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Phản hồi rỗng từ API.");
  return text;
}

// DeepSeek dùng API tương thích OpenAI nhưng nhận `max_tokens`.
async function callDeepSeek(apiKey, model, userPrompt) {
  const res = await fetch(PROVIDERS.deepseek.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Phản hồi rỗng từ API.");
  return text;
}

async function callGoogle(apiKey, model, userPrompt) {
  const url = `${PROVIDERS.google.url}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 2048 }
    })
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("");
  if (!text) throw new Error("Phản hồi rỗng từ API.");
  return text;
}

async function callAnthropic(apiKey, model, userPrompt) {
  const res = await fetch(PROVIDERS.anthropic.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("AI từ chối trả lời comment này. Hãy tự soạn tay hoặc bỏ qua.");
  }
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("Phản hồi rỗng từ API.");
  return text;
}

async function suggestReplies(payload) {
  const settings = await getSettings();
  const provider = PROVIDERS[settings.provider] ? settings.provider : DEFAULT_PROVIDER;
  const apiKey = settings.apiKeys?.[provider] || "";
  // Model đã lưu phải thuộc nhà cung cấp đang chọn, không thì dùng mặc định.
  const model = PROVIDERS[provider].models.includes(settings.model)
    ? settings.model
    : PROVIDERS[provider].defaultModel;

  if (!apiKey) {
    return {
      ok: false,
      error:
        "Chưa có API key cho nhà cung cấp đang chọn. Mở trang Cài đặt của extension để nhập."
    };
  }

  const userPrompt = buildUserPrompt(payload, settings);

  try {
    let text;
    switch (provider) {
      case "openai":
        text = await callOpenAICompatible(PROVIDERS.openai.url, apiKey, model, userPrompt);
        break;
      case "deepseek":
        text = await callDeepSeek(apiKey, model, userPrompt);
        break;
      case "google":
        text = await callGoogle(apiKey, model, userPrompt);
        break;
      case "anthropic":
        text = await callAnthropic(apiKey, model, userPrompt);
        break;
      default:
        throw new Error(`Nhà cung cấp không hỗ trợ: ${provider}`);
    }

    const parsed = extractJson(text);
    if (!Array.isArray(parsed.goi_y) || parsed.goi_y.length === 0) {
      throw new Error("Thiếu danh sách gợi ý.");
    }
    return { ok: true, result: parsed };
  } catch (e) {
    return { ok: false, error: `Gọi API thất bại: ${e.message}` };
  }
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "suggest") {
    suggestReplies(message.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // giữ kênh mở cho phản hồi bất đồng bộ
  }
  return false;
});
