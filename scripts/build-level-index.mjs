// public/levels içindeki tüm PNG'leri listeleyip public/levels/index.json üretir.
import { readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../public/levels/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
const id = (f) => f.replace(/\.png$/i, '');
files.sort((a, b) => id(a).localeCompare(id(b), 'en', { numeric: true }));
const levels = files.map((f) => ({ id: id(f), file: f }));
writeFileSync(new URL('index.json', dir), JSON.stringify({ levels }, null, 2));
console.log(`levels/index.json: ${levels.length} level (${levels.map((l) => l.id).join(', ')})`);
