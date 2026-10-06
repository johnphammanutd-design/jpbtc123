// Background script: nơi duy nhất gọi Claude API.
// Content script gửi message { type: "suggest", payload } → trả về danh sách gợi ý.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-5-5";

const ext = typeof browser !== "undefined" ? browser : chrome;

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
    apiKey: "",
    model: DEFAULT_MODEL,
    defaultTone: "",
    voiceProfile: ""
  });
  return stored;
}

async function suggestReplies(payload) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return {
      ok: false,
      error: "Chưa có API key. Mở trang Cài đặt của extension để nhập Claude API key."
    };
  }

  const body = {
    model: settings.model || DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    fallbacks: "default",
    messages: [{ role: "user", content: buildUserPrompt(payload, settings) }]
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-beta": "server-side-fallback-2026-07-01"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) detail = err.error.message;
    } catch (_) {
      /* giữ detail mặc định */
    }
    return { ok: false, error: `Gọi API thất bại: ${detail}` };
  }

  const data = await res.json();

  if (data.stop_reason === "refusal") {
    return {
      ok: false,
      error: "AI từ chối trả lời comment này. Hãy tự soạn tay hoặc bỏ qua."
    };
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  try {
    const parsed = extractJson(text);
    if (!Array.isArray(parsed.goi_y) || parsed.goi_y.length === 0) {
      throw new Error("Thiếu danh sách gợi ý.");
    }
    return { ok: true, result: parsed };
  } catch (e) {
    return { ok: false, error: `Không đọc được phản hồi của AI: ${e.message}` };
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
