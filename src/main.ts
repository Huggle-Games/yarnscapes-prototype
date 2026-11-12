import { loadLevel, regionFrom, type Level } from './level';
import { makeStitch, emptyFill, miniEmpty } from './stitch';
import { driveReady, listDriveLevels, driveFileUrl, type DriveLevel } from './drive';

// ---------- Ayarlar ----------
const FILL_STEP_MAX_MS = 28;     // BFS adımı başına gecikme (üst sınır)
const FILL_TOTAL_MAX_MS = 750;   // en uzak hücreye ulaşma süresi (üst sınır)
const CELL_POP_MS = 240;         // tek hücrenin "örülme" animasyonu
const NUMBER_MIN_PX = 13;        // bu boyuttan küçük hücrelerde numara gösterilmez
const HINT_SCALE = 32;           // ipucu odaklanmasında hücre boyutu (px)
const TAP_SLOP = 8;              // bu kadar pikselden fazla kayarsa dokunma değil kaydırma

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const miniCanvas = $<HTMLCanvasElement>('minimap');
const miniCtx = miniCanvas.getContext('2d')!;
const miniWrap = $('minimap-wrap');
const miniView = $('mini-view');
const paletteEl = $('palette');
const progressText = $('progress-text');
const levelSelect = $<HTMLSelectElement>('level-select');
const levelLabel = $('level-label');
const completeEl = $('complete');
const toastEl = $('toast');

console.info(`Yarn Prototype v${__APP_VERSION__} · ${__BUILD__}`);

// ---------- Durum ----------
type LevelRef = { id: string; file: string; url?: string; modified?: string; local?: boolean };
let baseLevels: LevelRef[] = [];   // siteyle birlikte yayınlanan level'lar
let levelList: LevelRef[] = [];
let levelIndex = 0;
let level: Level | null = null;
let filled = new Uint8Array(0);        // oyun mantığı: dolduruldu mu
let shown = new Uint8Array(0);         // görsel: ilmek çizildi mi (animasyon bitince 1)
let remaining = new Int32Array(0);     // renk başına kalan hücre
let colorCells: Int32Array[] = [];     // renk başına hücre listesi
let filledCount = 0;
let selected = 0;
let peek = false;

let CELL = 20;                          // offscreen tahtada hücre başına piksel
let boardCanvas = document.createElement('canvas');
let boardCtx = boardCanvas.getContext('2d')!;
let srcCanvas = document.createElement('canvas'); // resmin aslı (peek için)
const spriteCache = new Map<string, HTMLCanvasElement>();

type Anim = { i: number; t0: number };
let anims: Anim[] = [];
type ThreadFx = { color: number; idx: Int32Array; dist: Int32Array; count: number; t0: number; step: number; maxD: number };
let threadFx: ThreadFx | null = null;
let shake: { i: number; t0: number } | null = null;
let pulse: { i: number; t0: number } | null = null;

const cam = { s: 10, ox: 0, oy: 0 };
let fitScale = 10;
let tween: { s0: number; s1: number; c0: [number, number]; c1: [number, number]; t0: number; dur: number } | null = null;
let W = 0, H = 0, DPR = 1;
let dirty = true;

// ---------- Yardımcılar ----------
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* yok say */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* yok say */ } },
};
const progressKey = (id: string) => `yarnproto:v1:${id}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (t: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const vibrate = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* yok */ } };

let toastTimer = 0;
function toast(msg: string, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms);
}

function view() {
  const cr = canvas.getBoundingClientRect();
  const top = (document.getElementById('topbar')!.getBoundingClientRect().bottom - cr.top || 56) + 6;
  const bottom = paletteEl.getBoundingClientRect().top - cr.top - 6;
  return { x: 0, y: top, w: W, h: Math.max(100, bottom - top) };
}

function sprite(ci: number, size: number) {
  const key = ci + ':' + size;
  let s = spriteCache.get(key);
  if (!s) { s = makeStitch(level!.colors[ci], size); spriteCache.set(key, s); }
  return s;
}
const SIZE_BUCKETS = [16, 24, 32, 48, 64, 96, 128, 160];
const bucketFor = (px: number) => SIZE_BUCKETS.find((b) => b >= px) ?? SIZE_BUCKETS[SIZE_BUCKETS.length - 1];

// ---------- Level yükleme ----------
async function loadLevelList() {
  const res = await fetch('levels/index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('levels/index.json okunamadı');
  const json = await res.json();
  baseLevels = json.levels as LevelRef[];
  let saved: DriveLevel[] = [];
  try { saved = JSON.parse(store.get(DRIVE_CACHE_KEY) || '[]'); } catch { /* yok say */ }
  lastDrive = saved;
  levelList = mergeLevels(baseLevels, saved);
  renderLevelOptions();
}

const DRIVE_CACHE_KEY = 'yarnproto:v1:drive-levels';
let lastDrive: DriveLevel[] = [];

// Bilgisayardan yüklenen level'lar (data URL olarak tarayıcıda saklanır)
const LOCAL_KEY = 'yarnproto:v1:local-levels';
type LocalLevel = { id: string; dataUrl: string };
let localLevels: LocalLevel[] = [];
try { localLevels = JSON.parse(store.get(LOCAL_KEY) || '[]'); } catch { localLevels = []; }

/** Öncelik: yerel > Drive > yerleşik. Aynı id'li level'ın yerine geçer, yeniler listeye eklenir. */
function mergeLevels(base: LevelRef[], drive: DriveLevel[]): LevelRef[] {
  const map = new Map<string, LevelRef>();
  for (const l of base) map.set(l.id, l);
  for (const d of drive) map.set(d.id, { id: d.id, file: d.id + '.png', url: driveFileUrl(d.fileId), modified: d.modified });
  for (const l of localLevels) map.set(l.id, { id: l.id, file: l.id + '.png', url: l.dataUrl, local: true });
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function renderLevelOptions() {
  levelSelect.innerHTML = '';
  levelList.forEach((l, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${i + 1} / ${levelList.length}  ·  ${l.id}${l.local ? '  (yerel)' : ''}`;
    levelSelect.appendChild(o);
  });
}

