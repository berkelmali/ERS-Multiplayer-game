# ERS — Oyun Tasarım Şeması (GDD)

> **Durum:** yaşayan belge · **Sürüm:** 1 (22 Eylül 2026, v3.17.0 ile birlikte) ·
> **Yazan rol:** Game Designer (agentfires `game-designer` personası)
>
> Bu dosya yeni kural **icat etmez**. Oyunun zaten uyguladığı tasarım kararlarını —
> kodda, `CLAUDE.md`'de, `DECISIONS.md`'de ve konsey tutanaklarında dağınık duran
> kararları — tek yerde toplar. Her sütunun yanında dayandığı kanıt yazılıdır;
> kanıtı gösterilemeyen bir sütun bu listeye girmez.
>
> **Kullanım:** yeni bir özellik ya da denge değişikliği, uygulanmadan önce
> aşağıdaki **§5 Kapı Listesi**'nden geçer. Geçemiyorsa ya değişir ya da bu belge
> bilinçli olarak güncellenir — sessizce değil.

---

## 1. Tasarım sütunları

| # | Sütun | Oyuncu ne hisseder | Kanıt (nerede zaten uygulanıyor) |
|---|---|---|---|
| **P1** | **Refleks tek beceridir; ölçüm kutsaldır.** | "Kaybettiysem daha yavaştım, şanssız değildim." | `fairSlap.js` — en düşük refleks kazanır, ilk varan değil · Günlük Meydan Okuma kişisel ayarları ezer (CLAUDE §18: *"daha yumuşak bir ayar aynı masada daha yüksek puan satın alırdı"*) · reklam maç sırasında asla (*"50 ms takılma 72 puan eder"*) |
| **P2** | **Oyun sana nedenini söyler.** | "Neden yanıldığımı biliyorum." | Slap Forensics koçu: isabet / kıl payı / ev kuralı (CLAUDE §6.34) · hata ekranı *ne* ve *neden*'i ayrı söyler (ERS-08) · kural rozeti ilk karttan önce |
| **P3** | **Ekonomi kozmetiktir, yereldir ve hak edilir.** | "Paramı oynayarak kazandım; hiçbir şey maçı satın almıyor." | Coin yalnızca skin alır (CLAUDE §6.27) · galibiyet +40 / kayıp −15, denge noktası %27 (§6.31) · çıkış cezası (§6.32) |
| **P4** | **Herkes için aynı tahta.** | "Karşılaştırma adil, aynı kartlarla oynadık." | Günlük deste tarihten üretilir · paylaşım linki tarihi taşır (ERS-14) |
| **P5** | **Söz verilen şey gerçektir.** | "Oyun bana yalan söylemiyor." | DECISIONS #13/#48 — "render oluyor ama çalışmıyor" 12+ kez · #43 diriliş dört kilitliydi · `check-promises` kapısı |
| **P6** | **Zarif ve ölçülü; bir özellik indiği ekrana kendi görsel dilini getiremez.** | "Her şey aynı oyunun parçası gibi duruyor." | #28 v3.9.0 lobi geri alındı · v3.13.0 arcade butonlar geri alındı · v3.12.0 hesap kartı kendi paletini uydurdu, geri çekildi |

**Tema:** Antik Mısır. Menü sanatı, piramitler, Horus'un Gözü kartı, Ra adını
taşıyan çark. Bu, dekorasyon değil dünyadır — ama P6 gereği *ekranların
çerçevesine* değil, *dünyaya ait nesnelere* (çark, kart sanatı) uygulanır.

---

## 2. Oyun döngüleri

### Anlık (0–3 saniye)
- **Eylem:** kart iner → desen tanınır → şaplak.
- **Geri bildirim:** koç çipi (P2), refleks hız göstergesi, kıl payı bandı.
- **Ödül:** yığın; içsel tatmin — "gördüm ve ilk ben vurdum".

