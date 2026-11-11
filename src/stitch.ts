// Hücre görünümleri: dolu hücre = örgü ilmeği (V şeklinde iki yaprak), boş hücre = gri kare.

type RGB = { r: number; g: number; b: number };

const mix = (c: RGB, t: RGB, k: number): RGB => ({
  r: Math.round(c.r + (t.r - c.r) * k),
  g: Math.round(c.g + (t.g - c.g) * k),
  b: Math.round(c.b + (t.b - c.b) * k),
});
const css = (c: RGB, a = 1) => `rgba(${c.r},${c.g},${c.b},${a})`;
const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

/** Bir rengin örgü ilmeği sprite'ını size x size piksel çizer. */
export function makeStitch(color: RGB, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  // Çok koyu renklerde ilmek dokusu kaybolmasın diye yaprakları biraz aç.
  const lum = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  const leaf = lum < 0.22 ? mix(color, WHITE, 0.14 - lum * 0.4) : color;
  const dark = lum < 0.22 ? mix(color, BLACK, 0.6) : mix(color, BLACK, 0.42);
  const mid = mix(leaf, BLACK, 0.18);
  const light = mix(leaf, WHITE, lum < 0.22 ? 0.3 : 0.38);

  // İlmekler arası boşluk (arka plan)
  ctx.fillStyle = css(dark);
  ctx.fillRect(0, 0, size, size);

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(size * (0.5 + side * 0.215), size * 0.5);
    ctx.rotate(side * 0.52);
    const rx = size * 0.235, ry = size * 0.6;
    const g = ctx.createLinearGradient(-rx, -ry, rx, ry);
    g.addColorStop(0, css(light));
    g.addColorStop(0.45, css(leaf));
    g.addColorStop(1, css(mid));
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    if (size >= 12) {
      ctx.lineWidth = Math.max(0.6, size * 0.03);
      ctx.strokeStyle = css(dark, 0.55);
      ctx.stroke();
      // Lif dokusu
      ctx.clip();
      ctx.strokeStyle = css(dark, 0.22);
      ctx.lineWidth = Math.max(0.5, size * 0.022);
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        const y = k * ry * 0.38;
        ctx.moveTo(-rx, y - rx * 0.6);
        ctx.lineTo(rx, y + rx * 0.6);
        ctx.stroke();
      }
      // Parlama
      ctx.strokeStyle = css(WHITE, 0.35);
      ctx.lineWidth = Math.max(0.6, size * 0.035);
      ctx.beginPath();
      ctx.ellipse(-rx * 0.25, -ry * 0.1, rx * 0.35, ry * 0.55, 0, Math.PI * 0.9, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }
  return c;
}

/** Boş hücre rengi. Seçili renkteyse koyu (vurgulu), değilse parlaklığa göre açık gri. */
export function emptyFill(lum: number, selected: boolean): string {
  if (selected) return '#a2a2a2';
  const v = Math.round(226 + lum * 26);
  return `rgb(${v},${v},${v})`;
}

export function miniEmpty(lum: number): string {
  const v = Math.round(205 + lum * 45);
  return `rgb(${v},${v},${v})`;
}
