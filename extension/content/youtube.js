// Content script chạy trên youtube.com:
// - Gắn nút "Gợi ý trả lời" vào mỗi comment.
// - Bấm nút → gửi comment + ngữ cảnh video cho background → hiện panel gợi ý.
// - Người dùng chọn: copy hoặc điền sẵn vào ô trả lời (không bao giờ tự đăng).

(() => {
  const ext = typeof browser !== "undefined" ? browser : chrome;
  const BTN_CLASS = "tlpb-suggest-btn";
  const PANEL_CLASS = "tlpb-panel";

  const TONE_LABELS = {
    phan_bien: "Phản biện",
    hai_huoc: "Hài hước",
    lich_su: "Lịch sự"
  };

  const CLASS_LABELS = {
    tich_cuc: "Tích cực",
    gop_y_co_ly: "Góp ý có lý",
    hieu_sai_noi_dung: "Hiểu sai nội dung",
    che_vo_can_cu: "Chê vô căn cứ",
    troll: "Troll / khiêu khích"
  };

  // Các loại cần ưu tiên trả lời khi quét.
  const NEGATIVE_CLASSES = ["gop_y_co_ly", "hieu_sai_noi_dung", "che_vo_can_cu", "troll"];

  function getVideoContext() {
    const titleEl =
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector("h1.title yt-formatted-string");
    const descEl = document.querySelector(
      "ytd-text-inline-expander #attributed-snippet-text, ytd-text-inline-expander yt-attributed-string"
    );
    return {
      videoTitle: titleEl ? titleEl.textContent.trim() : document.title,
      videoDescription: descEl ? descEl.textContent.trim() : ""
    };
  }

  function getCommentData(commentEl) {
    const textEl = commentEl.querySelector("#content-text");
    const authorEl = commentEl.querySelector("#author-text, #header-author a");
    return {
      commentText: textEl ? textEl.textContent.trim() : "",
      author: authorEl ? authorEl.textContent.trim().replace(/^@/, "") : ""
    };
  }

  function removePanel(commentEl) {
    const old = commentEl.querySelector(`.${PANEL_CLASS}`);
    if (old) old.remove();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Điền văn bản vào ô trả lời của chính comment đó (best-effort, tùy DOM YouTube).
  async function fillReplyBox(commentEl, text) {
    const replyBtn = commentEl.querySelector(
      "#reply-button-end button, ytd-button-renderer#reply-button-end button"
    );
    if (replyBtn) replyBtn.click();

    // Chờ ô nhập xuất hiện sau khi bấm "Phản hồi".
    const scope = commentEl.closest("ytd-comment-thread-renderer") || commentEl;
    let box = null;
    for (let i = 0; i < 20; i++) {
      box = scope.querySelector("#contenteditable-root[contenteditable='true']");
      if (box) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!box) return false;

    box.focus();
    box.textContent = text;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    return true;
  }

  // Dòng bản dịch tiếng Việt nhỏ, nghiêng, đặt dưới một đoạn văn bản gốc.
  function viLine(text) {
    return el("div", "tlpb-vi", `🌐 ${text}`);
  }

  // Hiện bản dịch tiếng Việt ngay dưới nội dung comment trên trang.
  // Trả về false nếu không có bản dịch (comment vốn đã là tiếng Việt).
  function setCommentTranslation(commentEl, text) {
    commentEl.querySelector(".tlpb-comment-vi")?.remove();
    if (!text) return false;
    const textEl = commentEl.querySelector("#content-text");
    if (!textEl) return false;
    const box = el("div", "tlpb-comment-vi", `🌐 ${text}`);
    (textEl.closest("#expander") || textEl).insertAdjacentElement("afterend", box);
    return true;
  }

  function renderSuggestions(commentEl, result) {
    removePanel(commentEl);
    setCommentTranslation(commentEl, result.ban_dich_comment);
    const panel = el("div", PANEL_CLASS);

    const header = el("div", "tlpb-header");
    header.appendChild(
      el("span", "tlpb-class", CLASS_LABELS[result.phan_loai] || "Comment")
    );
    const closeBtn = el("button", "tlpb-close", "✕");
    closeBtn.addEventListener("click", () => panel.remove());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (result.nhan_xet) {
      panel.appendChild(el("div", "tlpb-note", result.nhan_xet));
    }

    for (const item of result.goi_y) {
      const row = el("div", "tlpb-suggestion");
      row.appendChild(
        el("div", "tlpb-tone", TONE_LABELS[item.giong] || item.giong || "Gợi ý")
      );
      row.appendChild(el("div", "tlpb-text", item.noi_dung));
      if (item.ban_dich) row.appendChild(viLine(item.ban_dich));

      const actions = el("div", "tlpb-actions");
      // Ghi lại câu người dùng chọn để các lần gợi ý sau không lặp khuôn câu.
      const rememberUsed = () => {
        ext.runtime.sendMessage({ type: "markUsed", payload: { text: item.noi_dung } });
      };
      const copyBtn = el("button", "tlpb-action", "Chép");
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(item.noi_dung);
        rememberUsed();
        copyBtn.textContent = "Đã chép ✓";
        setTimeout(() => (copyBtn.textContent = "Chép"), 1500);
      });
      const fillBtn = el("button", "tlpb-action tlpb-fill", "Điền vào ô trả lời");
      fillBtn.addEventListener("click", async () => {
        const ok = await fillReplyBox(commentEl, item.noi_dung);
        if (ok) rememberUsed();
        fillBtn.textContent = ok ? "Đã điền — sửa rồi tự đăng nhé" : "Không tìm thấy ô trả lời";
        setTimeout(
          () => (fillBtn.textContent = "Điền vào ô trả lời"),
          2500
        );
      });
      actions.appendChild(copyBtn);
      actions.appendChild(fillBtn);
      row.appendChild(actions);
      panel.appendChild(row);
    }

    panel.appendChild(
      el(
        "div",
        "tlpb-disclaimer",
        "AI chỉ gợi ý — đọc kỹ, sửa theo ý bạn rồi tự bấm đăng."
      )
    );

    commentEl.appendChild(panel);
  }

  function renderError(commentEl, message) {
    removePanel(commentEl);
    const panel = el("div", `${PANEL_CLASS} tlpb-error`);
    panel.appendChild(el("div", "tlpb-note", message));
    const closeBtn = el("button", "tlpb-close", "✕");
    closeBtn.addEventListener("click", () => panel.remove());
    panel.appendChild(closeBtn);
    commentEl.appendChild(panel);
  }

  // Gom các comment khác dưới video làm ngữ cảnh (không khí thảo luận chung),
  // bỏ qua chính comment đang được trả lời.
  function getOtherComments(currentEl, limit = 8) {
    const others = [];
    for (const el2 of allCommentEls()) {
      if (el2 === currentEl || others.length >= limit) continue;
      const data = getCommentData(el2);
      if (data.commentText) {
        others.push(
          `${data.author ? data.author + ": " : ""}${data.commentText.slice(0, 200)}`
        );
      }
    }
    return others;
  }

  // Nếu comment là reply trong một thread, lấy comment gốc của thread đó.
  function getParentComment(commentEl) {
    const thread = commentEl.closest("ytd-comment-thread-renderer");
    if (!thread) return "";
    const rootEl = thread.querySelector("ytd-comment-view-model, ytd-comment-renderer");
    if (!rootEl || rootEl === commentEl) return "";
    const data = getCommentData(rootEl);
    return data.commentText
      ? `${data.author ? data.author + ": " : ""}${data.commentText.slice(0, 300)}`
      : "";
  }

  async function onSuggestClick(commentEl, button) {
    const data = getCommentData(commentEl);
    if (!data.commentText) {
      renderError(commentEl, "Không đọc được nội dung comment này.");
      return;
    }
    button.disabled = true;
    button.textContent = "Đang nghĩ…";
    try {
      const response = await ext.runtime.sendMessage({
        type: "suggest",
        payload: {
          ...data,
          ...getVideoContext(),
          otherComments: getOtherComments(commentEl),
          parentComment: getParentComment(commentEl)
        }
      });
      if (response?.ok) {
        renderSuggestions(commentEl, response.result);
      } else {
        renderError(commentEl, response?.error || "Lỗi không xác định.");
      }
    } catch (e) {
      renderError(commentEl, `Lỗi: ${e.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "💬 Gợi ý trả lời";
    }
  }

  function injectButton(commentEl) {
    if (commentEl.querySelector(`.${BTN_CLASS}`)) return;
    const toolbar = commentEl.querySelector(
      "ytd-comment-engagement-bar #toolbar, #action-buttons, #toolbar"
    );
    if (!toolbar) return;

    const button = el("button", BTN_CLASS, "💬 Gợi ý trả lời");
    button.type = "button";
    button.addEventListener("click", () => onSuggestClick(commentEl, button));
    toolbar.appendChild(button);

    const translateBtn = el("button", `${BTN_CLASS} tlpb-translate-btn`, "🌐 Dịch");
    translateBtn.type = "button";
    translateBtn.addEventListener("click", () => onTranslateClick(commentEl, translateBtn));
    toolbar.appendChild(translateBtn);
  }

  // Bấm lần một: dịch comment sang tiếng Việt và hiện ngay dưới comment.
  // Bấm lần hai: ẩn bản dịch.
  async function onTranslateClick(commentEl, button) {
    if (commentEl.querySelector(".tlpb-comment-vi")) {
      commentEl.querySelector(".tlpb-comment-vi").remove();
      return;
    }
    const data = getCommentData(commentEl);
    if (!data.commentText) {
      showToast("Không đọc được nội dung comment này.");
      return;
    }
    button.disabled = true;
    button.textContent = "Đang dịch…";
    try {
      const response = await ext.runtime.sendMessage({
        type: "translate",
        payload: { text: data.commentText, author: data.author }
      });
      if (!response?.ok) {
        showToast(response?.error || "Dịch thất bại.");
      } else if (!setCommentTranslation(commentEl, response.result)) {
        showToast("Comment này đã bằng tiếng Việt.");
      }
    } catch (e) {
      showToast(`Lỗi khi dịch: ${e.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "🌐 Dịch";
    }
  }

  // ---- Quét & đánh dấu comment trái chiều ----

  const SCAN_LIMIT = 30;

  function allCommentEls() {
    return Array.from(
      document.querySelectorAll("ytd-comment-view-model, ytd-comment-renderer")
    );
  }

  function setBadge(commentEl, phanLoai) {
    let badge = commentEl.querySelector(":scope .tlpb-badge");
    if (!badge) {
      const header = commentEl.querySelector("#header-author") || commentEl;
      badge = el("span", "tlpb-badge");
      header.appendChild(badge);
    }
    badge.textContent = CLASS_LABELS[phanLoai] || phanLoai;
    badge.dataset.tlpbClass = phanLoai;
    commentEl.classList.toggle(
      "tlpb-negative",
      NEGATIVE_CLASSES.includes(phanLoai)
    );
  }

  function showToast(message) {
    let toast = document.querySelector(".tlpb-toast");
    if (!toast) {
      toast = el("div", "tlpb-toast");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("tlpb-toast-visible");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(
      () => toast.classList.remove("tlpb-toast-visible"),
      4000
    );
  }

  async function runScan(scanBtn) {
    const els = allCommentEls().slice(0, SCAN_LIMIT);
    const comments = [];
    els.forEach((commentEl, i) => {
      const data = getCommentData(commentEl);
      if (data.commentText) {
        commentEl.dataset.tlpbScanId = String(i);
        comments.push({ id: i, text: data.commentText, author: data.author });
      }
    });
    if (comments.length === 0) {
      showToast("Chưa thấy comment nào — kéo xuống phần bình luận rồi quét lại.");
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = `Đang quét ${comments.length} comment…`;
    try {
      const response = await ext.runtime.sendMessage({
        type: "classify",
        payload: { comments, videoTitle: getVideoContext().videoTitle }
      });
      if (!response?.ok) {
        showToast(response?.error || "Quét thất bại.");
        return;
      }
      let negative = 0;
      for (const item of response.result) {
        const commentEl = document.querySelector(
          `[data-tlpb-scan-id="${CSS.escape(String(item.id))}"]`
        );
        if (!commentEl) continue;
        setBadge(commentEl, item.phan_loai);
        if (item.ban_dich) setCommentTranslation(commentEl, item.ban_dich);
        if (NEGATIVE_CLASSES.includes(item.phan_loai)) negative++;
      }
      showToast(
        negative > 0
          ? `Đã quét ${comments.length} comment — ${negative} comment trái chiều được đánh dấu đỏ, nên trả lời trước.`
          : `Đã quét ${comments.length} comment — không thấy comment trái chiều. 👍`
      );
    } catch (e) {
      showToast(`Lỗi khi quét: ${e.message}`);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "🔍 Quét comment trái chiều";
    }
  }

  // ---- Comment ghim mồi thảo luận ----

  const PINNED_KIEU_LABELS = {
    thach_thuc_quan_diem: "Thách thức quan điểm",
    moi_ke_ky_niem: "Mời kể kỷ niệm",
    khoang_trong_to_mo: "Khơi tò mò"
  };

  function renderPinnedPanel(suggestions) {
    document.querySelector(".tlpb-pinned-panel")?.remove();
    const panel = el("div", "tlpb-pinned-panel");

    const header = el("div", "tlpb-header");
    header.appendChild(el("span", "tlpb-class", "📌 Gợi ý comment ghim"));
    const closeBtn = el("button", "tlpb-close", "✕");
    closeBtn.addEventListener("click", () => panel.remove());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    for (const item of suggestions) {
      const row = el("div", "tlpb-suggestion");
      row.appendChild(
        el("div", "tlpb-tone", PINNED_KIEU_LABELS[item.kieu] || item.kieu || "Gợi ý")
      );
      row.appendChild(el("div", "tlpb-text", item.noi_dung));
      if (item.ban_dich) row.appendChild(viLine(item.ban_dich));
      const actions = el("div", "tlpb-actions");
      const copyBtn = el("button", "tlpb-action", "Chép");
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(item.noi_dung);
        copyBtn.textContent = "Đã chép ✓";
        setTimeout(() => (copyBtn.textContent = "Chép"), 1500);
      });
      actions.appendChild(copyBtn);
      row.appendChild(actions);
      panel.appendChild(row);
    }

    panel.appendChild(
      el(
        "div",
        "tlpb-disclaimer",
        "Dán vào ô bình luận bằng tài khoản kênh của bạn, đăng rồi bấm Ghim (⋮ → Pin)."
      )
    );
    document.body.appendChild(panel);
  }

  async function runPinned(btn) {
    btn.disabled = true;
    btn.textContent = "Đang nghĩ…";
    try {
      const response = await ext.runtime.sendMessage({
        type: "pinned",
        payload: { ...getVideoContext(), otherComments: getOtherComments(null, 12) }
      });
      if (response?.ok) {
        renderPinnedPanel(response.result);
      } else {
        showToast(response?.error || "Không tạo được gợi ý comment ghim.");
      }
    } catch (e) {
      showToast(`Lỗi: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "📌 Comment ghim";
    }
  }

  function ensurePinnedButton() {
    const hasComments = document.querySelector("ytd-comments#comments");
    let btn = document.querySelector(".tlpb-pinned-btn");
    if (!hasComments) {
      if (btn) btn.remove();
      return;
    }
    if (btn) return;
    btn = el("button", "tlpb-scan-btn tlpb-pinned-btn", "📌 Comment ghim");
    btn.type = "button";
    btn.addEventListener("click", () => runPinned(btn));
    document.body.appendChild(btn);
  }

  function ensureScanButton() {
    // Chỉ hiện khi trang có khu bình luận (trang xem video).
    const hasComments = document.querySelector("ytd-comments#comments");
    let scanBtn = document.querySelector(".tlpb-scan-btn");
    if (!hasComments) {
      if (scanBtn) scanBtn.remove();
      return;
    }
    if (scanBtn) return;
    scanBtn = el("button", "tlpb-scan-btn", "🔍 Quét comment trái chiều");
    scanBtn.type = "button";
    scanBtn.addEventListener("click", () => runScan(scanBtn));
    document.body.appendChild(scanBtn);
  }

  function scanComments() {
    // YouTube dùng ytd-comment-view-model (mới) hoặc ytd-comment-renderer (cũ).
    allCommentEls().forEach(injectButton);
    ensureScanButton();
    ensurePinnedButton();
  }

  const observer = new MutationObserver(() => {
    if (scanComments._scheduled) return;
    scanComments._scheduled = true;
    requestAnimationFrame(() => {
      scanComments._scheduled = false;
      scanComments();
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanComments();
})();