### Oturum (5–15 dakika)
- **Hedef:** 52 kartı topla ya da son ayakta kalan ol.
- **Gerilim:** kalkan serisi (3 şaplak → 30 sn koruma), yüz kartı düelloları,
  bot kişilikleri (Blitz / Kaos / Kobra), eleme → izleyici → **saplayarak dönüş**.
- **Çözülüş:** zafer / yenilgi ekranı, MVP anı, ±coin.

### Efsaneler (v3.18.0) — oyunun kendi dünyası ve kendi kuralları
- **Tanrıların Masası:** üst koltukta bir tanrı; canı var, senin tarafının her
  geçerli şaplağı onu yaralar. Botlarla ya da çok oyunculu masada (§3.4).
- **Duat Yolculuğu:** kartsız, ölü başlarsın; on tur içinde vurarak dirilirsin;
  aldığın her el gecenin bir saatidir, on ikinci kapıda güneş doğar (§3.5).
- **Firavunun Mezarı:** yüz kartı meydan okuması bir karara dönüşür — üç kartın
  açık, hangisini atacağını seçersin; yedi oda, yedi bekçi (§3.6).

### Uzun vade (günler–haftalar)
- **Günlük Meydan Okuma:** günde bir puanlı koşu, herkese aynı pozisyon (P1, P4).
- **Ra'nın Çarkı:** günde bir çeviriş, kademeli merdiven (bkz. §3.2).
- **Coin → skin:** 11 satın alınabilir skin, toplam **2950** coin.
- **Slap IQ:** yerel beceri raporu — isabet, kapsama, refleks; desen başına döküm.
- **Bot Nemesis, maç geçmişi, oturum serisi.**

**Bilinen boşluk (konseyin kendi kaydı):** *"Kazanma dışında başarı metriği
yok"* — Slap IQ bunu **raporluyor** ama oyuncuya bir **hedef** vermiyor. Bir
rapor, üzerinde karar verilmedikçe bir döngü değildir.

---

## 3. Ekonomi

### 3.1 Kaynaklar ve havuzlar

| Kalem | Değer | Gerekçe |
|---|---|---|
| Galibiyet | **+40** | Denge noktası %27; 4 kişilik masada adil pay %25 → kazanmaya çalışan herkes net pozitif |
| Kayıp / berabere | **−15** | Bilerek kaybederek coin biriktirmeyi caydırır |
| Maçtan çıkış | **−15** | Kaybı çıkışla atlatmayı kapatır; gerçek kayıpla **aynı** değer (tek kaynak) |
| Ra'nın Çarkı | beklenen değer **≈12.7 / gün** (bkz. §3.2) | Günlük küçük bir hediye; kazanmanın yerini tutmaz |
| Desen ustalığı | işaret başına **10 / 20 / 40**, desen başına ömür boyu en fazla **70** (bkz. §3.3) | Galibiyet ödülünden türetildi; her işaret bir kez |
| Tanrıların Masası | tanrıyı yenmek sıradan bir galibiyettir (**+40**), kaybetmek sıradan bir kayıp (**−15**); muska kozmetiktir | Ayrı bir ödül yok: düello bir maçtır |
| Duat Yolculuğu | şafak bir galibiyettir (**+40**), Duat'ta kalmak bir kayıp (**−15**) | Aynı gerekçe |
| Firavunun Mezarı | **ilk** tam soygun bir kez **+40** (bir galibiyet); başka hiçbir şey ödemez | Çiftlenemez (G3) |
| Skinler (havuz) | 150 – 500, toplam **2950** | Kozmetik ilerleme |

### 3.2 Ra'nın Çarkı — kademe tablosu (v3.17.0)

| Kademe | Dilimler (8) | Boş | Yükselme | Coin toplamı | Kademe içi EV |
|---|---|---|---|---|---|
| Bronz | 10 · **Boş** · 15 · ↑Gümüş · 5 · **Boş** · 20 · 10 | 2 | 1 | 60 | 7.50 |
| Gümüş | 30 · **25** · 50 · ↑Altın · 25 · 40 · **25** · 35 | **0** | 1 | 230 | 28.75 |
| Altın | 100 · **50** · 150 · 200 · 75 · **50** · 125 · 50 | **0** | 0 | 800 | 100.00 |