async function openLevel(index: number) {
  if (!levelList.length) return;
  levelIndex = (index + levelList.length) % levelList.length;
  const ref = levelList[levelIndex];
  levelSelect.value = String(levelIndex);
  levelLabel.textContent = `${levelIndex + 1} / ${levelList.length}`;
  const url = new URL(location.href);
  url.searchParams.set('level', ref.id);
  history.replaceState(null, '', url);

  let lv: Level;
  try {
    lv = await loadLevel(ref.url ?? 'levels/' + encodeURIComponent(ref.file), ref.id);
  } catch (e) {
    toast(String((e as Error).message));
    return;
  }
  stopAuto();
  level = lv;
  spriteCache.clear();
  anims = []; threadFx = null; shake = null; pulse = null; tween = null;
  completeEl.hidden = true;

  const n = lv.w * lv.h;
  filled = new Uint8Array(n);
  colorCells = lv.colors.map((_, ci) => new Int32Array(lv.totals[ci]));
  const fillPos = new Int32Array(lv.colors.length);
  for (let i = 0; i < n; i++) { const c = lv.cells[i]; if (c >= 0) colorCells[c][fillPos[c]++] = i; }

  // Kayıtlı ilerleme
  const saved = store.get(progressKey(lv.id));
  if (saved && saved.length === n) for (let i = 0; i < n; i++) filled[i] = saved.charCodeAt(i) === 49 && lv.cells[i] >= 0 ? 1 : 0;
  shown = filled.slice();
  remaining = new Int32Array(lv.totals);
  filledCount = 0;
  for (let i = 0; i < n; i++) if (filled[i]) { remaining[lv.cells[i]]--; filledCount++; }
  selected = Math.max(0, nextColor(-1));

  // Offscreen tahta
  CELL = clamp(Math.floor(2400 / Math.max(lv.w, lv.h)), 6, 24);
  boardCanvas = document.createElement('canvas');
  boardCanvas.width = lv.w * CELL;
  boardCanvas.height = lv.h * CELL;
  boardCtx = boardCanvas.getContext('2d')!;
  for (let i = 0; i < n; i++) if (lv.cells[i] >= 0) drawBoardCell(i);

  // Kaynak görsel (peek) ve minimap
  srcCanvas = document.createElement('canvas');
  srcCanvas.width = lv.w; srcCanvas.height = lv.h;
  const sctx = srcCanvas.getContext('2d')!;
  miniCanvas.width = lv.w; miniCanvas.height = lv.h;
  sizeMinimap();
  miniCtx.clearRect(0, 0, lv.w, lv.h);
  for (let i = 0; i < n; i++) {
    const c = lv.cells[i];
    if (c < 0) continue;
    sctx.fillStyle = lv.colors[c].hex;
    sctx.fillRect(i % lv.w, (i / lv.w) | 0, 1, 1);
    drawMiniCell(i);
  }

  buildPalette();
  fitCamera();
  updateProgress();
  if (filledCount === lv.paintable) showComplete();
  dirty = true;
}

