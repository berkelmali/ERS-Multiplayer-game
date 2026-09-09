# Deploy — ERS

Canlı: **https://ers-card-game.web.app** · Firebase projesi: `ers-card-game`

İki yol var. Kurulumdan sonra birincisi varsayılan olur, ikincisi elde kalır.

| | Ne zaman | Ne yapıyorsunuz |
|---|---|---|
| **CI/CD** (GitHub Actions) | Normal akış | `git push` — gerisi otomatik |
| **Elle** (`deploy.bat`) | CI kapalıysa, acil durumda | Çift tıkla |

---

## Bir kerelik kurulum

Üç adım, toplam ~5 dakika. Bundan sonra deploy diye bir iş kalmıyor.

### 1. Depoyu güncelleyin

v3.0.0 dosyalarının çoğu henüz commit'lenmedi:

```bash
git add -A
git commit -m "feat: v3.0.0 — rule engine, slap coach, fair netcode, daily challenge + CI/CD"
git push origin main
```

> İlk push'ta Actions çalışır ama **deploy adımı sırlar olmadan düşer.** Bu beklenen — 2. ve 3. adımdan sonra Actions sekmesinden yeniden çalıştırın (Re-run jobs), ya da bir sonraki push'u bekleyin.

### 2. `FIREBASE_WEB_CONFIG` sırrı

`public/js/firebaseConfig.js` `.gitignore`'da ve git'te **takipli değil**. Temiz bir CI checkout'unda o dosya yok — ve uygulamadaki her modül onu import ediyor. Yani bu sır olmadan deploy edilen site tamamen boş açılır. Pipeline dosyayı bu sırdan üretiyor.

Değerleri elle yazmayın, mevcut dosyanızdan bastırın:

```bash
npm run config:print
```

Çıkan tek satır JSON'u kopyalayın →
GitHub → **Settings → Secrets and variables → Actions → New repository secret**
Ad: `FIREBASE_WEB_CONFIG` · Değer: yapıştırın.

> Firebase **web** config'i aslında bir sır değil — zaten her ziyaretçinin tarayıcısına düz metin olarak gidiyor, güvenliği sağlayan şey güvenlik kuralları. Burada sır olarak tutulmasının tek sebebi deponun dosyayı takipsiz tutma kararına saygı göstermek. İsterseniz `git add -f public/js/firebaseConfig.js` deyip bu adımı tamamen atlayabilirsiniz; meşru bir tercih.

### 3. `FIREBASE_SERVICE_ACCOUNT` sırrı

Actions'ın Firebase'e kendini tanıtması için. İki yol:

**A — En az yetki (önerilen).**
[IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=ers-card-game) → **Create service account** (`github-actions-deploy`) → şu rolleri verin:

| Rol | Ne için |
|---|---|
| `Firebase Hosting Admin` | Hosting deploy — zorunlu |
| `Firebase Rules Admin` | Firestore kuralları — sadece *Deploy rules* workflow'unu kullanacaksanız |
| `Firebase Realtime Database Admin` | RTDB kuralları — aynı şekilde |

Sonra **Keys → Add key → Create new key → JSON** → inen dosyanın **tamamını** `FIREBASE_SERVICE_ACCOUNT` sırrına yapıştırın.

**B — Hızlı yol.** Firebase Console → ⚙ **Project settings → Service accounts → Generate new private key**. Aynı şekilde yapıştırın. Tek fark: bu anahtar proje üzerinde `Editor` taşır — pipeline'ın ihtiyacından fazla. Tek kişilik bir proje için kabul edilebilir, ama A daha temiz.

**Bu JSON gerçek bir kimlik bilgisi.** İndirdiğiniz dosyayı depoya koymayın (`.gitignore` zaten `serviceAccount*.json` ve `*credential*.json` kalıplarını yakalıyor) ve yapıştırdıktan sonra diskten silin.

---

## Kurulumdan sonra

`main`'e her push → testler koşar → geçerse canlıya çıkar. Başka bir şey yapmanız gerekmiyor.

Elle tetiklemek isterseniz: Actions → **Deploy** → *Run workflow*.

### Pipeline ne yapıyor

`.github/workflows/verify.yml` — ortak kalite kapısı, hem CI'da hem deploy öncesinde **aynı** çalışır:

| Kontrol | Yakaladığı hata |
|---|---|
| 163 birim testi | Kural motoru, hakemlik matematiği, puanlama |
| `node --check` (53 dosya) | Manuel testte hiç import edilmemiş bir dosyadaki sözdizimi hatası |
| Referans bütünlüğü | Yeniden adlandırılmış modül, yanlış yazılmış yol — build adımı olmadığı için tarayıcıda 404, başka hiçbir yerde hata yok |
| Dil anahtarı eşitliği | Eksik çeviri: `get()` `undefined` döner, İngilizce metne düşer, sessizce yayınlanır |
| Kural aynası drift'i | `functions/slapRules.js` elle düzenlenmişse — offline ve online farklı kural uygular |
| Tarayıcı smoke testi | Uygulamanın gerçekten açılıp oynanabildiği: ayarlar, Ev Kuralları değişmezi, günlük panel, Slap IQ kadranı, tam offline maç, koçun üç durumu, sıfır konsol hatası |

