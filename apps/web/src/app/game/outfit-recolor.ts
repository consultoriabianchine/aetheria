export interface AppearanceColorIndexes {
  head: number;
  primary: number;
  secondary: number;
  detail: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(hue2rgb(h + 1 / 3) * 255), Math.round(hue2rgb(h) * 255), Math.round(hue2rgb(h - 1 / 3) * 255)];
}

function regionFor(mr: number, mg: number, mb: number): keyof AppearanceColorIndexes | null {
  if (mr > 200 && mg > 200 && mb < 80) return 'head';
  if (mr > 200 && mg < 80 && mb < 80) return 'primary';
  if (mr < 80 && mg > 200 && mb < 80) return 'secondary';
  if (mr < 80 && mg < 80 && mb > 200) return 'detail';
  return null;
}

/**
 * Recolore a spritesheet base usando a color mask (regiões yellow/red/green/blue)
 * e a paleta. Preserva a luminosidade do sprite (sombras/iluminação) e troca
 * apenas o matiz/saturação pela cor da paleta.
 */
export function recolorCanvas(
  base: CanvasImageSource,
  mask: CanvasImageSource,
  width: number,
  height: number,
  colors: AppearanceColorIndexes,
  palette: readonly string[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const baseData = ctx.getImageData(0, 0, width, height);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(mask, 0, 0);
  const maskData = maskCtx.getImageData(0, 0, width, height);

  const targets: Record<keyof AppearanceColorIndexes, [number, number, number]> = {
    head: hexToRgb(palette[colors.head] ?? '#ffffff'),
    primary: hexToRgb(palette[colors.primary] ?? '#ffffff'),
    secondary: hexToRgb(palette[colors.secondary] ?? '#ffffff'),
    detail: hexToRgb(palette[colors.detail] ?? '#ffffff'),
  };
  const targetHsl: Record<keyof AppearanceColorIndexes, [number, number, number]> = {
    head: rgbToHsl(...targets.head),
    primary: rgbToHsl(...targets.primary),
    secondary: rgbToHsl(...targets.secondary),
    detail: rgbToHsl(...targets.detail),
  };

  const p = baseData.data;
  const m = maskData.data;
  for (let i = 0; i < p.length; i += 4) {
    const region = regionFor(m[i], m[i + 1], m[i + 2]);
    if (!region) continue;
    const [, , l] = rgbToHsl(p[i], p[i + 1], p[i + 2]);
    const [th, ts] = targetHsl[region];
    const [nr, ng, nb] = hslToRgb(th, ts, l);
    p[i] = nr;
    p[i + 1] = ng;
    p[i + 2] = nb;
  }
  ctx.putImageData(baseData, 0, 0);
  return canvas;
}
