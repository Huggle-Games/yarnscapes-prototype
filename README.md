# Yarn Prototype

Yün/ilmek temalı "sayıya göre boya" oyununun sadece gameplay içeren web prototipi. Menü yok: açılınca direkt level başlar.

## Oynanış
- Alttaki makaralardan bir renk seç. O renkteki boş hücreler koyu gri olur.
- Seçili renkteki bir hücreye dokun: o hücreye **8 yönde (artı + çapraz) komşu** aynı renkteki tüm hücreler örülür.
- Yanlış renkteki hücreye dokununca hücre titrer, ceza yok.
- Bir renk bitince sıradaki renk otomatik seçilir.
- 💡 İpucu: seçili renkteki rastgele bir boş hücreye zoom yapar ve hücreyi işaretler.
- Sol üstteki minimap: tüm resmi ve ekranda görünen alanı gösterir, dokunarak/sürükleyerek o bölgeye gidilir.
- Üst bar: level seçici, tam ekran, mobil/masaüstü görünüm (sadece geniş ekranda), Drive'dan güncel level'ları al, resmin aslını göster (göz), admin otomatik tamamlama, level'ı sıfırla.
- Zoom: iki parmak (mobil) veya fare tekerleği. Kaydırma: tek parmak/fare ile sürükle.
- İlerleme tarayıcıda (localStorage) level bazında saklanır.
- Klavye: `h` ipucu, `0` ekrana sığdır, `Shift + ←/→` önceki/sonraki level.

Linkle belirli level açmak: `?level=10002`

## Level ekleme
Level = şeffaf arka planlı pixel art PNG. Her opak piksel bir hücre, her farklı renk bir makara. Numaralar koyudan açığa sıralanır.

1. **Google Drive:** `levels-source.json` içine herkese açık Drive klasör linkini yaz. GitHub Actions saatte bir (ya da Actions → "Build & Deploy" → *Run workflow* ile hemen) klasördeki PNG'leri indirip siteyi yeniden yayınlar. Dosya adı (uzantısız) level id'si olur. Not: indirme aracı (gdown) klasör başına en fazla 50 dosya çeker.
2. **Bilgisayardan (yükle butonu ya da PNGyi pencereye sürükle-bırak):** Sadece o tarayıcıda görünür, listede "(yerel)" diye işaretlenir. Hızlı test için.
3. **Oyun içinden (bulut butonu):** Drive klasörünü tarayıcıdan tarar, yeni level'ları listeye ekler, güncellenmişleri yeniler. Liste tarayıcıda hatırlanır. Bunun için bir Google Drive API anahtarı gerekir:
   - Google Cloud Console → yeni proje → *APIs & Services → Library* → **Google Drive API**'yi etkinleştir.
   - *Credentials → Create credentials → API key*. Anahtarı kısıtla: *Application restrictions → Websites* → `https://huggle-games.github.io/*`, *API restrictions* → Google Drive API.
   - GitHub repo → *Settings → Secrets and variables → Actions → New repository secret*: adı `DRIVE_API_KEY`.
   - Actions → Build & Deploy → *Run workflow*.
   Not: Anahtar sitenin JS'ine gömülür, bu yüzden mutlaka site adresi ve Drive API ile kısıtlanmalı. Sadece herkese açık dosyaları okuyabilir.
4. **Repo:** PNG'yi `public/levels/` klasörüne koyup push'la.

## Geliştirme
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```
Vite + TypeScript + Canvas 2D, framework yok. `main` branch'e her push GitHub Pages'e otomatik yayınlanır.
