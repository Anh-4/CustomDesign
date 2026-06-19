import React, { useState, useEffect } from 'react';
import { Flow, MODELS_BY_PROVIDER, CUSTOM_MODEL_ID, Provider, DEFAULT_PROVIDER, getProviderInfo, ImageModel, fetchOpenRouterImageModels } from './flow-sdk';
import { Dropdown, LineInput, SectionLabel, ColorField, ZoomModal } from './components/Primitives';
import { ApiKeyModal } from './components/ApiKeyModal';
import { InputState, GeneratedResult, MediaItem } from './types';
import { NUM_OPTIONS, buildCustomPrompt, buildCreatePrompt } from './constants';

// Version hiển thị: dùng define lúc build; fallback an toàn khi dev.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

/** 1 ô upload ảnh (số thứ tự + tiêu đề + mô tả; xem trước + xoá). */
const UploadBox: React.FC<{
  index: number;
  title: string;
  desc: string;
  image: MediaItem | null;
  onPick: () => void;
  onRemove: () => void;
  onZoom: (src: string) => void;
}> = ({ index, title, desc, image, onPick, onRemove, onZoom }) => {
  const src = image ? `data:${image.mimeType};base64,${image.base64}` : '';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#969696] text-black text-[11px] font-semibold shrink-0">
          {index}
        </span>
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold text-white leading-tight">{title}</span>
          <span className="text-[10px] text-white/40 leading-tight">{desc}</span>
        </div>
      </div>
      {image ? (
        <div className="relative rounded-xl overflow-hidden border border-white/10 aspect-[4/3] bg-[#141414]">
          <img src={src} className="w-full h-full object-contain cursor-zoom-in" onClick={() => onZoom(src)} />
          <button
            onClick={onRemove}
            className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center bg-black/60 hover:bg-black/80 rounded-full text-white/80 hover:text-white transition-colors"
            title="Xoá ảnh"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      ) : (
        <button
          onClick={onPick}
          className="rounded-xl border border-dashed border-[#595959] hover:border-[#969696] hover:bg-white/5 aspect-[4/3] flex flex-col items-center justify-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-[24px] text-white/40">add_photo_alternate</span>
          <span className="text-[10px] text-white/40">Bấm để tải ảnh</span>
        </button>
      )}
    </div>
  );
};

/** 1 ô số thứ tự + tiêu đề (cho ô text/số/màu — không phải ô ảnh). */
const FieldHead: React.FC<{ index: number; title: string; desc: string }> = ({ index, title, desc }) => (
  <div className="flex items-center gap-2 px-1">
    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#969696] text-black text-[11px] font-semibold shrink-0">
      {index}
    </span>
    <div className="flex flex-col">
      <span className="text-[12px] font-semibold text-white leading-tight">{title}</span>
      <span className="text-[10px] text-white/40 leading-tight">{desc}</span>
    </div>
  </div>
);

