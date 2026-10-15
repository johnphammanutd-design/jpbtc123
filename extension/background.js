// Background script: nơi duy nhất gọi API của nhà cung cấp AI.
// Nhận message từ content script:
//   { type: "suggest", payload }  → gợi ý 3 câu trả lời cho 1 comment
//   { type: "classify", payload } → phân loại hàng loạt comment (quét trái chiều)
//   { type: "markUsed", payload } → lưu câu đã dùng vào lịch sử (tránh lặp khuôn)
// Mặc định dùng Anthropic Claude (tận dụng API credit hàng tháng của tài khoản).

const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_PROVIDER = "anthropic";
const USED_HISTORY_LIMIT = 30;

// Giá tham khảo 10/2026 (USD / 1M token input|output) ghi trong README.
const PROVIDERS = {
  anthropic: {
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    url: "https://api.anthropic.com/v1/messages"
  },
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
  }
};

// Các model Anthropic chấp nhận server-side fallback (tự thử model dự phòng
// khi safety classifier từ chối nhầm request lành tính).
const ANTHROPIC_FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

const SUGGEST_SYSTEM_PROMPT = `Bạn là trợ lý soạn câu trả lời comment cho chủ kênh video tiếng Việt.
Nhiệm vụ: đọc một comment dưới video và đề xuất các phương án trả lời để CHỦ KÊNH tự chọn, tự sửa và tự đăng.
Mục tiêu quan trọng: câu trả lời phải khiến người được trả lời MUỐN ĐÁP LẠI — mở ra đối thoại tiếp, không phải chốt hạ cho họ im.

Kỹ thuật kéo tương tác (dùng tự nhiên, không lộ liễu):
- Kết mỗi câu trả lời bằng một MÓC TƯƠNG TÁC: câu hỏi mở nhắm đúng điểm họ quan tâm, lời mời chia sẻ trải nghiệm của họ, hoặc một thách thức thiện chí dựa trên lý lẽ ("bạn thử... rồi quay lại kể mình nghe").
- Trích hoặc nhại lại đúng từ ngữ của người comment để họ thấy được đọc kỹ — cảm giác được lắng nghe khiến người ta dễ trả lời lại nhất.
- Khơi tò mò: hé một chi tiết trong video mà họ có thể đã bỏ lỡ (kèm mốc thời gian nếu ngữ cảnh có), mời họ xem lại rồi cho ý kiến.
- Nếu không khí chung của các comment khác đang nghiêng về một phía, có thể nhắc khéo ("nhiều bạn ở dưới cũng nói...") để người đọc khác dễ nhảy vào thảo luận cùng.
- Câu hỏi phải CỤ THỂ (hỏi về chi tiết họ vừa nêu), không hỏi chung chung kiểu "bạn nghĩ sao?".

Quy tắc bắt buộc:
- Mỗi câu trả lời dài 1–3 câu, văn nói tự nhiên, đúng kiểu người Việt bình luận trên mạng (có thể dùng "mình", "bạn", emoji tiết chế).
- Phản biện phải dựa trên lý lẽ hoặc nội dung video được cung cấp. KHÔNG bịa thông tin, không hứa hẹn thay chủ kênh.
- KHÔNG công kích cá nhân, không miệt thị, không tục tĩu. Kéo tương tác bằng tò mò và lý lẽ, KHÔNG bằng chọc giận hay mỉa mai — comment làm người đọc nổi nóng sẽ hại kênh.
- Nếu được cung cấp danh sách câu đã dùng gần đây, tránh lặp lại khuôn câu và cách mở đầu của chúng.
- Nếu comment là troll/khiêu khích thuần túy, hãy nói rõ trong phân loại và khuyên bỏ qua hoặc chỉ đáp một câu hóa giải nhẹ nhàng (troll không đáng được kéo vào đối thoại).
- Nếu comment là góp ý có lý, phương án đầu tiên phải là ghi nhận góp ý một cách thiện chí, rồi hỏi sâu thêm về góp ý đó.

Ngôn ngữ: viết các câu trả lời (noi_dung) bằng đúng ngôn ngữ được yêu cầu trong phần ngữ cảnh;
riêng "phan_loai" và "nhan_xet" luôn bằng tiếng Việt để chủ kênh đọc nhanh.

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

// Quy tắc văn phong khi trả lời bằng tiếng Anh Mỹ cho khán giả lớn tuổi.
const EN_US_SENIOR_STYLE = `Viết các câu trả lời bằng TIẾNG ANH MỸ tự nhiên, phù hợp người đọc lớn tuổi (60+):
- Giọng ấm áp, chân thành, tôn trọng — kiểu nói chuyện lịch thiệp của người Mỹ ("I appreciate you watching", "Thanks so much for sharing that").
- Câu ngắn, từ ngữ đơn giản rõ ràng; KHÔNG dùng tiếng lóng internet hay viết tắt (lol, tbh, ngl, fr...), không mỉa mai kiểu Gen Z.
- Tối đa 1 emoji đơn giản (🙂, 👍, ❤️) hoặc không dùng.
- Móc tương tác hợp nhóm tuổi này: mời họ kể kỷ niệm hoặc kinh nghiệm của chính họ ("I'd love to hear...", "Did you ever..."), hỏi ý kiến của họ một cách trân trọng — người lớn tuổi rất thích được hỏi về trải nghiệm sống.
- Xưng hô thân thiện mức vừa phải, không suồng sã.`;

const CLASSIFY_SYSTEM_PROMPT = `Bạn là bộ phân loại comment cho chủ kênh video tiếng Việt.
Với mỗi comment trong danh sách, xếp vào đúng một loại:
- "tich_cuc": khen, ủng hộ, trung tính vô hại
- "gop_y_co_ly": chê/góp ý nhưng có lý lẽ đáng ghi nhận
- "hieu_sai_noi_dung": phản đối do hiểu sai hoặc chưa xem kỹ nội dung
- "che_vo_can_cu": chê bai không đưa ra căn cứ
- "troll": khiêu khích, gây hấn thuần túy

