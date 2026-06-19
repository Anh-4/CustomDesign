export interface MediaItem {
  mediaId: string;
  base64: string;
  mimeType: string;
}

/** Trạng thái đầu vào panel trái (5 ô). */
export interface InputState {
  // Ô 1: design PNG hoàn chỉnh — ảnh GỐC cần custom (bắt buộc).
  designImage: MediaItem | null;
  // Ô 2: text mới để thay vào design (giữ nguyên font/style/vị trí gốc).
  newText: string;
  // Ô 3: số mới để thay vào design.
  newNumber: string;
  // Ô 4: ảnh thay thế (PNG/JPG) — thay vào vị trí ảnh có sẵn trong design.
  replaceImage: MediaItem | null;
  // Ô 5: bảng màu — ép màu chữ/số khi AI tô sai (mỗi cái bật/tắt độc lập).
  useTextColor: boolean;
  textColor: string;   // hex #rrggbb
  useNumberColor: boolean;
  numberColor: string; // hex #rrggbb
}

export interface GeneratedResult {
  id: string;
  mediaId: string;
  base64: string;
  mimeType: string;
  prompt: string;
}
