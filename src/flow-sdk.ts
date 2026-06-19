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
// 'xai' (Grok) làm được CẢ edit (/images/edits) lẫn tạo mới (/images/generations).
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

// Provider dùng cho chế độ EDIT (nhận ảnh tham chiếu để sửa). Cả 3 đều edit được.
export const EDIT_PROVIDERS: Provider[] = ['openrouter', 'gemini', 'xai'];

export const getProviderInfo = (p: Provider): ProviderInfo =>
  PROVIDERS.find((x) => x.id === p) ?? PROVIDERS[0];

// Model ảnh theo từng provider (slug đúng theo từng nền tảng).
// Nano Banana (Gemini image) là model mạnh nhất cho việc "chỉnh chi tiết mà giữ nguyên style" -> để đầu danh sách.
export const MODELS_BY_PROVIDER: Record<Provider, ImageModel[]> = {
  openrouter: [
    { id: 'google/gemini-3-pro-image-preview', label: '🍌 Nano Banana Pro' },
    { id: 'google/gemini-2.5-flash-image',     label: '🍌 Nano Banana / Flash' },
    { id: 'black-forest-labs/flux.2-pro',      label: 'FLUX.2 Pro (BFL)' },
    { id: 'openai/gpt-5.4-image-2',            label: 'GPT Image (OpenAI)' },
    { id: 'x-ai/grok-imagine-image-quality',   label: 'xAI: Grok Imagine Image Quality' },
  ],
  gemini: [
    { id: 'gemini-3-pro-image-preview', label: '🍌 Nano Banana Pro' },
    { id: 'gemini-2.5-flash-image',     label: '🍌 Nano Banana / Flash' },
  ],
  // xAI Grok — edit (/images/edits) + tạo mới (/images/generations).
  xai: [
    { id: 'grok-imagine-image-quality', label: 'Grok Imagine (xAI)' },
  ],
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// Model ảnh có trên OpenRouter nhưng CHƯA xuất hiện trong /models public (vẫn gọi được bằng key).
// -> bơm thêm vào dropdown động. VD: Grok Imagine (modality text+image->image, sửa ảnh được).
const OR_EXTRA_IMAGE_MODELS: ImageModel[] = [
  { id: 'black-forest-labs/flux.2-pro',     label: 'FLUX.2 Pro (BFL)' },
  { id: 'black-forest-labs/flux.2-max',     label: 'FLUX.2 Max (BFL)' },
  { id: 'black-forest-labs/flux.2-flex',    label: 'FLUX.2 Flex (BFL)' },
  { id: 'x-ai/grok-imagine-image-quality',  label: 'xAI: Grok Imagine Image Quality' },
];

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

  // moderated:true -> OpenRouter có lớp lọc nội dung (hay từ chối trademark/nhân vật) -> đánh dấu.
  const imageModels = list
    .filter(isImageOut)
    .map((m) => ({
      id: String(m.id),
      label: String(m.name || m.id) + (m?.top_provider?.is_moderated ? ' · có kiểm duyệt' : ''),
    }));

  // Bơm thêm các model ảnh còn thiếu trong catalog public (vd Grok Imagine) nếu chưa có.
  for (const e of OR_EXTRA_IMAGE_MODELS) {
    if (!imageModels.some((m) => m.id === e.id)) imageModels.push({ ...e });
  }

  // Ưu tiên các model ảnh tốt (gemini image/nano banana, flux, gpt image, grok imagine...) lên đầu.
  imageModels.sort((a, b) => {
    const pa = /image|banana|flux/i.test(a.id) ? 0 : 1;
    const pb = /image|banana|flux/i.test(b.id) ? 0 : 1;
    return pa !== pb ? pa - pb : a.label.localeCompare(b.label);
  });

  // KHÔNG liệt kê grok trên OpenRouter: chúng chỉ xuất text (không sửa ảnh), chỉ gây nhầm.
  // Grok sửa/tạo ảnh dùng provider xAI trực tiếp (model "Grok Imagine").
  return imageModels;
}
const geminiUrl = (model: string, key: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
const XAI_IMAGE_URL = 'https://api.x.ai/v1/images/generations';
const XAI_EDIT_URL = 'https://api.x.ai/v1/images/edits';

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
  const isGrok = /grok|imagine/i.test(opts.model);
  // Model chỉ xuất 'image' (Grok, FLUX) -> chỉ yêu cầu ['image']; nếu kèm 'text' sẽ lỗi modalities.
  const imageOnlyOut = isGrok || /flux/i.test(opts.model);
  const content: any[] = [{ type: 'text', text: opts.prompt }];
  const refIds = opts.referenceImageMediaIds ?? [];
  for (let i = 0; i < refIds.length; i++) {
    // Ref đầu = ảnh design gốc -> flatten nền trắng để model khỏi "điền" vùng trong suốt.
    const uri = await refToDataUri(refIds[i], i === 0);
    if (uri) content.push({ type: 'image_url', image_url: { url: uri } });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Custom Design AI',
    },
    // Modalities phải khớp model: Grok Imagine chỉ hỗ trợ output 'image' -> kèm 'text' sẽ lỗi
    // "No endpoints ... output modalities: image, text". Các model khác (Nano Banana/GPT) cần cả 'text'.
    // Grok hay "vẽ thêm" -> hạ temperature để bám design gốc hơn (đỡ sáng tạo).
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content }],
      modalities: imageOnlyOut ? ['image'] : ['image', 'text'],
      // Grok: temperature vừa phải -> 2 mẫu khác nhau (để bấm tạo lại chọn bản sạch), vẫn đủ bám.
      ...(isGrok ? { temperature: 0.4 } : {}),
      ...(opts.aspectRatio ? { image_config: { aspect_ratio: opts.aspectRatio } } : {}),
    }),
  });

  if (!res.ok) {
    let msg = `OpenRouter lỗi ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const message = choice?.message;

  // Tìm ảnh: (1) message.images[].image_url.url, (2) trong content dạng mảng part image.
  let url: string | undefined = message?.images?.[0]?.image_url?.url;
  if (!url && Array.isArray(message?.content)) {
    const part = message.content.find((p: any) => p?.type === 'image_url' || p?.image_url);
    url = part?.image_url?.url || part?.url;
  }
  if (url) {
    const parsed = /^data:([^;]+);base64,(.*)$/.exec(url);
    if (parsed) return storeResult(parsed[1], parsed[2]);
    // URL http(s) -> tải về rồi chuyển base64.
    const r = await fetch(url);
    if (r.ok) {
      const blob = await r.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Lỗi đọc ảnh'));
        reader.readAsDataURL(blob);
      });
      const m2 = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if (m2) return storeResult(m2[1], m2[2]);
    }
  }

  // Không có ảnh -> dựng lý do RÕ RÀNG để hiển thị (giúp biết bị chặn an toàn hay từ chối).
  const textPart =
    typeof message?.content === 'string'
      ? message.content
      : Array.isArray(message?.content)
      ? message.content.map((p: any) => (typeof p === 'string' ? p : p?.text)).filter(Boolean).join(' ')
      : '';
  const reason = message?.refusal || textPart || data?.error?.message;
  const fr = choice?.finish_reason || choice?.native_finish_reason;
  const frNote = fr ? ` [${fr}]` : '';
  if (reason) throw new Error(`Model không trả ảnh${frNote}: ${String(reason).slice(0, 300)}`);
  throw new Error(`OpenRouter không trả về ảnh${frNote}. Có thể model đã CHẶN nội dung (bản quyền/an toàn) — thử model khác (vd Grok Imagine) hoặc đổi mô tả.`);
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
 * Sinh/chỉnh ảnh qua xAI Grok (Grok Imagine).
 *  - CÓ ảnh tham chiếu -> /v1/images/edits (sửa ảnh, nhận tối đa 3 ảnh base64).
 *  - KHÔNG có ảnh      -> /v1/images/generations (tạo mới từ text).
 * API JSON, không có tham số tỉ lệ/size -> aspectRatio bị bỏ qua.
 */
async function generateWithXAI(opts: GenOpts, key: string): Promise<MediaResult> {
  const model = opts.model || 'grok-imagine-image-quality';
  const refIds = opts.referenceImageMediaIds ?? [];

  let url: string;
  let body: any;
  if (refIds.length > 0) {
    // EDIT: gửi ảnh dạng { url: data-URI, type: 'image_url' } (1 ảnh -> object, nhiều -> mảng, tối đa 3).
    const slice = refIds.slice(0, 3);
    const images: any[] = [];
    for (let i = 0; i < slice.length; i++) {
      const uri = await refToDataUri(slice[i], i === 0); // flatten ảnh design gốc lên nền trắng
      if (uri) images.push({ url: uri, type: 'image_url' });
    }
    url = XAI_EDIT_URL;
    body = { model, prompt: opts.prompt, image: images.length === 1 ? images[0] : images, response_format: 'b64_json' };
  } else {
    url = XAI_IMAGE_URL;
    body = { model, prompt: opts.prompt, n: 1, response_format: 'b64_json' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Lỗi tải ảnh để xử lý nền'));
    img.src = src;
  });
}

/**
 * Dán ảnh lên nền TRẮNG (xoá vùng trong suốt). Lý do: model edit hay coi vùng PNG trong suốt
 * là "vùng cần điền" -> tự vẽ thêm khối màu/nền. Nền trắng đặc giúp nó giữ design, không bịa thêm.
 * Lúc tải về sẽ xoá nền trắng -> PNG trong suốt (cutoutBackgroundToPng).
 */
async function flattenToWhite(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  const img = await loadImage(`data:${mimeType};base64,${base64}`);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { base64, mimeType };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { base64: canvas.toDataURL('image/png').split(',')[1] || base64, mimeType: 'image/png' };
}

/** Lấy data-URI của 1 ảnh tham chiếu; flatten nền trắng nếu yêu cầu (dùng cho ảnh design gốc). */
async function refToDataUri(mediaId: string, flatten: boolean): Promise<string | null> {
  const m = registry.get(mediaId);
  if (!m) return null;
  if (!flatten) return `data:${m.mimeType};base64,${m.base64}`;
  try {
    const f = await flattenToWhite(m.base64, m.mimeType);
    return `data:${f.mimeType};base64,${f.base64}`;
  } catch {
    return `data:${m.mimeType};base64,${m.base64}`;
  }
}

/**
 * Xoá nền -> PNG trong suốt. Flood-fill từ 4 mép ảnh: pixel nào gần màu nền (lấy trung bình 4 góc)
 * trong ngưỡng `tolerance` VÀ nối liền với mép -> đặt alpha = 0. Chỉ bỏ nền bao quanh, KHÔNG đụng
 * các vùng cùng màu nằm bên trong design. Trả base64 của ảnh PNG (có alpha).
 */
export async function cutoutBackgroundToPng(base64: string, mimeType: string, tLow = 26, tHigh = 85): Promise<string> {
  const img = await loadImage(`data:${mimeType};base64,${base64}`);
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas');
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Màu nền = trung bình 4 góc.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  let br = 0, bg = 0, bb = 0;
  for (const c of corners) { br += d[c]; bg += d[c + 1]; bb += d[c + 2]; }
  br /= 4; bg /= 4; bb /= 4;

  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const distAt = (o: number) => {
    const dr = d[o] - br, dg = d[o + 1] - bg, db = d[o + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + (w - 1)); }

  // Flood-fill từ mép. dist >= tHigh -> chạm design, dừng (giữ nguyên).
  // dist <= tLow -> nền, trong suốt hẳn. Giữa -> alpha mềm (chống răng cưa) + khử viền nền.
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const o = p * 4;
    const dist = distAt(o);
    if (dist >= tHigh) continue;

    const a = dist <= tLow ? 0 : (dist - tLow) / (tHigh - tLow); // 0..1
    if (a > 0 && a < 1) {
      // De-fringe: tách màu nền khỏi pixel biên (C = F*a + bg*(1-a) -> F) để hết viền trắng.
      d[o] = clamp((d[o] - br * (1 - a)) / a);
      d[o + 1] = clamp((d[o + 1] - bg * (1 - a)) / a);
      d[o + 2] = clamp((d[o + 2] - bb * (1 - a)) / a);
    }
    d[o + 3] = Math.round(a * 255);

    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1] || '';
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