function sizeMinimap() {
  if (!level) return;
  const box = $('app').classList.contains('wide') ? 140 : 96;
  const k = box / Math.max(level.w, level.h);
  miniCanvas.style.width = Math.round(level.w * k) + 'px';
  miniCanvas.style.height = Math.round(level.h * k) + 'px';
}

function nextColor(from: number): number {
  if (!level) return -1;
  const k = level.colors.length;
  for (let s = 1; s <= k; s++) { const c = (from + s + k) % k; if (remaining[c] > 0) return c; }
  return -1;
}

function saveProgress() {
  if (!level) return;
  let s = '';
  for (let i = 0; i < filled.length; i++) s += filled[i] ? '1' : '0';
  store.set(progressKey(level.id), s);
}

// ---------- Offscreen tahta & minimap ----------
function drawBoardCell(i: number) {
  const lv = level!;
  const c = lv.cells[i];
  const x = (i % lv.w) * CELL, y = ((i / lv.w) | 0) * CELL;
  if (shown[i]) {
    boardCtx.drawImage(sprite(c, CELL), x, y);
  } else {
    boardCtx.fillStyle = emptyFill(lv.colors[c].lum, c === selected);
    boardCtx.fillRect(x, y, CELL, CELL);
    if (CELL >= 10) {
      boardCtx.strokeStyle = 'rgba(0,0,0,0.08)';
      boardCtx.lineWidth = 1;
      boardCtx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
    }
  }
}

function drawMiniCell(i: number) {
  const lv = level!;
  const c = lv.cells[i];
  miniCtx.fillStyle = shown[i] ? lv.colors[c].hex : miniEmpty(lv.colors[c].lum);
  miniCtx.fillRect(i % lv.w, (i / lv.w) | 0, 1, 1);
}

function redrawColor(ci: number) {
  if (ci < 0 || !level) return;
  for (const i of colorCells[ci]) if (!shown[i]) drawBoardCell(i);
}

// ---------- Palet (makaralar) ----------
function spoolSvg(hex: string, n: number, uid: string) {
  let wraps = '';
  for (let y = 12; y <= 52; y += 4) wraps += `<line x1="9" y1="${y}" x2="45" y2="${y + 3.5}"/>`;
  return `<svg viewBox="0 0 54 66" aria-hidden="true">
    <defs><linearGradient id="g${uid}" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".35" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
    <rect x="9" y="8" width="36" height="50" fill="${hex}"/>
    <g stroke="#000" stroke-opacity=".18" stroke-width="1.4">${wraps}</g>
    <rect x="9" y="8" width="36" height="50" fill="url(#g${uid})"/>
    <rect x="3" y="2" width="48" height="8" rx="3" fill="#d9b88e"/><rect x="3" y="2" width="48" height="3" rx="1.5" fill="#ecd3ad"/>
    <rect x="3" y="56" width="48" height="8" rx="3" fill="#c49c6c"/>
    <circle cx="27" cy="33" r="11.5" fill="#fffdf8" stroke="#000" stroke-opacity=".12"/>
    <text x="27" y="33" text-anchor="middle" dominant-baseline="central" font-size="${n > 9 ? 12 : 14}" font-weight="800" fill="#3b2f2a">${n}</text>
  </svg>`;
}

function buildPalette() {
  const lv = level!;
  paletteEl.innerHTML = '';
  lv.colors.forEach((c, ci) => {
    const b = document.createElement('button');
    b.className = 'spool';
    b.dataset.ci = String(ci);
    b.setAttribute('aria-label', `Renk ${ci + 1}`);
    b.innerHTML = spoolSvg(c.hex, ci + 1, `${lv.id}_${ci}`) + '<div class="bar"><i></i></div><span class="check">✓</span>';
    b.addEventListener('click', () => selectColor(ci));
    paletteEl.appendChild(b);
  });
  updatePalette();
}

function updatePalette() {
  const lv = level!;
  paletteEl.querySelectorAll<HTMLElement>('.spool').forEach((el) => {
    const ci = Number(el.dataset.ci);
    el.classList.toggle('selected', ci === selected);
    el.classList.toggle('done', remaining[ci] === 0);
    (el.querySelector('.bar i') as HTMLElement).style.width = `${100 * (1 - remaining[ci] / lv.totals[ci])}%`;
  });
}

