# Yarn Prototype

Yün/ilmek temalı "sayıya göre boya" oyununun sadece gameplay içeren web prototipi. Menü yok: açılınca direkt level başlar.

## Oynanış
- Alttaki makaralardan bir renk seç. O renkteki boş hücreler koyu gri olur.
- Seçili renkteki bir hücreye dokun: o hücreye **8 yönde (artı + çapraz) komşu** aynı renkteki tüm hücreler örülür.
- Yanlış renkteki hücreye dokununca hücre titrer, ceza yok.
- Bir renk bitince sıradaki renk otomatik seçilir.
- 💡 İpucu: seçili renkteki rastgele bir boş hücreye zoom yapar ve hücreyi işaretler.
- Sol üstteki minimap: tüm resmi ve ekranda görünen alanı gösterir, dokunarak/sürükleyerek o bölgeye gidilir.
- Üst bar: versiyon, level seçici, tam ekran, resmin aslını göster (göz), level'ı sıfırla.
- Zoom: iki parmak (mobil) veya fare tekerleği. Kaydırma: tek parmak/fare ile sürükle.
- İlerleme tarayıcıda (localStorage) level bazında saklanır.
- Klavye: `h` ipucu, `0` ekrana sığdır, `Shift + ←/→` önceki/sonraki level.

Linkle belirli level açmak: `?level=10002`

## Level ekleme
Level = şeffaf arka planlı pixel art PNG. Her opak piksel bir hücre, her farklı renk bir makara. Numaralar koyudan açığa sıralanır.

1. **Google Drive:** `levels-source.json` içine herkese açık Drive klasör linkini yaz. GitHub Actions saatte bir (ya da Actions → "Build & Deploy" → *Run workflow* ile hemen) klasördeki PNG'leri indirip siteyi yeniden yayınlar. Dosya adı (uzantısız) level id'si olur. Not: indirme aracı (gdown) klasör başına en fazla 50 dosya çeker.
2. **Repo:** PNG'yi `public/levels/` klasörüne koyup push'la.

## Geliştirme
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```
Vite + TypeScript + Canvas 2D, framework yok. `main` branch'e her push GitHub Pages'e otomatik yayınlanır.
