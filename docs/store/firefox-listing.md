# Firefox Add-ons (AMO) — nội dung đăng bản công khai

Copy từng khối vào đúng ô trên trang hồ sơ add-on. Phần nội dung để trong khối
code là đúng chữ cần dán. Chỗ `[YOUR CONTACT EMAIL]` hãy thay bằng email hỗ trợ
của bạn.

## Name (tối đa 50 ký tự)

```
AI Reply Assistant for YouTube Comments
```

## Add-on URL (slug)

```
ai-reply-assistant-youtube
```

## Summary (tối đa 250 ký tự)

```
Suggests natural, friendly replies to YouTube comments with AI. You pick a draft, edit it, and post it yourself — nothing is ever posted automatically. Bring your own API key (Claude, OpenAI, Gemini or DeepSeek).
```

## Description

```
Reply to YouTube comments faster, in a voice that sounds like you.

Click "Suggest reply" next to any comment and the add-on drafts three replies in different tones: a respectful counter-point, a light-hearted one, and a polite one. Each draft is written to invite a response, for example by asking a specific question about what the commenter said. You choose one, edit it, and post it yourself.

FEATURES
• Reply suggestions: three drafts per comment, with a short note on how to approach it.
• Psychology and law angle: an optional fourth draft that answers from a general psychology and legal-principles perspective, in plain words. It is general information, not professional advice, and never claims credentials. Can be switched off in Settings.
• Vietnamese translation: a "Translate" button next to each comment shows a Vietnamese translation right below it, and every drafted reply comes with a Vietnamese translation so you know exactly what you are about to post. Can be switched off in Settings.
• Scan comments: classify up to 30 visible comments (positive, fair criticism, misunderstanding, unsupported criticism, troll) so you know which ones deserve a reply first.
• Pinned comment ideas: three discussion starters for a pinned comment, based on the video title, description and existing comments.
• Audience and voice settings: choose the reply language (US English by default, Vietnamese, or automatic), describe your audience (for example, older viewers) and your channel's voice.
• Repeat protection: replies you recently used are remembered so new drafts do not sound the same.
• Cost estimator: see the approximate monthly cost of each supported AI model for your own usage.

NOTHING IS POSTED AUTOMATICALLY
The add-on only fills text into the reply box when you ask it to. You always read, edit and send the comment yourself.

BRING YOUR OWN API KEY
Works with Anthropic Claude, OpenAI, Google Gemini and DeepSeek. Enter your own API key in Settings. Your key is stored only in your browser.

PRIVACY
Nothing is sent until you click a button. Then the comment text, video title and description, and nearby comments are sent directly from your browser to the AI provider you selected, using your key. The developer runs no servers and receives no data. No analytics or tracking.

NOTES
• The add-on interface is currently in Vietnamese. Generated replies can be in English, Vietnamese, or the language of each comment.
• Works on youtube.com.
• Drafts from the psychology and law angle are general information, not professional or legal advice. Always check them before posting.
• Independent project, not affiliated with YouTube, Google, Anthropic, OpenAI or DeepSeek.
```

## Categories

`Social & Communication`

## Tags

`youtube`, `comments`, `ai`, `assistant`, `reply`

## Support email

`[YOUR CONTACT EMAIL]`

## Privacy policy

Dán toàn bộ nội dung file `docs/PRIVACY.md` vào ô "This add-on has a privacy
policy". Nhớ thay `[YOUR CONTACT EMAIL]`.

## License

Chọn theo ý bạn. Nếu không muốn mở mã nguồn, chọn "All Rights Reserved".

## Notes to Reviewer (ô ghi chú cho người duyệt)

```
How to test: the add-on needs the tester's own API key from one of the supported providers (Anthropic, OpenAI, Google Gemini or DeepSeek). Open the add-on Settings (about:addons > the add-on > Preferences, or the popup > "Mở cài đặt"), choose a provider, paste a key and Save. Then open any YouTube watch page with comments, and click "💬 Gợi ý trả lời" next to a comment. The floating buttons at the bottom right scan comments and suggest pinned comments.

The interface text is in Vietnamese; button meanings: "Gợi ý trả lời" = Suggest reply, "Quét comment trái chiều" = Scan comments, "Comment ghim" = Pinned comment, "Dịch" = Translate (shows a Vietnamese translation under the comment), "Mở cài đặt" = Open settings, "Lưu" = Save.

Data flow: nothing is sent until the user clicks a button. Then the selected comment, video title/description and some nearby comments go from the user's browser to the AI provider the user chose, with the user's own API key (host permissions are limited to those four API domains). The add-on has no servers, no analytics and downloads no remote code. data_collection_permissions declares websiteContent for that reason. The add-on never posts comments; it only fills the reply box on request.

The source is not minified or bundled. scripts/build.sh only copies the files and trims the manifest per browser, so the uploaded package is the plain source.
```
