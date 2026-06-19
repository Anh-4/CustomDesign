// Số mẫu output tạo song song để Anh4 chọn.
export const NUM_OPTIONS = 2;

/** '#RRGGBB' -> 'R, G, B' (để ghi rõ trong prompt cho AI bám đúng màu). */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export interface ChangeSpec {
  newText: string;              // ô2 (đã trim)
  origText: string;             // ô2b — text gốc cần thay (locator, đã trim)
  newNumber: string;            // ô3 (đã trim)
  hasReplacementImage: boolean; // ô4 có ảnh hay không
  targetDesc: string;           // mô tả nhân vật/số cần thay (locator, đã trim)
  textColor: string | null;    // ô5 hex hoặc null (giữ màu gốc)
  numberColor: string | null;  // ô5 hex hoặc null (giữ màu gốc)
}

/**
 * Dựng prompt CUSTOM DESIGN: AI EDIT design gốc (IMAGE 1), chỉ thay text/số/ảnh được chỉ định,
 * giữ NGUYÊN mọi thứ còn lại (style, filter, hiệu ứng, bố cục, kích thước).
 * Ảnh tham chiếu theo thứ tự: [IMAGE 1 = design gốc] (, IMAGE 2 = ảnh thay thế nếu có).
 */
export function buildCustomPrompt(spec: ChangeSpec, variant: number): string {
  const base = `You are a professional design editor. Your job is to EDIT an existing, finished design, changing ONLY the specific elements requested below while keeping everything else byte-for-byte faithful to the original.

REFERENCE IMAGES (in this EXACT order):
- IMAGE 1 — THE ORIGINAL DESIGN: a complete, finished design. This is the canvas you must edit. You MUST preserve its exact layout, composition, art style, color grading, filters, textures, lighting, shadows, effects, typography/font style, and EVERY graphic element — except the specific elements listed under CHANGES below.${
    spec.hasReplacementImage
      ? `\n- IMAGE 2 — REPLACEMENT IMAGE: a new picture to place INTO the design, replacing the existing photo/image element. Fit it into the SAME position, size, framing, crop, masking and styling as the image element it replaces, so it blends seamlessly and looks native to the original design.`
      : ''
  }`;

  const changes: string[] = [];
  if (spec.newText) {
    const findPart = spec.origText
      ? `find the existing text that reads "${spec.origText}" and replace ONLY that text with: "${spec.newText}"`
      : `replace the wording of the text in the design with: "${spec.newText}"`;
    changes.push(`- TEXT: ${findPart}. Reproduce the new text EXACTLY and VERBATIM, character-for-character — keep the exact spelling, capitalization, spacing, punctuation, symbols and accent marks/diacritics as written. Do NOT translate, correct, rephrase, abbreviate, reorder, add or drop ANY character. Keep the EXACT same font, size, weight, style, letter-spacing, color, effects, position and alignment as the original text — only the wording is swapped.`);
  }
  if (spec.newNumber) {
    changes.push(`- NUMBER: replace the number shown in the design with: "${spec.newNumber}". Keep the exact same font, size, style, effects and position as the original number. ONLY the digits change.`);
  }
  if (spec.hasReplacementImage) {
    changes.push(`- IMAGE: replace the existing photo/image element with IMAGE 2, matching the original element's exact placement, size, crop and styling.`);
  }
  const changeBlock = `\n\nCHANGES TO APPLY (change ONLY these — nothing else):\n${changes.join('\n')}`;

  // Gợi ý nhận diện đúng phần cần thay (phòng khi AI nhận nhầm element).
  const targetBlock = spec.targetDesc
    ? `\n\nTARGET TO REPLACE (use this to locate the EXACT element if it is ambiguous): "${spec.targetDesc}". Apply the image/number change above specifically to this element and do NOT touch other similar-looking elements.`
    : '';

  const colorLines: string[] = [];
  if (spec.textColor) colorLines.push(`- Render the TEXT in this exact color: ${spec.textColor} (RGB ${hexToRgb(spec.textColor)}).`);
  if (spec.numberColor) colorLines.push(`- Render the NUMBER in this exact color: ${spec.numberColor} (RGB ${hexToRgb(spec.numberColor)}).`);
  const colorBlock = colorLines.length
    ? `\n\nCOLOR OVERRIDES (apply these colors exactly, overriding what the original shows):\n${colorLines.join('\n')}`
    : '';

  const rules = `\n\nSTRICT RULES:
- TEXT FIDELITY (critical): any replacement text MUST appear in the output EXACTLY as the user typed it — character-for-character, including identical spelling, letter case, spaces, punctuation, special symbols and accent marks/diacritics. Do not "fix", localize, translate or beautify the text. If you cannot render a character faithfully, render it as-is rather than substituting it.
- BRAND / TRADEMARK FIDELITY: this is the user's own commercial print-on-demand design. Faithfully keep and reproduce every existing logo, brand mark, emblem, character and trademarked element already present in IMAGE 1 exactly as shown — do NOT remove, blur, censor, simplify, replace or refuse them. Only the elements listed under CHANGES are modified; everything else (including brand elements) stays identical.
- Do NOT redesign, restyle, recolor, move, add or remove ANY part of the original design other than the elements explicitly listed under CHANGES.
- Preserve IMAGE 1's exact aspect ratio, resolution, framing and crop — the output must look like the SAME design with only the requested elements swapped.
- Keep the original's print quality: crisp edges, the same effects/filters/grain, suitable for high-resolution printing.
- Output ONE single, clean, high-resolution image of the edited design ONLY. Do NOT show IMAGE 2 separately, no borders, no extra text, no watermark.`;

  const variantHint = `\n\nThis is rendering OPTION #${variant + 1} of ${NUM_OPTIONS}. Produce a clean, faithful result; you may vary only minor rendering details of the swapped elements (anti-aliasing, exact kerning, blend) — every rule above still applies identically.`;

  return base + changeBlock + targetBlock + colorBlock + rules + variantHint;
}

/**
 * Prompt cho chế độ TẠO MỚI (text->image, xAI Grok): bọc mô tả của Anh4 với định hướng
 * chất lượng cao, sẵn sàng in ấn, và nudge đa dạng giữa các mẫu.
 */
export function buildCreatePrompt(desc: string, variant: number): string {
  const variants = [
    '',
    ' Use a different composition, angle and color accents from other variations.',
    ' Use an alternative layout and framing from other variations.',
  ];
  const v = variants[variant] || '';
  return `${desc.trim()}. High-quality, sharp, detailed, clean print-ready artwork suitable for print-on-demand products.${v}`;
}