function selectColor(ci: number, scroll = true) {
  if (!level || ci === selected) return;
  const old = selected;
  selected = ci;
  redrawColor(old);
  redrawColor(ci);
  updatePalette();
  if (scroll) paletteEl.querySelector<HTMLElement>(`.spool[data-ci="${ci}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  dirty = true;
}

function updateProgress() {
  if (!level) return;
  const p = (filledCount / level.paintable) * 100;
  progressText.textContent = p >= 100 ? '100%' : `${p < 10 ? p.toFixed(1) : Math.floor(p)}%`;
}

// ---------- Oyun ----------
function tapCell(i: number, now: number) {
  const lv = level!;
  const c = lv.cells[i];
  if (c < 0 || filled[i]) return;
  if (c !== selected) {
    shake = { i, t0: now };
    vibrate(30);
    dirty = true;
    return;
  }
  const reg = regionFrom(lv, i);
  let maxD = 0;
  for (let k = 0; k < reg.count; k++) if (reg.dist[k] > maxD) maxD = reg.dist[k];
  const step = Math.min(FILL_STEP_MAX_MS, FILL_TOTAL_MAX_MS / (maxD + 1));
  let added = 0;
  for (let k = 0; k < reg.count; k++) {
    const j = reg.idx[k];
    if (filled[j]) continue;
    filled[j] = 1;
    added++;
    anims.push({ i: j, t0: now + reg.dist[k] * step });
  }
  if (!added) return;
  remaining[c] -= added;
  filledCount += added;
  threadFx = { color: c, idx: reg.idx, dist: reg.dist, count: reg.count, t0: now, step, maxD };
  vibrate(8);
  saveProgress();
  updatePalette();
  updateProgress();
  const total = maxD * step + CELL_POP_MS;
  if (remaining[c] === 0) {
    const nc = nextColor(c);
    window.setTimeout(() => { if (nc >= 0 && remaining[selected] === 0) selectColor(nc); }, Math.min(total, 900));
  }
  if (filledCount === lv.paintable) window.setTimeout(showComplete, total + 300);
  dirty = true;
}

function hint() {
  if (!level) return;
  if (remaining[selected] === 0) { const nc = nextColor(selected); if (nc < 0) return; selectColor(nc); }
  const cand: number[] = [];
  for (const i of colorCells[selected]) if (!filled[i]) cand.push(i);
  if (!cand.length) return;
  const i = cand[(Math.random() * cand.length) | 0];
  const s1 = clamp(Math.max(cam.s, HINT_SCALE), fitScale * 0.7, maxScale());
  const dur = 550;
  animateCameraTo(s1, [(i % level.w) + 0.5, ((i / level.w) | 0) + 0.5], dur);
  pulse = { i, t0: performance.now() + dur * 0.6 };
}

function showComplete() {
  if (!level) return;
  stopAuto();
  $('complete-sub').textContent = `Level ${level.id} · ${level.paintable} ilmek`;
  completeEl.hidden = false;
}

function resetLevel() {
  if (!level) return;
  stopAuto();
  if (!confirm('Bu level\'daki ilerleme silinsin mi?')) return;
  store.del(progressKey(level.id));
  openLevel(levelIndex);
}

// ---------- Admin: otomatik tamamlama ----------
// Butona basınca seçili renkten başlayarak kalan renkleri bölge bölge doldurur; tekrar basınca durur.
let autoTimer = 0;
const autoBtn = () => $('btn-auto');

function stopAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = 0;
  autoBtn().classList.remove('on');
}

function autoStep() {
  autoTimer = 0;
  if (!level || filledCount === level.paintable) { stopAuto(); return; }
  let pause = 0;
  if (remaining[selected] === 0) {
    const nc = nextColor(selected);
    if (nc < 0) { stopAuto(); return; }
    selectColor(nc);
    pause = 350; // renk değişiminde kısa bir duraklama
  }
  let target = -1;
  for (const i of colorCells[selected]) if (!filled[i]) { target = i; break; }
  if (target >= 0) tapCell(target, performance.now());
  // Kalan hücre sayısına göre hızlan: büyük resimler de makul sürede bitsin.
  const left = level.paintable - filledCount;
  const delay = clamp(left / 25, 40, 180) + pause;
  autoTimer = window.setTimeout(autoStep, delay);
}

function toggleAuto() {
  if (autoTimer) { stopAuto(); return; }
  if (!level || filledCount === level.paintable) return;
  autoBtn().classList.add('on');
  autoStep();
}

// ---------- Kamera ----------
const maxScale = () => Math.max(72, fitScale * 2);

function fitCamera() {
  if (!level) return;
  const v = view();
  fitScale = Math.min((v.w * 0.92) / level.w, (v.h * 0.92) / level.h);
  cam.s = fitScale;
  cam.ox = v.x + (v.w - level.w * cam.s) / 2;
  cam.oy = v.y + (v.h - level.h * cam.s) / 2;
  dirty = true;
}

function clampCamera() {
  if (!level) return;
  const v = view();
  cam.s = clamp(cam.s, fitScale * 0.7, maxScale());
  const bw = level.w * cam.s, bh = level.h * cam.s, m = 60;
  cam.ox = clamp(cam.ox, v.x + m - bw, v.x + v.w - m);
  cam.oy = clamp(cam.oy, v.y + m - bh, v.y + v.h - m);
}

function zoomAt(px: number, py: number, ns: number) {
  ns = clamp(ns, fitScale * 0.7, maxScale());
  cam.ox = px - ((px - cam.ox) * ns) / cam.s;
  cam.oy = py - ((py - cam.oy) * ns) / cam.s;
  cam.s = ns;
  clampCamera();
  dirty = true;
}

function boardCenter(): [number, number] {
  const v = view();
  return [(v.x + v.w / 2 - cam.ox) / cam.s, (v.y + v.h / 2 - cam.oy) / cam.s];
}

function setCenter(c: [number, number], s: number) {
  const v = view();
  cam.s = s;
  cam.ox = v.x + v.w / 2 - c[0] * s;
  cam.oy = v.y + v.h / 2 - c[1] * s;
}

function animateCameraTo(s1: number, c1: [number, number], dur: number) {
  tween = { s0: cam.s, s1, c0: boardCenter(), c1, t0: performance.now(), dur };
  dirty = true;
}

// ---------- Çizim ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  // Telefon önizlemesi sadece geniş pencerelerde anlamlı
  const canFrame = window.innerWidth >= 600;
  $('btn-device').style.display = canFrame ? '' : 'none';
  if (!canFrame) document.body.classList.remove('phone-frame');
  const app = $('app');
  app.classList.toggle('wide', app.clientWidth >= 700);
  sizeMinimap();
  const r = canvas.getBoundingClientRect();
  const keep = level ? boardCenter() : null;
  const wasFit = level ? Math.abs(cam.s - fitScale) < 0.01 : true;
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  if (level) {
    const v = view();
    const old = fitScale;
    fitScale = Math.min((v.w * 0.92) / level.w, (v.h * 0.92) / level.h);
    if (wasFit) fitCamera();
    else if (keep) { setCenter(keep, cam.s * (fitScale / old)); clampCamera(); }
  }
  dirty = true;
}

function frame(now: number) {
  requestAnimationFrame(frame);
  if (tween) {
    const t = clamp((now - tween.t0) / tween.dur, 0, 1);
    const e = easeInOut(t);
    const s = tween.s0 + (tween.s1 - tween.s0) * e;
    setCenter([tween.c0[0] + (tween.c1[0] - tween.c0[0]) * e, tween.c0[1] + (tween.c1[1] - tween.c0[1]) * e], s);
    clampCamera();
    if (t >= 1) tween = null;
    dirty = true;
  }
  const busy = anims.length > 0 || threadFx || shake || pulse;
  if (!dirty && !busy) return;
  dirty = false;
  draw(now);
}

function draw(now: number) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#f6f1ea';
  ctx.fillRect(0, 0, W, H);
  if (!level) return;
  const lv = level;
  const s = cam.s;

  // Görünen hücre aralığı
  const x0 = clamp(Math.floor(-cam.ox / s), 0, lv.w), x1 = clamp(Math.ceil((W - cam.ox) / s), 0, lv.w);
  const y0 = clamp(Math.floor(-cam.oy / s), 0, lv.h), y1 = clamp(Math.ceil((H - cam.oy) / s), 0, lv.h);

  // Gölge (tahtanın altında yumuşak bir zemin)
  if (peek) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, cam.ox, cam.oy, lv.w * s, lv.h * s);
  } else if (s * DPR <= CELL * 1.15) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(boardCanvas, cam.ox, cam.oy, lv.w * s, lv.h * s);
  } else {
    // Yakın plan: görünen hücreleri doğrudan, ekran çözünürlüğünde çiz
    const px = s * DPR;
    const bucket = bucketFor(px);
    ctx.imageSmoothingEnabled = true;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * lv.w + x;
        const c = lv.cells[i];
        if (c < 0) continue;
        const sx = cam.ox + x * s, sy = cam.oy + y * s;
        if (shown[i]) {
          ctx.drawImage(sprite(c, bucket), sx, sy, s + 0.5, s + 0.5);
        } else {
          ctx.fillStyle = emptyFill(lv.colors[c].lum, c === selected);
          ctx.fillRect(sx, sy, s + 0.5, s + 0.5);
          ctx.strokeStyle = 'rgba(0,0,0,0.09)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, s - 1, s - 1);
        }
      }
    }
  }

  // Örülme animasyonu
  if (anims.length) {
    const px = s * DPR;
    const bucket = bucketFor(Math.min(px, CELL * 2));
    const keep: Anim[] = [];
    for (const a of anims) {
      const t = (now - a.t0) / CELL_POP_MS;
      if (t < 0) { keep.push(a); continue; }
      if (t >= 1) {
        shown[a.i] = 1;
        drawBoardCell(a.i);
        drawMiniCell(a.i);
        if (!peek) {
          const x = a.i % lv.w, y = (a.i / lv.w) | 0;
          ctx.drawImage(sprite(lv.cells[a.i], bucketFor(px)), cam.ox + x * s, cam.oy + y * s, s + 0.5, s + 0.5);
        }
        continue;
      }
      keep.push(a);
      if (peek) continue;
      const x = a.i % lv.w, y = (a.i / lv.w) | 0;
      const k = 0.25 + 0.75 * easeOutBack(t);
      const cx = cam.ox + (x + 0.5) * s, cy = cam.oy + (y + 0.5) * s;
      const d = s * k;
      ctx.drawImage(sprite(lv.cells[a.i], bucket), cx - d / 2, cy - d / 2, d, d);
    }
    anims = keep;
  }

  // Numaralar
  if (!peek && s >= NUMBER_MIN_PX) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(s * 0.48)}px ui-rounded, system-ui, sans-serif`;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * lv.w + x;
        const c = lv.cells[i];
        if (c < 0 || filled[i]) continue;
        if (shake && shake.i === i) continue;
        ctx.fillStyle = c === selected ? '#1f1a17' : '#8f8a86';
        ctx.fillText(String(c + 1), cam.ox + (x + 0.5) * s, cam.oy + (y + 0.55) * s);
      }
    }
  }

  // Yanlış dokunuş: hücre titrer
  if (shake) {
    const t = (now - shake.t0) / 380;
    if (t >= 1) { shake = null; dirty = true; }
    else if (!peek) {
      const i = shake.i, c = lv.cells[i];
      const x = i % lv.w, y = (i / lv.w) | 0;
      const off = Math.sin(t * Math.PI * 7) * (1 - t) * Math.max(3, s * 0.18);
      const sx = cam.ox + x * s, sy = cam.oy + y * s;
      ctx.fillStyle = emptyFill(lv.colors[c].lum, false);
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#f3c7c7';
      ctx.fillRect(sx + off, sy, s, s);
      ctx.strokeStyle = '#d65a5a';
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.strokeRect(sx + off, sy, s, s);
      if (s >= NUMBER_MIN_PX) {
        ctx.fillStyle = '#7a2020';
        ctx.fillText(String(c + 1), sx + off + s / 2, sy + s * 0.55);
      }
    }
  }

  // İpucu halkası
  if (pulse) {
    const t = (now - pulse.t0) / 1800;
    if (t >= 1 || filled[pulse.i]) { pulse = null; dirty = true; }
    else if (t >= 0) {
      const x = pulse.i % lv.w, y = (pulse.i / lv.w) | 0;
      const cx = cam.ox + (x + 0.5) * s, cy = cam.oy + (y + 0.5) * s;
      for (let k = 0; k < 2; k++) {
        const p = (t * 2.2 + k * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, s * (0.6 + p * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,190,30,${(1 - p) * (1 - t * 0.6)})`;
        ctx.lineWidth = Math.max(2, s * 0.14);
        ctx.stroke();
      }
    }
  }

  // Makaradan resme uzanan iplik
  if (threadFx) {
    const fx = threadFx;
    const total = fx.maxD * fx.step + CELL_POP_MS;
    const el = now - fx.t0;
    if (el > total + 250) { threadFx = null; dirty = true; }
    else if (!peek) {
      const front = Math.min(fx.maxD, el / fx.step);
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < fx.count; k++) {
        const d = fx.dist[k];
        if (d <= front && d >= front - 1.5) { sx += fx.idx[k] % lv.w; sy += (fx.idx[k] / lv.w) | 0; n++; }
      }
      if (n) {
        const tx = cam.ox + (sx / n + 0.5) * s, ty = cam.oy + (sy / n + 0.5) * s;
        const spool = paletteEl.querySelector<HTMLElement>(`.spool[data-ci="${fx.color}"]`)?.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        const ax = spool ? spool.left + spool.width / 2 - cr.left : W / 2;
        const ay = spool ? spool.top + 30 - cr.top : H;
        const fade = el > total ? 1 - (el - total) / 250 : 1;
        const col = lv.colors[fx.color];
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + tx) / 2 + (tx > ax ? -40 : 40), Math.min(ay, ty) - 40, tx, ty);
        ctx.strokeStyle = `rgba(0,0,0,${0.18 * fade})`;
        ctx.lineWidth = clamp(s * 0.3, 3, 7) + 2;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${fade})`;
        ctx.lineWidth = clamp(s * 0.3, 3, 7);
        ctx.stroke();
      }
    }
  }

  updateMiniView();
}