Luôn trả lời bằng đúng một khối JSON (không kèm văn bản nào khác) theo mẫu:
{ "ket_qua": [ { "id": <số id của comment>, "phan_loai": "<loại>" } ] }
Phải trả kết quả cho đủ mọi id được đưa vào.`;

function languageInstruction(settings) {
  switch (settings.replyLanguage) {
    case "en-US":
      return EN_US_SENIOR_STYLE_APPLIES(settings)
        ? EN_US_SENIOR_STYLE
        : "Viết các câu trả lời bằng tiếng Anh Mỹ tự nhiên.";
    case "vi":
      return "Viết các câu trả lời bằng tiếng Việt.";
    default: // auto
      return "Viết các câu trả lời bằng đúng ngôn ngữ của comment cần trả lời.";
  }
}

// Áp dụng bộ quy tắc văn phong người lớn tuổi khi hồ sơ khán giả nhắc đến
// người già/lớn tuổi/60+, hoặc khi không có hồ sơ (mặc định của kênh này).
function EN_US_SENIOR_STYLE_APPLIES(settings) {
  const a = (settings.audienceProfile || "").toLowerCase();
  return (
    a === "" ||
    a.includes("60") ||
    a.includes("lớn tuổi") ||
    a.includes("người già") ||
    a.includes("senior") ||
    a.includes("elder")
  );
}

function buildSuggestPrompt(payload, settings, usedReplies) {
  const parts = [];
  parts.push(`Tiêu đề video: ${payload.videoTitle || "(không rõ)"}`);
  if (payload.videoDescription) {
    parts.push(`Mô tả/ngữ cảnh video: ${payload.videoDescription.slice(0, 1500)}`);
  }
  parts.push(languageInstruction(settings));
  if (settings.audienceProfile) {
    parts.push(`Khán giả của kênh: ${settings.audienceProfile}`);
  }
  if (settings.voiceProfile) {
    parts.push(`Giọng của kênh (viết đúng chất này): ${settings.voiceProfile}`);
  }
  if (settings.defaultTone) {
    parts.push(`Giọng ưu tiên của chủ kênh: ${settings.defaultTone}`);
  }
  if (Array.isArray(payload.otherComments) && payload.otherComments.length > 0) {
    parts.push(
      "Các comment khác dưới video (để nắm không khí thảo luận chung):\n- " +
        payload.otherComments.join("\n- ")
    );
  }
  if (payload.parentComment) {
    parts.push(`Comment gốc của thread (comment cần trả lời là reply trong thread này): ${payload.parentComment}`);
  }
  if (usedReplies.length > 0) {
    parts.push(
      "Các câu chủ kênh đã dùng gần đây (tránh lặp khuôn câu):\n- " +
        usedReplies.slice(0, 10).join("\n- ")
    );
  }
  parts.push(`Comment cần trả lời, của "${payload.author || "người xem"}": ${payload.commentText}`);
  parts.push("Hãy phân loại comment và đề xuất 3 phương án trả lời theo đúng định dạng JSON.");
  return parts.join("\n\n");
}

function buildClassifyPrompt(payload) {
  const lines = payload.comments.map(
    (c) => `[${c.id}] ${c.author ? c.author + ": " : ""}${c.text.slice(0, 500)}`
  );
  return [
    `Tiêu đề video: ${payload.videoTitle || "(không rõ)"}`,
    `Danh sách comment:\n${lines.join("\n")}`,
    "Phân loại từng comment theo đúng định dạng JSON."
  ].join("\n\n");
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
    replyLanguage: "en-US",
    audienceProfile: "Người Mỹ lớn tuổi, trên 60 tuổi",
    usedReplies: [],
    apiKey: "" // khóa Anthropic từ phiên bản đầu của extension
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

// ---- Từng nhà cung cấp: nhận (apiKey, model, systemPrompt, userPrompt) → text ----

async function callOpenAI(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch(PROVIDERS.openai.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
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
async function callDeepSeek(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch(PROVIDERS.deepseek.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
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

async function callGoogle(apiKey, model, systemPrompt, userPrompt) {
  const url = `${PROVIDERS.google.url}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 4096 }
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