/** 1 thẻ kết quả (đang tạo / ảnh / lỗi). */
const OptionCard: React.FC<{
  index: number;
  result: GeneratedResult | null;
  loading: boolean;
  error: string | null;
  onZoom: (src: string) => void;
  onDownload: (r: GeneratedResult) => void;
}> = ({ index, result, loading, error, onZoom, onDownload }) => {
  const src = result ? `data:${result.mimeType};base64,${result.base64}` : '';
  return (
    <div className="relative flex flex-col rounded-xl border border-white/10 bg-[#141414] overflow-hidden min-h-0">
      <div className="px-2.5 py-1.5 text-[10px] font-medium text-white/50 border-b border-white/10 flex items-center justify-between shrink-0">
        <span>Mẫu {index + 1}</span>
        {result && (
          <button
            onClick={() => onDownload(result)}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            Tải PNG
          </button>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center p-2 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-white/40 animate-shimmer">
            <span className="material-symbols-outlined text-[28px]">imagesmode</span>
            <span className="text-[10px]">Đang tạo…</span>
          </div>
        ) : result ? (
          <img
            src={src}
            className="max-w-full max-h-full object-contain rounded-md cursor-zoom-in"
            onClick={() => onZoom(src)}
          />
        ) : error ? (
          <div className="text-[10px] text-red-400/80 text-center px-2 leading-relaxed">{error}</div>
        ) : (
          <span className="material-symbols-outlined text-[28px] text-white/15">imagesmode</span>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [inputs, setInputs] = useState<InputState>({
    designImage: null,
    newText: '',
    origText: '',
    newNumber: '',
    replaceImage: null,
    targetDesc: '',
    useTextColor: false,
    textColor: '#ffffff',
    useNumberColor: false,
    numberColor: '#ffffff',
  });

  const [results, setResults] = useState<(GeneratedResult | null)[]>(Array(NUM_OPTIONS).fill(null));
  const [slotErrors, setSlotErrors] = useState<(string | null)[]>(Array(NUM_OPTIONS).fill(null));
  const [loadingIndices, setLoadingIndices] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);

  // Đọc key đã lưu của một provider.
  const readKeyFor = (p: Provider): string => {
    try { return localStorage.getItem(getProviderInfo(p).storageKey) || ''; } catch { return ''; }
  };

  // Provider AI đang dùng (OpenRouter / Gemini) — chọn ở popup API key.
  const [provider, setProvider] = useState<Provider>(() => {
    try {
      const p = localStorage.getItem('AI_PROVIDER');
      return p === 'gemini' || p === 'openrouter' || p === 'xai' ? p : DEFAULT_PROVIDER;
    } catch { return DEFAULT_PROVIDER; }
  });

  // Model AI dùng để sinh ảnh (theo provider). 'Khác' -> nhập model ID thủ công.
  const [model, setModel] = useState<string>(MODELS_BY_PROVIDER[provider][0].id);
  const [customModel, setCustomModel] = useState('');

  // Chế độ: 'edit' = sửa design gốc (OpenRouter/Gemini) · 'create' = tạo ảnh mới từ mô tả (xAI Grok).
  const [mode, setMode] = useState<'edit' | 'create'>('edit');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createModel, setCreateModel] = useState<string>(MODELS_BY_PROVIDER.xai[0].id);

  // Provider hiển thị/dùng cho popup key & footer, theo chế độ hiện tại.
  const modalProvider: Provider = mode === 'create' ? 'xai' : provider;

  // Danh sách model OpenRouter tải động từ key (lọc model xuất ảnh được). null = dùng list cứng.
  const [orModels, setOrModels] = useState<ImageModel[] | null>(null);
  const [orLoading, setOrLoading] = useState(false);
  const [orError, setOrError] = useState<string | null>(null);

  // Lấy key OpenRouter hiện có (env build hoặc localStorage).
  const orKey = (): string =>
    (((import.meta as any).env?.VITE_OPENROUTER_API_KEY as string) || readKeyFor('openrouter') || '').trim();

  /** Tải danh sách model ảnh từ OpenRouter theo key đã nhập, và chọn lại model hợp lệ. */
  const loadOrModels = async () => {
    setOrError(null);
    setOrLoading(true);
    try {
      const list = await fetchOpenRouterImageModels(orKey());
      setOrModels(list);
      // Giữ model đang chọn nếu còn trong list; không thì về model đầu danh sách.
      setModel((cur) => (cur === CUSTOM_MODEL_ID || list.some((m) => m.id === cur) ? cur : (list[0]?.id ?? cur)));
    } catch (e: any) {
      setOrModels(null);
      setOrError(e?.message || 'Không tải được danh sách model.');
    } finally {
      setOrLoading(false);
    }
  };

  // Đổi provider: openrouter + có key -> tải list động; còn lại -> dùng list cứng.
  useEffect(() => {
    if (provider === 'openrouter' && orKey()) {
      loadOrModels();
      return;
    }
    setOrModels(null);
    setOrError(null);
    const list = MODELS_BY_PROVIDER[provider];
    setModel((cur) => (cur === CUSTOM_MODEL_ID || list.some((m) => m.id === cur) ? cur : list[0].id));
  }, [provider]);

  // Mỗi khi mở app: hiện popup nếu provider hiện tại chưa có key.
  useEffect(() => {
    const info = getProviderInfo(provider);
    const envKey = (import.meta as any).env?.[info.envKey];
    if (!envKey && !readKeyFor(provider)) setApiKeyModalOpen(true);
  }, []);

  const saveApiKey = (p: Provider, key: string) => {
    try {
      localStorage.setItem(getProviderInfo(p).storageKey, key);
      // Đang ở tab "Tạo mới" mà nhập key xAI thì chỉ lưu key, không đổi provider của tab Edit.
      if (!(p === 'xai' && mode === 'create')) {
        localStorage.setItem('AI_PROVIDER', p);
        setProvider(p);
      }
    } catch {}
    setApiKeyModalOpen(false);
    // Vừa nhập key OpenRouter -> tải lại danh sách model key này gọi được.
    if (p === 'openrouter') loadOrModels();
  };

  // Đổi chế độ; sang 'create' mà chưa có key xAI thì mở popup nhập key.
  const switchMode = (m: 'edit' | 'create') => {
    setMode(m);
    setError(null);
    if (m === 'create') {
      const hasXai = ((import.meta as any).env?.VITE_XAI_API_KEY) || readKeyFor('xai');
      if (!hasXai) setApiKeyModalOpen(true);
    }
  };

  // Chọn ảnh cho ô design (1) hoặc ô ảnh thay thế (4).
  const pick = async (slot: 'designImage' | 'replaceImage') => {
    try {
      const m = await Flow.media.select({ filter: 'image' });
      setInputs((prev) => ({ ...prev, [slot]: { mediaId: m.mediaId, base64: m.base64, mimeType: m.mimeType } }));
    } catch {
      // người dùng huỷ chọn file -> bỏ qua
    }
  };
  const clearSlot = (slot: 'designImage' | 'replaceImage') =>
    setInputs((prev) => ({ ...prev, [slot]: null }));
  const set = <K extends keyof InputState>(k: K, v: InputState[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const loading = loadingIndices.size > 0;
  const hasChange = !!(inputs.newText.trim() || inputs.newNumber.trim() || inputs.replaceImage);
  const canGenerate = (mode === 'edit' ? (!!inputs.designImage && hasChange) : !!createPrompt.trim()) && !loading;
  const hasOutput = loading || results.some(Boolean) || slotErrors.some(Boolean);

  /** Chạy 1 mẻ NUM_OPTIONS mẫu SONG SONG (dùng chung cho edit & create). */
  const runBatch = (genProvider: Provider, genModel: string, makePrompt: (i: number) => string, refs?: string[]) => {
    setError(null);
    setResults(Array(NUM_OPTIONS).fill(null));
    setSlotErrors(Array(NUM_OPTIONS).fill(null));
    setLoadingIndices(new Set(Array.from({ length: NUM_OPTIONS }, (_, i) => i)));

    for (let i = 0; i < NUM_OPTIONS; i++) {
      const idx = i;
      const prompt = makePrompt(idx);
      Flow.generate.image({ prompt, model: genModel, provider: genProvider, referenceImageMediaIds: refs })
        .then((out) => {
          setResults((prev) => {
            const next = [...prev];
            next[idx] = { id: out.mediaId, mediaId: out.mediaId, base64: out.base64, mimeType: out.mimeType, prompt };
            return next;
          });
        })
        .catch((e: any) => {
          setSlotErrors((prev) => {
            const next = [...prev];
            next[idx] = e?.message || 'Tạo ảnh thất bại.';
            return next;
          });
        })
        .finally(() => {
          setLoadingIndices((prev) => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        });
    }
  };

  // Chế độ EDIT: sửa design gốc (giữ style), gửi ảnh tham chiếu cho OpenRouter/Gemini.
  const generateEdit = () => {
    const design = inputs.designImage;
    if (!design) { setError('Cần tải lên design gốc ở ô 1.'); return; }
    if (!hasChange) { setError('Hãy nhập text (ô 2), số (ô 3) hoặc tải ảnh thay thế (ô 4) — ít nhất một thứ để thay đổi.'); return; }
    const effectiveModel = model === CUSTOM_MODEL_ID ? customModel.trim() : model;
    if (!effectiveModel) { setError('Hãy nhập Model ID khi chọn "Khác".'); return; }

    // Thứ tự ảnh PHẢI là: design gốc (IMAGE 1) -> ảnh thay thế (IMAGE 2, nếu có).
    const refs = [design.mediaId];
    if (inputs.replaceImage) refs.push(inputs.replaceImage.mediaId);
    const spec = {
      newText: inputs.newText.trim(),
      origText: inputs.origText.trim(),
      newNumber: inputs.newNumber.trim(),
      hasReplacementImage: !!inputs.replaceImage,
      targetDesc: inputs.targetDesc.trim(),
      textColor: inputs.useTextColor ? inputs.textColor : null,
      numberColor: inputs.useNumberColor ? inputs.numberColor : null,
    };
    runBatch(provider, effectiveModel, (i) => buildCustomPrompt(spec, i), refs);
  };

  // Chế độ CREATE: tạo ảnh mới từ mô tả qua xAI Grok (không dùng ảnh tham chiếu).
  const generateCreate = () => {
    const desc = createPrompt.trim();
    if (!desc) { setError('Hãy nhập mô tả ảnh cần tạo.'); return; }
    const hasXai = ((import.meta as any).env?.VITE_XAI_API_KEY) || readKeyFor('xai');
    if (!hasXai) { setApiKeyModalOpen(true); setError('Chưa có key xAI Grok — hãy nhập key để tạo ảnh.'); return; }
    const effectiveModel = createModel === CUSTOM_MODEL_ID ? customModel.trim() : createModel;
    if (!effectiveModel) { setError('Hãy nhập Model ID khi chọn "Khác".'); return; }
    runBatch('xai', effectiveModel, (i) => buildCreatePrompt(desc, i));
  };

  const generate = () => (mode === 'create' ? generateCreate() : generateEdit());

  const download = (r: GeneratedResult) => {
    const ext = (r.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
    Flow.download({ base64: r.base64, mimeType: r.mimeType, filename: `custom-design-${Date.now()}.${ext}` });
  };

  // OpenRouter: ưu tiên list tải động từ key; các provider khác / chưa tải xong -> list cứng.
  const activeList = provider === 'openrouter' && orModels ? orModels : MODELS_BY_PROVIDER[provider];
  const modelItems = [
    ...activeList.map((m) => ({ value: m.id, label: m.label })),
    { value: CUSTOM_MODEL_ID, label: 'Khác (nhập model ID)…' },
  ];

  return (
    <div className="flex h-screen w-screen bg-[#0e0e0e] text-white overflow-hidden">
      {/* ===== Panel trái: đầu vào (5 ô) ===== */}
      <aside className="w-[400px] shrink-0 h-full border-r border-white/10 flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-400">edit_note</span>
            <h1 className="text-[14px] font-semibold">Custom Design</h1>
          </div>
          <span className="text-[10px] text-white/30">v{APP_VERSION}</span>
        </header>

        {/* Chuyển chế độ: Sửa design (edit) | Tạo mới (Grok) */}
        <div className="px-4 pt-3">
          <div className="flex w-full items-center border border-[#595959] rounded-xl overflow-hidden bg-transparent">
            <button
              onClick={() => switchMode('edit')}
              className={`flex-1 flex items-center justify-center gap-1.5 h-[36px] text-[11px] font-medium transition-all ${mode === 'edit' ? 'bg-[#969696] text-black' : 'text-white/65 hover:text-white hover:bg-white/5'}`}
            >
              <span className="material-symbols-outlined text-[16px]">edit</span> Sửa design
            </button>
            <button
              onClick={() => switchMode('create')}
              className={`flex-1 flex items-center justify-center gap-1.5 h-[36px] text-[11px] font-medium transition-all ${mode === 'create' ? 'bg-[#969696] text-black' : 'text-white/65 hover:text-white hover:bg-white/5'}`}
            >
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span> Tạo mới (Grok)
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto dark-scrollbar p-4 flex flex-col gap-4">
          {mode === 'edit' && (
          <>
          {/* Ô 1 — Design gốc */}
          <UploadBox
            index={1}
            title="Design gốc (PNG)"
            desc="Design hoàn chỉnh cần custom — AI giữ nguyên style/filter/hiệu ứng"
            image={inputs.designImage}
            onPick={() => pick('designImage')}
            onRemove={() => clearSlot('designImage')}
            onZoom={setZoomImage}
          />

          {/* Ô 2 — Text (mới + text gốc cần thay) */}
          <div className="flex flex-col gap-2">
            <FieldHead index={2} title="Text" desc="Thay phần chữ trong design (giữ font/vị trí gốc)" />
            <div className="flex flex-col gap-1">
              <SectionLabel>Text mới</SectionLabel>
              <LineInput
                value={inputs.newText}
                onChange={(v) => set('newText', v)}
                placeholder="VD: KOZMOZ RACING"
              />
            </div>
            <div className="flex flex-col gap-1">
              <SectionLabel>Text gốc cần thay (tùy chọn)</SectionLabel>
              <LineInput
                value={inputs.origText}
                onChange={(v) => set('origText', v)}
                placeholder="VD: chữ hiện có 'TEAM 99' — báo AI thay đúng chỗ"
              />
            </div>
          </div>

          {/* Ô 3 — Số mới */}
          <div className="flex flex-col gap-1.5">
            <FieldHead index={3} title="Số mới" desc="Thay phần số trong design (giữ style gốc)" />
            <LineInput
              value={inputs.newNumber}
              onChange={(v) => set('newNumber', v)}
              placeholder="VD: 46"
              numeric
            />
          </div>

          {/* Ô 4 — Ảnh thay thế */}
          <UploadBox
            index={4}
            title="Ảnh thay thế (PNG/JPG)"
            desc="Thay ảnh có sẵn trong design — AI ghép vào đúng vị trí gốc"
            image={inputs.replaceImage}
            onPick={() => pick('replaceImage')}
            onRemove={() => clearSlot('replaceImage')}
            onZoom={setZoomImage}
          />

          {/* Mô tả phần cần thay — giúp AI nhận diện đúng nhân vật/số khi nhận nhầm */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <span className="material-symbols-outlined text-[18px] text-white/40">person_search</span>
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-white leading-tight">Mô tả phần cần thay</span>
                <span className="text-[10px] text-white/40 leading-tight">Tả nhân vật/số cần thay — giúp AI nhận diện đúng (tùy chọn)</span>
              </div>
            </div>
            <textarea
              value={inputs.targetDesc}
              onChange={(e) => set('targetDesc', e.target.value)}
              placeholder="VD: thay người mẫu nam ở giữa / thay số áo góc phải trên"
              style={{ height: '64px' }}
              className="border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 resize-none bg-transparent text-[11px] font-medium text-white placeholder-[rgba(218,220,224,0.3)] tracking-[0.1px] focus:outline-none transition-colors dark-scrollbar"
            />
          </div>

          {/* Ô 5 — Bảng màu (RGB) */}
          <div className="flex flex-col gap-1.5">
            <FieldHead index={5} title="Bảng màu (RGB)" desc="Ép màu chữ/số khi AI tô sai so với design gốc" />
            <div className="flex flex-col gap-2">
              <ColorField
                label="Màu chữ"
                enabled={inputs.useTextColor}
                onToggle={(v) => set('useTextColor', v)}
                color={inputs.textColor}
                onColor={(v) => set('textColor', v)}
              />
              <ColorField
                label="Màu số"
                enabled={inputs.useNumberColor}
                onToggle={(v) => set('useNumberColor', v)}
                color={inputs.numberColor}
                onColor={(v) => set('numberColor', v)}
              />
            </div>
          </div>

          <Dropdown label="Model AI" value={model} items={modelItems} onChange={setModel} />
          {provider === 'openrouter' && (
            <div className="flex items-center gap-2 ml-2 -mt-0.5">
              <span className="text-[10px] text-white/35 leading-tight flex-1">
                {orLoading
                  ? 'Đang tải model từ key OpenRouter…'
                  : orError
                  ? `Không tải được list, dùng mặc định (${orError})`
                  : orModels
                  ? `${orModels.length} model ảnh khả dụng từ key của bạn (gồm Grok Imagine)`
                  : 'Nhập key OpenRouter để tải toàn bộ model khả dụng'}
              </span>
              <button
                onClick={loadOrModels}
                disabled={orLoading || !orKey()}
                className="text-[10px] text-amber-400/80 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5"
                title="Tải lại danh sách model"
              >
                <span className={`material-symbols-outlined text-[13px] ${orLoading ? 'animate-spin' : ''}`}>refresh</span>
                Tải lại
              </button>
            </div>
          )}
          {model === CUSTOM_MODEL_ID && (
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="VD: google/gemini-2.5-flash-image"
              className="border border-[#595959] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 bg-transparent text-[11px] text-white placeholder-white/25 focus:outline-none transition-colors"
            />
          )}
          </>
          )}

          {mode === 'create' && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <span className="material-symbols-outlined text-[18px] text-amber-400">auto_awesome</span>
                <div className="flex flex-col">
                  <span className="text-[12px] font-semibold text-white leading-tight">Mô tả ảnh cần tạo</span>
                  <span className="text-[10px] text-white/40 leading-tight">Tạo ảnh mới từ đầu bằng Grok — không dùng/giữ design gốc</span>
                </div>
              </div>
              <textarea
                value={createPrompt}
                onChange={(e) => setCreatePrompt(e.target.value)}
                placeholder="VD: Áo thun đen in logo đội đua F1 Ferrari phong cách vintage, nền trắng, chất lượng in cao"
                style={{ height: '150px' }}
                className="border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 resize-none bg-transparent text-[12px] font-medium text-white placeholder-[rgba(218,220,224,0.3)] tracking-[0.1px] focus:outline-none transition-colors dark-scrollbar"
              />
            </div>

            <Dropdown
              label="Model xAI"
              value={createModel}
              items={[...MODELS_BY_PROVIDER.xai.map((m) => ({ value: m.id, label: m.label })), { value: CUSTOM_MODEL_ID, label: 'Khác (nhập model ID)…' }]}
              onChange={setCreateModel}
            />
            {createModel === CUSTOM_MODEL_ID && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="VD: grok-2-image-1212"
                className="border border-[#595959] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 bg-transparent text-[11px] text-white placeholder-white/25 focus:outline-none transition-colors"
              />
            )}
            <div className="text-[10px] text-white/35 bg-white/5 border border-white/10 rounded-xl px-3 py-2 leading-relaxed">
              💡 Grok tạo ảnh mới từ mô tả, thoáng hơn về logo/nhân vật/trademark — nhưng <span className="text-white/55">không giữ design gốc</span>. Muốn sửa design có sẵn thì dùng tab <span className="text-white/55">Sửa design</span>.
            </div>
          </>
          )}

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 leading-relaxed">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex flex-col gap-2">
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-2 h-[42px] rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-black text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">{loading ? 'progress_activity' : 'auto_awesome'}</span>
            {loading ? `Đang tạo ${NUM_OPTIONS} mẫu…` : mode === 'create' ? `Tạo ${NUM_OPTIONS} ảnh mới` : `Tạo ${NUM_OPTIONS} mẫu Custom`}
          </button>
          <button
            onClick={() => setApiKeyModalOpen(true)}
            className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
          >
            Provider: <span className="text-white/60">{getProviderInfo(modalProvider).label}</span> · Đổi API Key
          </button>
        </div>
      </aside>

      {/* ===== Panel phải: 2 mẫu kết quả ===== */}
      <main className="flex-1 h-full flex flex-col min-w-0">
        {hasOutput ? (
          <>
            <div className="px-5 pt-4 pb-1 text-[11px] text-white/40">
              Chọn mẫu ưng ý → bấm <span className="text-amber-400">Tải PNG</span> ở góc mỗi mẫu (chất lượng cao, in ấn được). Bấm vào ảnh để phóng to.
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3 p-4 pt-2 min-h-0">
              {Array.from({ length: NUM_OPTIONS }, (_, i) => (
                <OptionCard
                  key={i}
                  index={i}
                  result={results[i]}
                  loading={loadingIndices.has(i)}
                  error={slotErrors[i]}
                  onZoom={setZoomImage}
                  onDownload={download}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-white/25 max-w-[360px] text-center">
              <span className="material-symbols-outlined text-[44px]">{mode === 'create' ? 'auto_awesome' : 'edit_note'}</span>
              <span className="text-[13px] leading-relaxed">
                {mode === 'create' ? (
                  <>Nhập <span className="text-white/50">mô tả ảnh</span> cần tạo rồi bấm tạo — Grok sẽ dựng {NUM_OPTIONS} ảnh mới để Anh4 chọn (không dùng design gốc).</>
                ) : (
                  <>Tải <span className="text-white/50">design gốc (ô 1)</span>, rồi nhập text/số hoặc tải ảnh thay thế (ô 2–4). AI giữ nguyên style gốc, chỉ thay phần Anh4 chỉ định và tạo {NUM_OPTIONS} mẫu để chọn.</>
                )}
              </span>
            </div>
          </div>
        )}
      </main>

      <ApiKeyModal
        isOpen={apiKeyModalOpen}
        required={mode === 'edit' && !readKeyFor(provider) && !(import.meta as any).env?.[getProviderInfo(provider).envKey]}
        provider={modalProvider}
        getKeyFor={readKeyFor}
        onSave={saveApiKey}
        onClose={() => setApiKeyModalOpen(false)}
      />
      <ZoomModal isOpen={!!zoomImage} imageSrc={zoomImage || ''} onClose={() => setZoomImage(null)} />
    </div>
  );
}