function updateMiniView() {
  if (!level) return;
  const mw = miniCanvas.clientWidth, mh = miniCanvas.clientHeight;
  const kx = mw / level.w, ky = mh / level.h;
  let l = (-cam.ox / cam.s) * kx, t = (-cam.oy / cam.s) * ky;
  let r = l + (W / cam.s) * kx, b = t + (H / cam.s) * ky;
  l = clamp(l, 0, mw); r = clamp(r, 0, mw); t = clamp(t, 0, mh); b = clamp(b, 0, mh);
  const full = l <= 0.5 && t <= 0.5 && r >= mw - 0.5 && b >= mh - 0.5;
  miniView.style.display = full ? 'none' : 'block';
  miniView.style.left = 4 + l - 2 + 'px';
  miniView.style.top = 4 + t - 2 + 'px';
  miniView.style.width = Math.max(4, r - l) + 'px';
  miniView.style.height = Math.max(4, b - t) + 'px';
}

// ---------- Girdi ----------
const pointers = new Map<number, { x: number; y: number }>();
let gesture = { moved: false, sx: 0, sy: 0, t0: 0, lastDist: 0, lastMid: [0, 0] as [number, number] };

function localXY(e: PointerEvent | WheelEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localXY(e);
  pointers.set(e.pointerId, p);
  tween = null;
  if (pointers.size === 1) gesture = { moved: false, sx: p.x, sy: p.y, t0: performance.now(), lastDist: 0, lastMid: [p.x, p.y] };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
    gesture.lastMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    gesture.moved = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const p = localXY(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > TAP_SLOP) gesture.moved = true;
    if (gesture.moved) { cam.ox += p.x - prev.x; cam.oy += p.y - prev.y; clampCamera(); dirty = true; }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    cam.ox += mid[0] - gesture.lastMid[0];
    cam.oy += mid[1] - gesture.lastMid[1];
    if (gesture.lastDist > 0) zoomAt(mid[0], mid[1], cam.s * (d / gesture.lastDist));
    gesture.lastDist = d;
    gesture.lastMid = mid;
    dirty = true;
  }
});

