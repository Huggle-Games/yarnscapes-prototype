// Herkese açık Google Drive klasöründeki PNG'leri tarayıcıdan listeler (Drive API v3 + API anahtarı).
// Anahtar derleme sırasında DRIVE_API_KEY ortam değişkeninden gelir (GitHub Actions secret).

const folderMatch = /folders\/([A-Za-z0-9_-]+)/.exec(__DRIVE_FOLDER_URL__);
export const DRIVE_FOLDER_ID = folderMatch ? folderMatch[1] : '';
export const DRIVE_API_KEY = __DRIVE_API_KEY__;
export const driveReady = () => !!(DRIVE_FOLDER_ID && DRIVE_API_KEY);

export type DriveLevel = { id: string; fileId: string; modified: string };

export async function listDriveLevels(): Promise<DriveLevel[]> {
  const out: DriveLevel[] = [];
  let pageToken = '';
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', `'${DRIVE_FOLDER_ID}' in parents and trashed = false`);
    u.searchParams.set('fields', 'nextPageToken, files(id, name, modifiedTime)');
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('key', DRIVE_API_KEY);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await fetch(u, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Drive listesi alınamadı (HTTP ${res.status})`);
    const json = await res.json();
    for (const f of json.files ?? []) {
      if (typeof f.name === 'string' && /\.png$/i.test(f.name)) {
        out.push({ id: f.name.replace(/\.png$/i, ''), fileId: f.id, modified: f.modifiedTime ?? '' });
      }
    }
    pageToken = json.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export const driveFileUrl = (fileId: string) =>
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(DRIVE_API_KEY)}`;
