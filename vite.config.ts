import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const levelsSource = JSON.parse(readFileSync('./levels-source.json', 'utf8'));
let build = (process.env.GITHUB_SHA || '').slice(0, 7);
if (!build) {
  try { build = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { build = 'dev'; }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD__: JSON.stringify(build),
    __DRIVE_FOLDER_URL__: JSON.stringify(levelsSource.driveFolderUrl || ''),
    // Tarayıcıda kullanılan, sadece site adresine kısıtlı Drive API anahtarı (GitHub secret: DRIVE_API_KEY)
    __DRIVE_API_KEY__: JSON.stringify(process.env.DRIVE_API_KEY || ''),
  },
});