Kalın yazılanlar v3.17.0'da **Boş**'un yerine gelen dilimler. Gümüş'te ikinci
25 bir dilim kaydırıldı: iki 25 yan yana durmasın, gösterge bir sınırda
dururken "hangisi" sorusu doğmasın. Sıra koddakiyle aynıdır.

**Kural — "tırmanan boş dönmez":** Gümüş ve Altın'da Boş dilim yoktur.
- **Oyuncu ne hisseder:** Altın'a ulaşmak her gün **1/64** ihtimaldir (iki kez
  üst üste 1/8). O merdiveni tırmanıp "Boş" görmek, oyunun en nadir anını
  cezaya çevirir. Risk Bronz'da kalır — merdivenin anlamı da oradan gelir.
- **Yerine ne gelir, sayısı nereden:** her Boş, **o kademenin zaten var olan
  en düşük ödülüne** dönüşür (Gümüş **25**, Altın **50**). Yeni bir sayı
  uydurulmadı; kademenin taban ödülü taban olur. Tepe ödüller değişmedi, yani
  merdivenin hedefi şişmedi.
- **Ekonomiye etkisi (türetildi, yazılmadı):** Bronz'dan başlayan günlük EV
  **11.68 → 12.66** (+%8.4). Bir galibiyet 40 eder; çarkın günlük değeri bir
  galibiyetin **üçte birinin** altında kalır.

**Kural — "çark kazanmanın yerini tutmaz":** çarkın Bronz'dan başlayan günlük
beklenen değeri, bir galibiyetin (40) üçte birinden (**13.33**) küçük kalmalıdır.
Bir maç oynamak, üç günlük çarktan değerli olmalı — P3'ün "hak edilir" yarısı.
Kapı bunu **tablodan hesaplayarak** ölçer; sayı elle yazılmaz.

### 3.3 Desen ustalığı (v3.17.0, konsey ERS-16)

Slap IQ panelinde her desen için **son 30 fırsat** tutulur (yakalanan = 1,
kaçan ya da yanlış = 0). Pencere dolduğunda oran bir işarete çevrilir.

| İşaret | Eşik | Eşik nereden | Ödül | Ödül nereden |
|---|---|---|---|---|
| Bronz | ≥ %55 | Panelin B notu bandı | 10 | galibiyet ÷ 4 |
| Gümüş | ≥ %70 | Panelin A notu bandı | 20 | galibiyet ÷ 2 |
| Altın | ≥ %85 | Panelin S notu bandı | 40 | galibiyet × 1 |

- **Oyuncu ne hisseder:** "iyi misin" sorusunun cevabı tek bir nottan çıkıp
  desen desen bir hedefe dönüşür. Neyin eksik olduğunu panel söyler (P2).
- **Sayılan masalar:** Orta, Zor, Challenger, çok oyunculu ve Günlük Meydan
  Okuma. Kolay'da botlar fazla zaman bırakır; orada kazanılan işaret az
  anlamlı olurdu. Bu fark panelde tek satırda yazılıdır (G4).
- **Çiftlenemez (G3):** her işaret bir kez ödenir; istatistik sıfırlama
  işaretleri silmez, yani sıfırla-yeniden-kazan döngüsü yoktur. Coin yalnızca
  tek yazıcıdan (`CardSkins.addCoins`) geçer.
- **Maça dokunmaz (G1):** sadece zaten verilmiş kararları sayar; zamanlama,
  girdi ve puan aynıdır.
- **Kendi dilini getirmez (G6):** panelin yüzeyini kullanır; tek yeni şey üç
  küçük madeni nokta. Duyuru, koçun mevcut çipinden yapılır.

### 3.4 Tanrıların Masası (v3.18.0)