async function callAnthropic(apiKey, model, systemPrompt, userPrompt) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    // Bắt buộc khi gọi API Anthropic trực tiếp từ trình duyệt (CORS).
    // An toàn ở đây vì key do chính người dùng nhập và chỉ lưu trên máy họ.
    "anthropic-dangerous-direct-browser-access": "true"
  };
  const body = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  };
  if (ANTHROPIC_FALLBACK_MODELS.includes(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }
  const res = await fetch(PROVIDERS.anthropic.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("AI từ chối xử lý nội dung này. Hãy tự soạn tay hoặc bỏ qua.");
  }
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("Phản hồi rỗng từ API.");
  return text;
}

const CALLERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
  deepseek: callDeepSeek
};

async function callModel(settings, systemPrompt, userPrompt) {
  const provider = PROVIDERS[settings.provider] ? settings.provider : DEFAULT_PROVIDER;
  const apiKey = settings.apiKeys?.[provider] || "";
  if (!apiKey) {
    throw new Error(
      "Chưa có API key cho nhà cung cấp đang chọn. Mở trang Cài đặt của extension để nhập."
    );
  }
  // Model đã lưu phải thuộc nhà cung cấp đang chọn, không thì dùng mặc định.
  const model = PROVIDERS[provider].models.includes(settings.model)
    ? settings.model
    : PROVIDERS[provider].defaultModel;
  return CALLERS[provider](apiKey, model, systemPrompt, userPrompt);
}

// ---- Các tác vụ ----

async function suggestReplies(payload) {
  const settings = await getSettings();
  const userPrompt = buildSuggestPrompt(payload, settings, settings.usedReplies || []);
  const text = await callModel(settings, SUGGEST_SYSTEM_PROMPT, userPrompt);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.goi_y) || parsed.goi_y.length === 0) {
    throw new Error("Thiếu danh sách gợi ý.");
  }
  return { ok: true, result: parsed };
}

async function classifyComments(payload) {
  if (!Array.isArray(payload.comments) || payload.comments.length === 0) {
    throw new Error("Không có comment nào để quét.");
  }
  const settings = await getSettings();
  const text = await callModel(settings, CLASSIFY_SYSTEM_PROMPT, buildClassifyPrompt(payload));
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.ket_qua)) {
    throw new Error("Thiếu danh sách kết quả phân loại.");
  }
  return { ok: true, result: parsed.ket_qua };
}

async function markUsed(payload) {
  if (!payload?.text) return { ok: true };
  const { usedReplies } = await ext.storage.local.get({ usedReplies: [] });
  const next = [payload.text, ...usedReplies.filter((t) => t !== payload.text)].slice(
    0,
    USED_HISTORY_LIMIT
  );
  await ext.storage.local.set({ usedReplies: next });
  return { ok: true };
}

const HANDLERS = {
  suggest: suggestReplies,
  classify: classifyComments,
  markUsed
};

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  handler(message.payload)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // giữ kênh mở cho phản hồi bất đồng bộ
});