function endPointer(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {
    const [a] = [...pointers.values()];
    gesture.lastMid = [a.x, a.y];
  }
  if (pointers.size === 0 && !gesture.moved && e.type === 'pointerup' && performance.now() - gesture.t0 < 600 && level) {
    const p = localXY(e);
    const x = Math.floor((p.x - cam.ox) / cam.s), y = Math.floor((p.y - cam.oy) / cam.s);
    if (!peek && x >= 0 && y >= 0 && x < level.w && y < level.h) tapCell(y * level.w + x, performance.now());
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  tween = null;
  const p = localXY(e);
  const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(p.x, p.y, cam.s * k);
}, { passive: false });

// Minimap: dokun/sürükle ile o noktaya git
function miniJump(e: PointerEvent) {
  if (!level) return;
  const r = miniCanvas.getBoundingClientRect();
  const bx = ((e.clientX - r.left) / r.width) * level.w;
  const by = ((e.clientY - r.top) / r.height) * level.h;
  tween = null;
  setCenter([clamp(bx, 0, level.w), clamp(by, 0, level.h)], cam.s);
  clampCamera();
  dirty = true;
}
miniWrap.addEventListener('pointerdown', (e) => { miniWrap.setPointerCapture(e.pointerId); miniJump(e); });
miniWrap.addEventListener('pointermove', (e) => { if (miniWrap.hasPointerCapture(e.pointerId)) miniJump(e); });

