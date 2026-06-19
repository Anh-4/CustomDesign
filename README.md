# Custom Design

Chỉnh **text / số / ảnh** trong một **design PNG hoàn chỉnh** bằng AI mà vẫn **giữ nguyên style, filter, hiệu ứng, bố cục** của design gốc — cho Kozmoz Studio (ECZ / Kozmoz / LO).

Cùng stack với `design-transfer` / `apparel-video`: Vite + React + TS + Tailwind + Electron, gọi AI image-edit qua **OpenRouter** hoặc **Google Gemini** (Nano Banana — mạnh nhất cho edit giữ-style).

## Luồng dùng (5 ô bên trái)

| Ô | Đầu vào | Vai trò |
|---|---------|---------|
| **1** | Design gốc (PNG) | **Bắt buộc.** Design hoàn chỉnh cần custom — AI giữ nguyên mọi chi tiết, chỉ thay phần được chỉ định |
| **2** | Text mới | Thay phần chữ trong design (giữ nguyên font/style/vị trí gốc) |
| **3** | Số mới | Thay phần số trong design (giữ nguyên style gốc) |
| **4** | Ảnh thay thế (PNG/JPG) | Thay ảnh có sẵn trong design — AI ghép vào đúng vị trí/khung gốc |
| **5** | Bảng màu (RGB) | Ép màu **chữ** và/hoặc **số** (bật/tắt riêng) khi AI tô sai — chọn bằng color picker hoặc nhập mã hex |

> Cần design ở ô 1 + **ít nhất một thay đổi** (ô 2, 3 hoặc 4). Output giữ nguyên tỉ lệ/khung của design gốc.

**Output:** 2 mẫu ảnh PNG để chọn — bấm vào ảnh để **zoom**, bấm **Tải PNG** để tải bản chất lượng cao (in ấn được).

## Hai chế độ

- **Sửa design** (mặc định): edit text/số/ảnh, giữ style gốc. Provider: **OpenRouter / Gemini** (Nano Banana) hoặc **xAI Grok** (`grok-imagine-image-quality` qua `/v1/images/edits`) — chọn ở popup "Đổi API Key". Dropdown model OpenRouter tải động theo key, lọc model xuất ảnh được.
- **Tạo mới (Grok)**: tạo ảnh **mới từ mô tả** bằng **xAI Grok** (`/v1/images/generations`, key tại https://console.x.ai). Thoáng hơn về logo/nhân vật/trademark, **không dùng design gốc** (text→image).

> Lưu ý: model `x-ai/grok-*` trên **OpenRouter** chỉ xuất text (không sửa ảnh). Grok sửa/tạo ảnh phải dùng **provider xAI trực tiếp** (key console.x.ai).

## Chạy nhanh (trình duyệt)

```bash
npm install
npm run dev        # mở http://127.0.0.1:5178
```

Lần đầu chạy app sẽ hỏi **API key** — chọn provider (OpenRouter/Gemini) và dán key. Key lưu trên máy (localStorage), không gửi đi đâu khác.

- OpenRouter key: https://openrouter.ai/keys
- Gemini key: https://aistudio.google.com/apikey

## Chạy bản desktop (Electron)

```bash
npm run electron:dev      # dev
npm run dist:win          # build file .exe portable -> release/
```

## Ghi chú

- Đổi provider/model ngay trong app (nút **Đổi API Key** + dropdown **Model AI**). Mặc định: 🍌 Nano Banana Pro.
- Muốn nhúng sẵn key cho team nội bộ: copy `.env.example` → `.env` và điền key.
- Bảng màu (ô 5) chỉ là "bảo hiểm" khi AI tô màu chữ/số lệch so với gốc — không bật thì AI tự giữ màu như design gốc.