`deploy.yml` bunların hepsi geçtikten sonra:
1. `FIREBASE_WEB_CONFIG`'ten `firebaseConfig.js` üretir; dosya yoksa ya da içinde hâlâ `YOUR_` placeholder'ı varsa **deploy'u reddeder**
2. Hosting'e çıkar
3. Canlı siteyi `curl` ile çekip `package.json`'daki sürümü **gerçekten sunuyor mu** diye bakar (5 deneme). Yeşil bir deploy adımı sadece yüklemenin çalıştığını kanıtlar; bu adım insanların açtığı sitenin doğru sürüm olduğunu kanıtlar.

Deploy'lar `deploy-production` concurrency grubunda — iki deploy asla üst üste binmez ve devam eden bir deploy iptal edilmez.

> İsterseniz GitHub → Settings → Environments → `production` altına **required reviewer** ekleyin; o zaman her canlı deploy sizin onayınızı bekler.

---

## Güvenlik kuralları — ayrı ve bilerek zor

Kurallar canlı veri erişimini değiştirir. Yanlış bir dosya her oyuncuyu kendi profilinden kilitler ya da veritabanını herkese açar. Bu yüzden **hiçbir zaman otomatik değil**, push'a bağlı değil ve onay cümlesi ister:

Actions → **Deploy rules** → *Run workflow* → hedefi seçin → `confirm` alanına `DEPLOY-RULES` yazın.

Workflow, göndermeden önce dosyaların tam içeriğini çalıştırma özetine basar; yani "ne değişti?" sorusunun cevabı kaydın kendisinde durur.

### Günlük Meydan Okuma için gerekli

Global günlük tablo yeni bir koleksiyon kullanıyor: `daily_challenges/{YYYY-MM-DD}/scores/{uid}`. Kural gitmeden yazma `permission-denied` alır. **Oyun bundan etkilenmiyor** — kod hatayı yakalayıp uyarı basıyor ve skoru yerelde tutuyor — ama tablo boş kalır.

> ⚠️ **İlk gönderimden önce karşılaştırın.** v3.0.0'a kadar bu projede `firestore.rules` dosyası yoktu; canlı kurallar konsoldan elle düzenlenmişti. Bu dosya `FIRESTORE_RULES.md`'den yeniden kuruldu. Konsolda yapılıp dokümana yazılmamış bir değişiklik varsa, göndermek onu **ezer**. Konsol → Firestore Database → Rules ekranını açıp `firestore.rules` ile karşılaştırın, farkı dosyaya işleyin. İkisi eşitlendikten sonra dosya tek kaynak olur.

`database.rules.json` zaten depoda ve güncel; değiştirmediyseniz göndermeye gerek yok.

---

## Elle deploy (yedek yol)

CI kapalıysa ya da acele varsa, bu klasörde:

```
deploy.bat
```

Testleri koşar, kural aynasını doğrular, sonra `--only hosting` deploy eder. Test düşerse deploy hiç başlamaz. Giriş yapılı değilse bir kez `npx firebase-tools login`.

macOS/Linux/WSL: `./deploy.sh`

---

## Deploy sonrası hızlı kontrol

Ctrl+F5 (zaten `index.html` ve `.js`/`.css` için `no-store` başlığı var).

| Kontrol | Beklenen |
|---|---|
| Ana menü alt yazısı | `Developer Berk Elmalı - v3.0.0` |
| Yeni butonlar | 🗓️ Günlük Meydan Okuma · 🧠 Slap IQ |
| Ayarlar → Ev Kuralları | Dört satır, her biri mini kartlarla (`7♠ 7♥`) |
| Botlarla oyna → hatalı bas | Masanın üstünde kırmızı gerekçe çipi |
| Günlük panel | Tarih, seed mührü, tablo |
| Konsol (F12) | Hata yok |

Günlük tablo "No scores yet today" yerine kırmızı hata gösteriyorsa Firestore kuralları henüz gönderilmemiştir.

---

## Bilinen sınırlar

**Çok oyunculu adil slap hakemliği ve günlük tablo canlı Firebase'e karşı hiç çalıştırılmadı.** Saf mantık 163 birim testiyle, tüm arayüz akışı headless tarayıcıyla doğrulandı; RTDB/Firestore entegrasyonu yalnızca gözden geçirildi. İlk çok oyunculu maçı iki cihazla denerken F12 konsolunu açık tutun.

**`FirebaseSync.USE_SERVER_VALIDATION` bayrağını açmayın.** Cloud Functions yolu contest mantığını içermiyor; açılırsa hakemlik sessizce eski "ilk varan kazanır" davranışına döner (CLAUDE.md §6.35).

**Cloud Functions bu pipeline'da deploy edilmiyor.** `functions/` hiç yayınlanmadı ve bilinçli olarak öyle bırakıldı (CLAUDE.md §7.4, Faz 2–3).