// ---------- Butonlar ----------
$('btn-hint').addEventListener('click', hint);
$('btn-reset').addEventListener('click', resetLevel);
$('btn-auto').addEventListener('click', toggleAuto);

// Mobil / masaüstü görünüm geçişi (tercih tarayıcıda hatırlanır)
const DEVICE_KEY = 'yarnproto:v1:phone-frame';
if (store.get(DEVICE_KEY) === '1') document.body.classList.add('phone-frame');
$('btn-device').addEventListener('click', () => {
  const on = document.body.classList.toggle('phone-frame');
  store.set(DEVICE_KEY, on ? '1' : '0');
  toast(on ? 'Telefon görünümü' : 'Masaüstü görünümü', 1200);
  resize();
});

// Drive'daki güncel level'ları al
let syncing = false;
$('btn-sync').addEventListener('click', async () => {
  if (syncing) return;
  if (!driveReady()) { toast('Drive bağlantısı kurulmamış (API anahtarı eksik)', 3500); return; }
  syncing = true;
  $('btn-sync').classList.add('busy');
  try {
    const drive = await listDriveLevels();
    const before = new Map(levelList.map((l) => [l.id, l.modified ?? '']));
    const currentId = levelList[levelIndex]?.id;
    store.set(DRIVE_CACHE_KEY, JSON.stringify(drive));
    lastDrive = drive;
    levelList = mergeLevels(baseLevels, drive);
    renderLevelOptions();
    const added = drive.filter((d) => !before.has(d.id)).length;
    const changed = drive.filter((d) => before.has(d.id) && before.get(d.id) !== '' && before.get(d.id) !== d.modified).length;
    const idx = Math.max(0, levelList.findIndex((l) => l.id === currentId));
    levelIndex = idx;
    levelSelect.value = String(idx);
    levelLabel.textContent = `${idx + 1} / ${levelList.length}`;
    const cur = drive.find((d) => d.id === currentId);
    if (cur && before.get(cur.id) !== cur.modified && before.get(cur.id) !== '') await openLevel(idx); // açık level Drive'da güncellendiyse yeniden yükle
    toast(`Drive: ${drive.length} level · ${added} yeni${changed ? ` · ${changed} güncellendi` : ''}`, 3000);
  } catch (e) {
    toast(String((e as Error).message), 4000);
  } finally {
    syncing = false;
    $('btn-sync').classList.remove('busy');
  }
});
$('btn-peek').addEventListener('click', () => {
  peek = !peek;
  $('btn-peek').classList.toggle('on', peek);
  dirty = true;
});
const fsBtn = $('btn-fullscreen');
const fsEnabled = !!(document.fullscreenEnabled || (document as any).webkitFullscreenEnabled);
if (!fsEnabled) fsBtn.style.display = 'none';
fsBtn.addEventListener('click', async () => {
  try {
    const d = document as any;
    if (document.fullscreenElement || d.webkitFullscreenElement) await (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else { const el = document.documentElement as any; await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()); }
  } catch { toast('Tam ekran bu tarayıcıda desteklenmiyor'); }
});
document.addEventListener('fullscreenchange', () => fsBtn.classList.toggle('on', !!document.fullscreenElement));
levelSelect.addEventListener('change', () => openLevel(Number(levelSelect.value)));
$('btn-next').addEventListener('click', () => openLevel(levelIndex + 1));
$('btn-replay').addEventListener('click', () => { if (level) { store.del(progressKey(level.id)); openLevel(levelIndex); } });

