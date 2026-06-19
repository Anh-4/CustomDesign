/**
 * flow-sdk (adapter) — lõi gọi AI để app chạy độc lập (web/.exe).
 * Sinh/chỉnh ảnh QUA NHIỀU PROVIDER (OpenRouter hoặc Google Gemini trực tiếp), chọn ở dropdown.
 *   - Flow.media.select   → mở hộp chọn file ảnh, trả {mediaId, base64, mimeType}
 *   - Flow.generate.image → gọi provider đã chọn chỉnh ảnh từ prompt + ảnh tham chiếu + model
 *   - Flow.download       → tải ảnh về máy
 *
 * App này gửi 1–2 ảnh tham chiếu (design gốc + ảnh thay thế) theo đúng thứ tự truyền vào;
 * cả 2 provider đều nhận mảng ảnh theo đúng thứ tự đó.
 */

export interface ImageModel { id: string; label: string }
export const CUSTOM_MODEL_ID = '__custom__';

// Nhà cung cấp AI hỗ trợ. Mỗi provider có API key + danh sách model riêng.
// 'xai' chỉ dùng cho chế độ TẠO MỚI (text->image, Grok) — không edit được design gốc.
export type Provider = 'openrouter' | 'gemini' | 'xai';
export interface ProviderInfo {
  id: Provider;
  label: string;
  storageKey: string; // key lưu trong localStorage
  envKey: string;     // tên biến env nhúng lúc build (team nội bộ)
  keyUrl: string;     // trang lấy API key
}
export const PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', label: 'OpenRouter',    storageKey: 'OPENROUTER_API_KEY', envKey: 'VITE_OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'gemini',     label: 'Google Gemini', storageKey: 'GEMINI_API_KEY',     envKey: 'VITE_GEMINI_API_KEY',     keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'xai',        label: 'xAI Grok',      storageKey: 'XAI_API_KEY',        envKey: 'VITE_XAI_API_KEY',        keyUrl: 'https://console.x.ai' },
];
export const DEFAULT_PROVIDER: Provider = 'openrouter';

// Provider dùng cho chế độ EDIT (nhận ảnh tham chiếu để sửa). xAI Grok không edit được.
export const EDIT_PROVIDERS: Provider[] = ['openrouter', 'gemini'];

export const getProviderInfo = (p: Provider): ProviderInfo =>
  PROVIDERS.find((x) => x.id === p) ?? PROVIDERS[0];

