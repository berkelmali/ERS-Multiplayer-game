# ERS — yol haritası (15 Eylül 2026)

Bu dosya, bu seansta **yapılan** işleri değil, **yapılmayanları** sıralar.
Sıra keyfi değil: her adım kendinden sonrakinin ön koşulu.

---

## Şimdi: Search Console'da iki düzeltme

### 1. `/en/rules` satırını sil — o bir site haritası değil

Ekranda "Gönderilen site haritaları" listesinde iki satır var:

| Site haritası | Durum |
|---|---|
| `/en/rules` | Getirilemedi |
| `/sitemap.xml` | Getirilemedi |

`/en/rules` bir **sayfa**, bir site haritası değil. Site Haritaları kutusuna
girildi ama oraya ait değil; Google onu XML olarak ayrıştırmaya çalışır,
HTML bulur ve kalıcı olarak kırmızı bir satır olarak listede durur.

- Satırın sağındaki **⋮** → **Site haritasını kaldır**.
- O sayfanın asıl yeri: üstteki arama çubuğu (**URL denetimi**) →
  `https://ers-card-game.web.app/en/rules` → **Dizine eklenmeyi iste**.

### 2. `sitemap.xml` "Getirilemedi" — dosya tarafında sorun yok, ölçüldü

Sitenin dışından, Google'ın göreceği şekilde çekildi:

- `sitemap.xml` → **13 `<loc>`**, kök öğe geçerli `<urlset>`,
  doğru `sitemaps.org` ad alanı, ilk girdi sitenin kökü.
- `robots.txt` → hiçbir şeyi engellemiyor (`Allow: /`) ve
  `Sitemap:` satırı doğru adresi gösteriyor.

Yani dosya sunuluyor, geçerli ve erişilebilir. "Getirilemedi", Google'ın
**henüz başarılı bir çekim yapmadığını** söyler — hata değil, durum. Site
haritası bugün gönderildi ve doğrulama da bugün yapıldı.

**Yapılacak:** birkaç gün bekle. Hâlâ kırmızıysa satırı silip yeniden gönder.
Üç günden fazla sürerse bana söyle — o zaman sunucu başlıklarına bakarız,
şimdi bakmak erken.

> Not: bu bekleme, bu seansın dört kez öğrettiği dersin aynısı — enstrüman
> henüz konuşmadıysa sonuç yok demek değildir.

---

## Sıra 1 — Hiç raporlanmamış canlı kontroller

Bunlar kodla yapılamaz ve hiçbiri teyit edilmedi. Yarım saat sürer.

- [ ] About'a **orta tuşla** tıkla → `/en/about` ayrı sekmede açılmalı:
      koyu zemin, Mısır görseli, cam panel, üstte altın wordmark, altta dil seçici
- [ ] Açılan sayfada dil seçiciden **Türkçe** → metin Türkçe, adres `/tr/rules`
- [ ] `/de/about` ve `/ru/privacy` adreslerini elle yaz → açılmalı
- [ ] `/olmayanbirsey` → **404 sayfası** gelmeli. Oyun açılırsa rewrite geri gelmiş
- [ ] Ana sayfada kaynağı görüntüle → `a href` **iki** kez geçmeli
- [ ] Kaynakta `google-site-verification` görünmeli (deploy sonrası)
- [ ] **v3.16.3 testi:** F12 → Ağ → ⋮ → Ağ isteği engelleme → `fonts.googleapis.com`
      ekle → yenile. Oyun **açılmalı**, konsolda
      `[ers] optional resource failed, continuing:` satırı olmalı.
      Bu, altı denemede üretemediğim önce/sonra kıyasının "sonra" ayağı.

---

## Sıra 2 — Commit

Ağaçta commit edilmemiş iş var ve biriktiriyor:

- v3.16.3 (boot ağı + kapı 66 + iki konsey tutanağı) — `commit.bat` hazır, çalıştırılmadı
- Search Console meta etiketi, onu koruyan kapı, `deploy.bat` notları
- Bu dosya

`commit.bat` v3.16.3 mesajını taşıyor. Doğrulama etiketi işi ondan sonra
geldiği için mesajda yok; ya şimdi çalıştırıp etiketi ayrı bir commit'e
bırakırsın, ya da bana söyle, mesajı ikisini kapsayacak şekilde güncelleyeyim.