window.addEventListener('keydown', (e) => {
  if (e.key === 'h') hint();
  else if (e.key === 'ArrowRight' && e.shiftKey) openLevel(levelIndex + 1);
  else if (e.key === 'ArrowLeft' && e.shiftKey) openLevel(levelIndex - 1);
  else if (e.key === '0') fitCamera();
});
window.addEventListener('resize', resize);
document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS Safari sayfa zoom'unu engelle

// ---------- Başlat ----------
(async () => {
  resize();
  requestAnimationFrame(frame);
  try {
    await loadLevelList();
  } catch (e) {
    toast(String((e as Error).message), 6000);
    return;
  }
  const want = new URLSearchParams(location.search).get('level');
  const idx = Math.max(0, levelList.findIndex((l) => l.id === want));
  await openLevel(idx);
})();

// ---------- Bilgisayardan level yükleme ----------
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/png,.png';
fileInput.multiple = true;
fileInput.hidden = true;
document.body.appendChild(fileInput);
$('btn-upload').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.length) importFiles([...fileInput.files]); });

// Masaüstünde PNG'yi pencereye sürükleyip bırakmak da aynı işi yapar.
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) importFiles(files);
});

const readAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

async function importFiles(files: File[]) {
  const pngs = files.filter((f) => f.type === 'image/png' || /\.png$/i.test(f.name));
  if (!pngs.length) { toast('Sadece PNG dosyaları yüklenebilir'); return; }
  const ids: string[] = [];
  for (const f of pngs) {
    const id = f.name.replace(/\.png$/i, '');
    const dataUrl = await readAsDataUrl(f);
    localLevels = localLevels.filter((l) => l.id !== id).concat({ id, dataUrl });
    store.del(progressKey(id)); // aynı isimle yeniden yüklenirse eski ilerleme geçersiz
    ids.push(id);
  }
  store.set(LOCAL_KEY, JSON.stringify(localLevels));
  levelList = mergeLevels(baseLevels, lastDrive);
  renderLevelOptions();
  toast(ids.length === 1 ? `Yüklendi: ${ids[0]}` : `${ids.length} level yüklendi`, 2000);
  await openLevel(Math.max(0, levelList.findIndex((l) => l.id === ids[0])));
}
