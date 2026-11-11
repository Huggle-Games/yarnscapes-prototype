// PNG'den level üretir: her opak piksel bir hücre, her benzersiz renk bir makara (numara).

export interface Level {
  id: string;
  w: number;
  h: number;
  /** Renkler, numara sırasıyla (index 0 = numara 1). */
  colors: { r: number; g: number; b: number; hex: string; lum: number }[];
  /** Her hücre için renk index'i, boş (şeffaf) hücrelerde -1. */
  cells: Int16Array;
  /** Her renkteki toplam hücre sayısı. */
  totals: Int32Array;
  /** Boş olmayan toplam hücre sayısı. */
  paintable: number;
}

const ALPHA_CUTOFF = 128;

export async function loadLevel(url: string, id: string): Promise<Level> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  const keyToIdx = new Map<number, number>();
  const raw: { r: number; g: number; b: number }[] = [];
  const tmp = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < ALPHA_CUTOFF) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = raw.length;
      keyToIdx.set(key, idx);
      raw.push({ r, g, b });
    }
    tmp[i] = idx;
  }

  // Numara sırası: koyudan açığa (parlaklık).
  const withLum = raw.map((c, i) => ({ ...c, i, lum: luminance(c.r, c.g, c.b) }));
  withLum.sort((a, b) => a.lum - b.lum);
  const remap = new Int32Array(raw.length);
  withLum.forEach((c, newIdx) => (remap[c.i] = newIdx));

  const cells = new Int16Array(w * h);
  const totals = new Int32Array(raw.length);
  let paintable = 0;
  for (let i = 0; i < w * h; i++) {
    if (tmp[i] < 0) { cells[i] = -1; continue; }
    const ci = remap[tmp[i]];
    cells[i] = ci;
    totals[ci]++;
    paintable++;
  }

  return {
    id, w, h, cells, totals, paintable,
    colors: withLum.map(({ r, g, b, lum }) => ({ r, g, b, lum, hex: toHex(r, g, b) })),
  };
}

/** 8 komşuluk (artı + çapraz) ile aynı renkteki bağlı bölgeyi, (start)'tan BFS mesafesiyle döndürür. */
export function regionFrom(level: Level, start: number): { idx: Int32Array; dist: Int32Array; count: number } {
  const { w, h, cells } = level;
  const color = cells[start];
  const seen = new Uint8Array(w * h);
  const idx = new Int32Array(level.totals[color]);
  const dist = new Int32Array(level.totals[color]);
  let head = 0, tail = 0;
  idx[tail] = start; dist[tail] = 0; tail++;
  seen[start] = 1;
  while (head < tail) {
    const i = idx[head], d = dist[head]; head++;
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const n = ny * w + nx;
        if (seen[n] || cells[n] !== color) continue;
        seen[n] = 1;
        idx[tail] = n; dist[tail] = d + 1; tail++;
      }
    }
  }
  return { idx, dist, count: tail };
}

export function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi: ' + url));
    img.src = url;
  });
}