| Tanrı | Can | Hız (katman × kişilik) | Güç — gerçek bir kural ya da etki |
|---|---|---|---|
| Bastet | 80 | Kolay × Blitz | Dokuz Can: şaplakla aldığı her el 10 iyileştirir, en fazla 9 kez |
| Thoth | 100 | Normal × Kobra, hatasız | Kusursuz Hesap: asla yanlış vurmaz; Dörtlü Sıra açık |
| Hathor | 110 | Normal × Blitz | Aşk: Evlilik onu 3 kat yaralar; kendi Evliliği 20 iyileştirir |
| Anubis | 120 | Zor × Kobra | Kalbin Tartısı: yanlış vuruş ikinci kartı yakar (sonuncusunu asla); Üçlü açık |
| Set | 130 | Zor × Kaos | Kum Fırtınası: şaplakla aldığı her elde en çok kartı olandan 2 çalar (sonuncusunu asla); Üst-Alt açık |
| Ra | 160 | Şampiyon | Güneşin Yolu: bütün kurallar; yarı canda öğle — bir kez 15 iyileşir, Blitz hızına geçer |

- **Hasar türetildi:** 10 × √(Çift'in sıklığı / desenin sıklığı), gerçek matchSlap
  ile ölçüldü — Çift 10, Sandviç 11, Üst-Alt 12, Onluk 13, Evlilik 23, Dörtlü
  Sıra ve Üçlü 30 (tavan). Senin şaplağın tam, masadaki diğer iki oyuncununki
  (bot) yarım. Oyuncuya "rahip" denmez — konsey ERS-18.
- **İki düşüş yolu:** canı sıfırla (kartlar kimde olursa olsun) YA DA bütün
  kartları sıradan yoldan kazan — ikisi de muskayı verir ve sıradaki tanrıyı
  açar (ERS-18 düzeltme 1).
- **Can, Çift cinsinden sayılır** (8–16 şaplak) ve merdivende hiç düşmez.
- **Çok oyunculu:** host bir tanrı seçer (yendiği tanrılardan); tanrı son bot
  koltuğuna oturur, kendi kurallarını getirir. Canı ODADA tutulur ve şaplağı
  veren aynı transaction içinde değişir (pantheonRoom.js) — dört istemci aynı
  sayıyı görür. İnsanın şaplağı tam, botunki yarım; tanrı düşünce onu en çok
  yaralayan insan kazanır (eşitlikte son darbe). Veritabanı kuralı değişmedi.

### 3.5 Duat Yolculuğu (v3.18.0)

- Kartsız başlarsın; üç gölge (Ba, Ka, Akh) 52 kartı tutar.
- **On tur** (operatör kararı) içinde vurarak dirilmelisin. Bir tur = kartı olan
  her gölgeden bir kart. Duat'tan yanlış vuruş Ammit'i besler: bir tur gider.
- Aldığın her el bir saat; **7. saatte Apep** — o saat gölgeler bir katman hızlı.
- **12. kapı = şafak = galibiyet.** Yeniden kartsız kalırsan Duat'a dönersin,
  geçtiğin saatler kalır. Motorun kendi diriliş yolu kullanılır (game.js).
- İlk diriliş yolculuğun girişidir, geri dönüş değil: maç sonu "comeback"
  satırı onu saymaz (ERS-18 düzeltme 5).

### 3.6 Firavunun Mezarı (v3.18.0)

- Merkezden girince önce kurallar ekranı açılır (Alıştırma gibi): dört satır,
  tuzak kuralı ayrıca işaretli; "Tekrar gir" onu atlar (ERS-18 düzeltme 3).
- Başlangıç destesi 16; elinde **3 kart açık**, hangisini atacağını seçersin.
- ERS'in meydan okuma sayıları: J 1, Q 2, K 3, A 4 hak.
- **Kendi kurduğun desen bekçinindir** — vurursan tuzak (bir kart yanar).
  Neden: kartlarını görerek her deseni bedava ele çevirmek baskın strateji
  olurdu; simülasyonda kural olmadan her oyun kazanılıyordu.
- Yedi oda, bekçiler bot merdiveninden (Kolay → Şampiyon); odadan sonra 3
  hazineden 1 kart seçilir (biri her zaman yüz kartı).
- Simülasyon (500 koşu): hızlı oyuncu ~%86, ortalama oyuncu ~%53 tam soygun;
  kayıpların çoğu Lahit'te — son oda gerçek bir final.

---

## 4. Görsel ve hareket dili

- **Ekran çerçeveleri** (panel, buton, modal) ortak yüzeyi kullanır:
  `--panel-bg`, `--panel-border`, `.btn primary/secondary`, Outfit.
- **Dünyaya ait nesneler** (Ra'nın Çarkı, kart sanatı) temayı taşıyabilir.
- Hareket **ağırlık** taşır: taş ve bronz kaymaz; sürtünür, tıklar, oturur.
- Çark bir **günlük hediye**: sıcak ve samimi görünür — soğuk koyu tonlar ve
  neon parlama değil, boyalı yüzler ve metal (v3.17.0, operatör kararı).
- Görünüm kararı operatöründür; hareket isteği görünümü kendiliğinden değiştirmez.
- `prefers-reduced-motion` her zaman onurlandırılır.
- Görsel iş akıl yürütmeyle değil **render edip bakarak** doğrulanır (DECISIONS #35).

---

## 5. Kapı listesi — yeni bir özellik bunlardan geçer

| # | Soru | Geçme ölçütü |
|---|---|---|
| G1 (P1) | Maç zamanlamasını, girdi gecikmesini ya da puanlı bir sonucu etkiliyor mu? | Hayır — ya da konsey kararıyla açıkça |
| G2 (P2) | Oyuncuya **tek satırda** açıklanabiliyor mu? | Evet, dört dilde |
| G3 (P3) | Coin üretiyorsa: çiftlenebilir mi? Sıfırlanıp yeniden alınabilir mi? | Hayır; her sayının gerekçesi yazılı |
| G4 (P4) | Karşılaştırma içeriyorsa: herkes aynı ölçütle mi ölçülüyor? | Evet, ya da ölçütün farkı oyuncuya söyleniyor |
| G5 (P5) | Uçtan uca çalıştığını kanıtlayan bir kapı var mı? | Mutasyonla sınanmış test |
| G6 (P6) | İndiği ekrana kendi paletini / buton stilini getiriyor mu? | Hayır |

---

## 6. Değişiklik günlüğü

| Sürüm | Değişiklik |
|---|---|
| 1 (v3.17.0) | İlk sürüm. Sütunlar mevcut kanıttan çıkarıldı. Çarkta Gümüş/Altın Boş dilimi kaldırıldı (§3.2). |
| 1.2.1 (v3.18.0) | Konsey ERS-18'in beş düzeltmesi (kartla kazanılan tanrı da düşer; "rahip" yerine "diğer iki oyuncu"; Mezar'a kurallar ekranı; bölüm başlıkları ortak panel stili, altın yalnızca dünya nesnelerinde; Duat girişi comeback sayılmaz). ERS-19: sekme YOK — Efsaneler'de önce Yolculuklar, sonra Tanrıların Masası (COUNCIL-v3.18.0-tabs.md). |
| 1.2 (v3.18.0) | Efsaneler: Tanrıların Masası (botlarla + çok oyunculu), Duat Yolculuğu, Firavunun Mezarı (§2, §3.4–3.6). Kum Saati denendi, operatör reddetti (COUNCIL-ERS-17-hourglass-rejected.md). |
| 1.1 (v3.17.0) | Çark dönüşü antik hareket modeline geçti (sürtünme, geri yaslanma, perçinde tık; tek saat). Çark **sıcak ve samimi** boyandı: turkuaz/terrakota yüzler, perçinli metal çember, tebeşir sayılar + damgalı coin, Ra'nın güneşi, bronz mandal (operatör kararı). Desen ustalığı eklendi (§3.3), konsey ERS-16. |