// Model ảnh theo từng provider (slug đúng theo từng nền tảng).
// Nano Banana (Gemini image) là model mạnh nhất cho việc "chỉnh chi tiết mà giữ nguyên style" -> để đầu danh sách.
export const MODELS_BY_PROVIDER: Record<Provider, ImageModel[]> = {
  openrouter: [
    { id: 'google/gemini-3-pro-image-preview', label: '🍌 Nano Banana Pro' },
    { id: 'google/gemini-2.5-flash-image',     label: '🍌 Nano Banana / Flash' },
    { id: 'openai/gpt-5.4-image-2',            label: 'GPT Image (OpenAI)' },
    { id: 'bytedance-seed/seedream-4.5',       label: 'Seedream 4.5 (ByteDance)' },
  ],
  gemini: [
    { id: 'gemini-3-pro-image-preview', label: '🍌 Nano Banana Pro' },
    { id: 'gemini-2.5-flash-image',     label: '🍌 Nano Banana / Flash' },
  ],
  // xAI Grok — chỉ TẠO ẢNH MỚI từ mô tả (không nhận ảnh tham chiếu để edit).
  xai: [
    { id: 'grok-2-image-1212', label: 'Grok 2 Image (xAI)' },
  ],
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Tải danh sách model SINH/CHỈNH ẢNH mà OpenRouter hỗ trợ (output_modalities có 'image').
 * App này chỉ edit ảnh nên lọc bỏ các model text-only (chọn cũng không ra ảnh).
 * key: truyền vào để gắn Authorization (catalog vốn public, key chỉ để cá nhân hoá nếu có).
 */
export async function fetchOpenRouterImageModels(key?: string): Promise<ImageModel[]> {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!res.ok) {
    let msg = `OpenRouter lỗi ${res.status} khi tải danh sách model`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  const list: any[] = data?.data ?? [];

  const isImageOut = (m: any) =>
    Array.isArray(m?.architecture?.output_modalities) && m.architecture.output_modalities.includes('image');

  const imageModels = list
    .filter(isImageOut)
    .map((m) => ({ id: String(m.id), label: String(m.name || m.id) }));

  // Ưu tiên các model có 'image' trong id (gemini image/nano banana, gpt image...) lên đầu, còn lại A→Z.
  imageModels.sort((a, b) => {
    const pa = /image|banana/i.test(a.id) ? 0 : 1;
    const pb = /image|banana/i.test(b.id) ? 0 : 1;
    return pa !== pb ? pa - pb : a.label.localeCompare(b.label);
  });

  // Model Grok/xAI: hiển thị theo yêu cầu, nhưng trên OpenRouter chúng CHỈ xuất text (không tạo/sửa
  // ảnh) -> gắn nhãn rõ để tránh nhầm. Muốn Grok tạo ảnh thật thì dùng chế độ "Tạo mới" (key xAI).
  const grokModels = list
    .filter((m) => /grok|x-ai|xai/i.test(String(m.id)) && !isImageOut(m))
    .map((m) => ({ id: String(m.id), label: `${String(m.name || m.id)} ⚠️ chỉ xuất text` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...imageModels, ...grokModels];
}
const geminiUrl = (model: string, key: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
const XAI_IMAGE_URL = 'https://api.x.ai/v1/images/generations';

type MediaResult = { mediaId: string; base64: string; mimeType: string };

// Registry: ánh xạ mediaId -> dữ liệu ảnh, để generate.image lấy lại ảnh tham chiếu.
const registry = new Map<string, { base64: string; mimeType: string }>();

const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/** Lưu ảnh kết quả vào registry và trả về MediaResult. */
function storeResult(mimeType: string, base64: string): MediaResult {
  const mediaId = uid();
  registry.set(mediaId, { base64, mimeType });
  return { mediaId, base64, mimeType };
}

/** Lấy API key theo provider: ưu tiên key nhúng lúc build -> key người dùng đã lưu (popup). */
function getApiKey(provider: Provider): string {
  const info = getProviderInfo(provider);
  const envKey = (import.meta as any).env?.[info.envKey] as string | undefined;
  if (envKey && envKey.trim()) return envKey.trim();

  const key = (localStorage.getItem(info.storageKey) || '').trim();
  if (!key) throw new Error(`Chưa có ${info.label} API key — bấm 'Đổi API Key' ở góc dưới để nhập.`);
  return key;
}

/** Mở hộp chọn file ảnh của hệ điều hành, đọc thành base64. */
function selectImageFile(): Promise<MediaResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('Không có file nào được chọn'));
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] || '';
        const mediaId = uid();
        registry.set(mediaId, { base64, mimeType: file.type });
        resolve({ mediaId, base64, mimeType: file.type });
      };
      reader.onerror = () => reject(reader.error || new Error('Lỗi đọc file'));
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

type GenOpts = {
  prompt: string;
  model: string;
  referenceImageMediaIds?: string[];
  aspectRatio?: string;
};

/** Sinh ảnh qua OpenRouter (chat-completions, modalities image). */
async function generateWithOpenRouter(opts: GenOpts, key: string): Promise<MediaResult> {
  const content: any[] = [{ type: 'text', text: opts.prompt }];
  for (const id of opts.referenceImageMediaIds ?? []) {
    const m = registry.get(id);
    if (m) content.push({ type: 'image_url', image_url: { url: `data:${m.mimeType};base64,${m.base64}` } });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Custom Design AI',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
      ...(opts.aspectRatio ? { image_config: { aspect_ratio: opts.aspectRatio } } : {}),
    }),
  });

  if (!res.ok) {
    let msg = `OpenRouter lỗi ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  const url: string | undefined = message?.images?.[0]?.image_url?.url;
  const parsed = url ? /^data:([^;]+);base64,(.*)$/.exec(url) : null;
  if (parsed) return storeResult(parsed[1], parsed[2]);

  // Không có ảnh -> lấy text (thường là lý do từ chối/an toàn) làm thông báo lỗi.
  const txt = typeof message?.content === 'string' ? message.content : '';
  throw new Error(txt || 'OpenRouter không trả về ảnh. Thử lại, đổi mô tả hoặc đổi model.');
}

/** Sinh ảnh qua Google Gemini API trực tiếp (generateContent). */
async function generateWithGemini(opts: GenOpts, key: string): Promise<MediaResult> {
  const parts: any[] = [{ text: opts.prompt }];
  for (const id of opts.referenceImageMediaIds ?? []) {
    const m = registry.get(id);
    if (m) parts.push({ inline_data: { mime_type: m.mimeType, data: m.base64 } });
  }

  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(opts.aspectRatio ? { imageConfig: { aspectRatio: opts.aspectRatio } } : {}),
    },
  };

  const res = await fetch(geminiUrl(opts.model, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Gemini lỗi ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  const partsOut: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  for (const p of partsOut) {
    const inline = p?.inlineData ?? p?.inline_data;
    if (inline?.data) return storeResult(inline.mimeType ?? inline.mime_type ?? 'image/png', inline.data);
  }

  // Không có ảnh -> ghép text trả về (lý do từ chối/an toàn) làm thông báo lỗi.
  const txt = partsOut.map((p) => p?.text).filter(Boolean).join(' ');
  throw new Error(txt || 'Gemini không trả về ảnh. Thử lại, đổi mô tả hoặc đổi model.');
}

/**
 * Tạo ảnh MỚI từ mô tả qua xAI Grok (api.x.ai /images/generations).
 * Lưu ý: API này KHÔNG nhận ảnh tham chiếu để edit, KHÔNG có tham số tỉ lệ/size
 * -> chỉ dùng cho chế độ "Tạo mới"; referenceImageMediaIds & aspectRatio bị bỏ qua.
 */
async function generateWithXAI(opts: GenOpts, key: string): Promise<MediaResult> {
  const res = await fetch(XAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || 'grok-2-image-1212',
      prompt: opts.prompt,
      n: 1,
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    let msg = `xAI lỗi ${res.status}`;
    try { const j = await res.json(); const e = j?.error; msg = (typeof e === 'string' ? e : e?.message) || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  const item = data?.data?.[0];
  if (item?.b64_json) return storeResult('image/jpeg', item.b64_json);

  // Trường hợp trả về URL -> tải về rồi chuyển base64.
  if (item?.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`Lỗi ${r.status} khi tải ảnh xAI về.`);
    const blob = await r.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Lỗi đọc ảnh xAI'));
      reader.readAsDataURL(blob);
    });
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (m) return storeResult(m[1], m[2]);
  }

  throw new Error('xAI không trả về ảnh. Thử lại hoặc đổi mô tả.');
}

export const Flow = {
  media: {
    // filter giữ lại cho tương thích chữ ký gốc, hiện luôn lọc ảnh.
    select: (_opts?: { filter?: string }): Promise<MediaResult> => selectImageFile(),
  },

  generate: {
    image: async (opts: GenOpts & { provider?: Provider }): Promise<MediaResult> => {
      const provider = opts.provider ?? DEFAULT_PROVIDER;
      const key = getApiKey(provider);
      if (provider === 'gemini') return generateWithGemini(opts, key);
      if (provider === 'xai') return generateWithXAI(opts, key);
      return generateWithOpenRouter(opts, key);
    },
  },

  download: async (opts: {
    base64: string;
    mimeType: string;
    filename: string;
  }): Promise<void> => {
    const a = document.createElement('a');
    a.href = `data:${opts.mimeType};base64,${opts.base64}`;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};

export default Flow;