---

## Sıra 3 — İçerik turu (AdSense'in asıl kaldıracı)

**Konseyin iki turda da cevap alamadığı itiraz bu.** Google "yetersiz içerik"
dedi; v3.16.0 turu **gezinme** üretti. İkisi aynı şey değil.

Ölçüm: 12 üretilen sayfanın **8'i 350 kelimenin altında**, ve dördü diğer
dördünün çevirisi. Tarayıcıya erişim verildi, madde verilmedi.

Jeneratör yerinde olduğu için bu artık bir **sözlük düzenlemesi** —
`localization.js`'e yazarsın, 4 dilde 12 sayfa kendiliğinden güncellenir,
drift kapısı da tutarlılığı garanti eder.

Önerilen yeni bölümler (sayfa başına 800+ kelime hedefi):

| Konu | Nereye |
|---|---|
| Slap desenleri: her desenin neye benzediği, tipik kaçırma anları | rules |
| ERS varyantları: bölgesel ev kuralları ve neden farklılaştıkları | rules |
| Refleks antrenmanı: ölçülebilir pratik yöntemleri | rules |
| Slap IQ nasıl hesaplanıyor — formül ve neden öyle | about |
| Kurallar SSS: gerçekten sorulan sorular | rules |

**Uyarı:** bu, dört dile çeviri demek. İngilizce yazıp diğer üçünü
makine çevirisiyle doldurmak, "aynı metnin dört kopyası" itirazını
büyütür, küçültmez. Hangi dillere gerçekten yazacağımıza önce karar verelim.

---

## Sıra 4 — Güvenlik borcu (konsey ERS-10'dan devir)

B2 (gameRooms host-yetkili) **Savunulamaz** çıktı — tasarım ve öncelik
reddedildi, `gameRooms`'un açık olduğu gerçeği değil. Konseyin yerine
önerdiği sıra, aynen duruyor ve hiçbiri yapılmadı:

1. **Skor tablosu kapısı.** `users/{uid}` keyfi self-write'a izin veriyor,
   ve çok oyunculu galibiyetler `score` alanını artırırken tablo
   `totalScore` okuyor. İki ayrı kusur, biri güvenlik biri tutarlılık.
   **Bu, listedeki en yüksek getirili iş.**
2. **B2-dar:** uid değişmezliği, `tableId` ve `houseRules` değişmez,
   `hostId` ∈ `playerIds`, `gameStarted` monoton.
3. Gerçek host yetkisi — yalnızca Blaze planında anlamlı.

---

## Sıra 5 — Temizlik (acelesi yok)

- **Dal adı:** `release/v3.13.0` artık v3.16.x taşıyor. `git branch -m` tek satır.
  Sorun çıkarmaz, sadece tarihi okuyanı yanıltır.
- **Smoke ↔ emulator.** v3.15.1'de adı konan boşluk: emulator kapısı
  **kuralı** elle yazılmış yazmalara karşı sınıyor, **uygulamanın yazma
  sırasını** değil. O yüzden host olarak ayrılma hatasını yakalayamadı.
  Kapatmanın yolu smoke'u emulator'e bağlamak; kendi turunu hak ediyor.

---

## Sıra 6 — AdSense yeniden inceleme

**En sona bilerek kondu.** Sıra 1 ve 3 bitmeden isteme.

AdSense → **Siteler** → ers-card-game.web.app → kod yerleşimini onayla →
**İleri** → **İncelemeyi iste**. Google'ın kendi süresi: genelde birkaç gün,
**bazen 2–4 hafta**.

İnceleyen, Google'ın sayfaları görebildiği bir site görmeli. Bugün istersen
gördüğü şey hâlâ pratikte tek sayfalık bir site olur — ilk reddin gerekçesi
tam olarak buydu.

---

### Kaynaklar
- [What to do when your site is not ready to show ads — AdSense Help](https://support.google.com/adsense/answer/12176698?hl=en)
- [Build and Submit a Sitemap — Google Search Central](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Ask Google to Recrawl Your Website — Google Search Central](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
