export interface AppearanceColorIndexes {
  head: number;
  primary: number;
  secondary: number;
  detail: number;
}

type ImageSource = any;
type Canvas = any;
declare const document: any;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function regionFor(r: number, g: number, b: number): keyof AppearanceColorIndexes | null {
  if (r > 200 && g > 200 && b < 80) return 'head';
  if (r > 200 && g < 80 && b < 80) return 'primary';
  if (r < 80 && g > 200 && b < 80) return 'secondary';
  if (r < 80 && g < 80 && b > 200) return 'detail';
  return null;
}

export function recolorCanvas(base: ImageSource, mask: ImageSource, width: number, height: number, colors: AppearanceColorIndexes, palette: readonly string[]): Canvas {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  const baseData = ctx.getImageData(0, 0, width, height);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width; maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');
  maskCtx.drawImage(mask, 0, 0);
  const maskData = maskCtx.getImageData(0, 0, width, height);
  const targets: Record<keyof AppearanceColorIndexes, [number, number, number]> = {
    head: hexToRgb(palette[colors.head] ?? '#ffffff'), primary: hexToRgb(palette[colors.primary] ?? '#ffffff'),
    secondary: hexToRgb(palette[colors.secondary] ?? '#ffffff'), detail: hexToRgb(palette[colors.detail] ?? '#ffffff'),
  };
  const p = baseData.data, m = maskData.data;
  for (let i = 0; i < p.length; i += 4) {
    const region = regionFor(m[i], m[i + 1], m[i + 2]);
    if (!region) continue;
    const luminance = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
    const [r, g, b] = targets[region];
    p[i] = r * luminance; p[i + 1] = g * luminance; p[i + 2] = b * luminance;
  }
  ctx.putImageData(baseData, 0, 0);
  return canvas;
}

export function recolorSpriteSheet(base: ImageSource, mask: ImageSource, sheetWidth: number, sheetHeight: number, frameWidth: number, frameHeight: number, pairs: { frameIndex: number; maskFrameIndex?: number }[], colors: AppearanceColorIndexes, palette: readonly string[]): Canvas {
  const canvas = document.createElement('canvas');
  canvas.width = sheetWidth; canvas.height = sheetHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0, sheetWidth, sheetHeight);
  const columns = Math.max(1, Math.floor(sheetWidth / frameWidth));
  const seen = new Set<number>();
  for (const pair of pairs) {
    if (pair.maskFrameIndex === undefined || seen.has(pair.frameIndex)) continue;
    seen.add(pair.frameIndex);
    const visual = document.createElement('canvas'), maskFrame = document.createElement('canvas');
    visual.width = maskFrame.width = frameWidth; visual.height = maskFrame.height = frameHeight;
    const vx = (pair.frameIndex % columns) * frameWidth, vy = Math.floor(pair.frameIndex / columns) * frameHeight;
    const mx = (pair.maskFrameIndex % columns) * frameWidth, my = Math.floor(pair.maskFrameIndex / columns) * frameHeight;
    visual.getContext('2d').drawImage(base, vx, vy, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    maskFrame.getContext('2d').drawImage(mask, mx, my, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    ctx.drawImage(recolorCanvas(visual, maskFrame, frameWidth, frameHeight, colors, palette), vx, vy, frameWidth, frameHeight);
  }
  return canvas;
}
