# ERS Web Game — CLAUDE.md

> **Amaç:** Bu dosya projeyi devralan her mühendise (veya AI asistana) gereken her teknik detayı sağlar.
> Başka bir şirkete satılacak kadar kapsamlı tutulmuştur. Her bölüm güncel kod davranışına dayanır.

---

## 1. Proje Özeti

**ERS** (Egyptian Rat Screw), tarayıcıda oynanan gerçek zamanlı çok oyunculu kart oyunudur.

| Özellik | Detay |
|---|---|
| **Oyun Modu 1** | Offline — 1 insan vs 3 yapay zeka botu |
| **Oyun Modu 2** | Online — Firebase Realtime Database üzerinden gerçek zamanlı, 2–4 insan oyuncu (eksik slot botlarla doldurulur) |
| **Oyuncu Sayısı** | Her oyunda sabit **4 slot**. Boş slotlar her zaman bot'tur. |
| **Hosting** | Firebase Hosting |
| **Build Adımı** | **Yok.** Native ES modülleri, `public/` doğrudan servis edilir. |
| **Firebase SDK** | `10.7.1` — `gstatic.com` CDN'den module import ile yüklenir. |
| **Dil Desteği** | Çok dilli (`localization.js` — 72 KB, büyük i18n sözlüğü, 253 anahtar × 4 dil) |
| **Tema Desteği** | 5 tema: classic, blue, dark, green, red |

---

## 2. Dizin Yapısı

```
ers-web/
├── public/
│   ├── index.html              # Tek sayfalık uygulama kabuğu (~36 KB)
│   │                           # Tüm "ekranlar" div panelleri; class toggle ile geçiş
│   ├── style.css               # Tüm stiller (76 KB, TEK dosya — kesinlikle bölme)
│   ├── js/
│   │   ├── main.js             # Giriş noktası — DOMContentLoaded, tüm init sırası burada
│   │   ├── game.js             # Çekirdek oyun motoru — GameState nesnesi (24 KB) + forceTimeUp() (v2.9.0, bkz. §6.24)
│   │   ├── slapRules.js        # TEK kaynak slap kural tanımları — game.js ve firebaseSync.js buradan import ETMELI
│   │   ├── eventbus.js         # Micro pub/sub — EventBus.on/emit/off
│   │   ├── gameManager.js      # Mod geçişi: 'bots' | 'multiplayer'
│   │   ├── botGameMode.js      # Offline bot oyun orkestrasyonu (564 byte — çok basit)
│   │   ├── multiplayerMode.js  # Multiplayer istemci mantığı (20 KB)
│   │   ├── firebaseSync.js     # RTDB dinleyici + transactional yazma — yetkili sunucu (47 KB)
│   │   ├── firebaseConfig.js   # Firebase app, rtdb, functions init
│   │   ├── matchmaking.js      # Otomatik eşleştirme kuyruğu (Firestore queues koleksiyonu)
│   │   ├── reconnectManager.js # Sayfa yüklendiğinde aktif oturuma yeniden bağlanma
│   │   ├── ai.js               # AIController — bot kart oynatma ve slap zamanlama + BotPersonalities (§6.15) + Bot Table Talk (§6.25)
│   │   ├── ui.js               # UIManager — kart render, animasyonlar, HUD (48 KB) + Perfect Slap (§6.19) + Danger Zone (§6.21)
│   │   ├── tableManager.js     # Fiziksel masa düzeni, koltuk konumları, kart görselleri (28 KB)
│   │   ├── audioManager.js     # SFX ve BGM — Web Audio API (13 KB) + tension drone (§6.21)
│   │   ├── victoryScreen.js    # Oyun sonu ekranı — istatistik paneli, konfeti, yeniden oyna, streak banner, share button, MVP Moment (§6.23)
│   │   ├── rulesPanel.js       # Kurallar paneli JS kontrolcüsü (16 satır, kısa) — GERÇEK metin içeriği burada DEĞİL,
│   │   │                       # index.html'de data-i18n etiketli <div class="rules-section"> bloklarında yaşıyor ve
│   │   │                       # Localization.apply() tarafından çalışma anında localization.js'deki gerçek metinle
│   │   │                       # değiştiriliyor. Önceki CLAUDE.md sürümü bunu "içerik yok" diye yanlış tanımlamıştı —
│   │   │                       # düzeltildi (bkz. §9).
│   │   ├── lobbyUI.js          # Lobi UI — masa oluşturma, katılma, bekleme odası
│   │   ├── profileUI.js        # Profil modalı ve istatistik görünümü (22 KB)
│   │   ├── auth.js             # AuthSystem — Firebase Auth (e-posta + Google)
│   │   ├── userProfile.js      # UserProfile — Firestore profil okuma/yazma
│   │   ├── scoreSystem.js      # Oyun içi istatistik biriktirme + Firestore yazma
│   │   ├── leaderboard.js      # Firestore skor tablosu sorgusu (top-10)
│   │   ├── settings.js         # Settings.config — zorluk, animasyon, dil, tema, ses + Comfort Mode (§6.18) + matchLength (§6.24)
│   │   ├── localization.js     # i18n dizgileri (72 KB — büyük dosya, dokunurken 4 dil paritesini script ile doğrula)
│   │   ├── parallax3d.js       # Ana menü 3D parallax / CSS tilt efekti — artık Settings.config.reducedMotion'a saygılı (v2.9.0)
│   │   ├── streakTracker.js    # [YENİ v2.9.0] Oturum içi galibiyet serisi takibi — bkz. §6.16
│   │   ├── resultCard.js       # [YENİ v2.9.0] Paylaşılabilir maç sonu canvas kartı — bkz. §6.17
│   │   ├── tutorialMode.js     # [YENİ v2.9.0] İzole Pratik/Öğretici Modu — bkz. §6.14
│   │   ├── botNemesis.js       # [YENİ v2.9.0] Kalıcı bot-kişilik galibiyet takibi — bkz. §6.22
│   │   ├── matchTimer.js       # [YENİ v2.9.0] Blitz Mode geri sayımı — bkz. §6.24
│   │   ├── cardSkins.js        # [YENİ v2.9.0] Kart skinleri + Coin ekonomisi (salt-kozmetik) — bkz. §6.27
│   │   └── shopUI.js           # [YENİ v2.9.0] Mağaza ekranı — bkz. §6.28
│   ├── assets/
│   │   ├── blue_game.jpg       # Mavi tema — oyun arka planı
│   │   ├── blue_menu.jpg       # Mavi tema — menü arka planı
│   │   ├── dark_game.jpg
│   │   ├── dark_menu.jpg
│   │   ├── green_game.jpg
│   │   ├── green_menu.jpg
│   │   ├── red_game.jpg
│   │   ├── red_menu.jpg
│   │   ├── game.jpg            # Klasik tema — oyun arka planı
│   │   ├── menu.jpg            # Klasik tema — menü arka planı
│   │   └── logo.png
│   └── audio/
│       ├── card_place.mp3      # Kart oynandığında SFX
│       ├── slap.mp3            # Geçerli slap SFX
│       ├── invalid_slap.mp3    # Geçersiz slap SFX
│       ├── win.mp3             # Oyun sonu SFX
│       ├── menu_music.mp3      # Menü BGM (~4.2 MB)
│       └── gameplay_music.mp3  # Oyun BGM (~5.2 MB)
├── firebase.json               # Hosting yapılandırması (güvenlik başlıkları dahil)
├── database.rules.json         # RTDB güvenlik kuralları — henüz v2.9.0 değişikliği YOK, bkz. §7.4 Faz 3
├── functions/                   # [YENİ v2.9.0] Sunucu tarafı doğrulama — henüz deploy edilmedi, bkz. §7.4
│   ├── package.json             # "type": "module" — ESM, Node 20
│   ├── index.js                 # attemptSlap / attemptPlayCard onCall sarmalayıcıları
│   ├── gameLogic.js             # Saf, Firebase SDK'sız transaction mantığı (test edilebilir)
│   └── slapRules.js             # public/js/slapRules.js'in ELLE senkronize edilen kopyası
├── test_gameLogic.mjs           # [YENİ v2.9.0] `node test_gameLogic.mjs` — 53 birim test, 53/53 geçiyor
└── COUNCIL.md                  # Canlı tasarım yol haritası ve sorgulama aracı
```

---

## 3. Uygulama Başlatma Sırası (`main.js`)

`DOMContentLoaded` tetiklendiğinde şu sırayla init çağrılır:

```
Settings.init()          → localStorage'dan config yükle, tema/dil uygula
UIManager.init()         → DOM bağlamları, EventBus dinleyicileri
AIController.init()      → turnChanged + cardPlayed dinleyicileri
RulesPanel.init()
VictoryScreen.init()
Parallax3D.init()        → Mobilde no-op (< 769px)
AudioManager.init()      → EventBus SFX bağlamaları, BGM autoplay defer
AuthSystem.init()        → onAuthStateChanged → EventBus 'authStateChanged'
UserProfile.init()       → 'authStateChanged' dinleyicisi → Firestore yükle
ProfileUI.init()
ScoreSystem.init()
Leaderboard.init()
LobbyUI.init()
```

İlk kullanıcı tıklamasında (click/touchstart) `AudioManager.playBGM('menuBGM')` çağrılır — tarayıcı autoplay politikası nedeniyle load anında çalıştırılmaz.

Kimlik doğrulanmışsa `ReconnectManager.checkActiveSession()` çağrılır.

---

## 4. Çekirdek Mimari

### 4.1 İletişim: EventBus (`eventbus.js`)

Tüm modüller arası iletişim `EventBus` üzerinden geçer. **UI katmanından GameState'e doğrudan import yapma.** Modüller arası bağımlılık her zaman event'ler üzerinden kurulur.

**Temel EventBus olayları:**

| Olay | Payload | Açıklama |
|---|---|---|
| `gameStarted` | — | Oyun başlatıldı |
| `restartGame` | — | Aynı modda yeniden başlat |
| `cardPlayed` | `{ playerId, card }` | Bir kart pile'a eklendi |
| `slapAttempt` | `playerId` | Oyuncu slap denedi |
| `invalidSlap` | `{ playerId, burned, reason? }` | Geçersiz slap, kart yakıldı |
| `pileWon` | `{ winnerId, reason, indices, reactionTime, totalAwarded? }` | Pile kazanıldı |
| `challengeStarted` | `{ active, attackerId, defenderId, chancesLeft }` | Yüz kartı challenge başladı |
| `challengeUpdated` | challenge nesnesi | Kalan şans azaldı |
| `turnChanged` | `playerId` veya `-1` | Aktif oyuncu değişti; `-1` = temizle |
| `syncTurnTimer` | `{ activeId, duration }` | UI progress bar süresini senkronize et |
| `fastSlapBonus` | `playerId` | < 400ms'de slap (sadece insan oyuncusu için) |
| `shieldEarned` | `playerId` | 3 ardışık slap ile kalkan aktif |
| `shieldExpired` | `playerId` | Kalkan 30s doldu, pasif |
| `shieldShattered` | `{ playerId }` | Kalkan geçersiz slap ile parçalandı |
| `gameOver` | `winnerId` veya `-1` (beraberlik) | Oyun bitti |
| `gameAbandoned` | `playerId` | Multiplayer oda terk edildi |
| `gameStateChanged` | `'menu'` \| `'gameplay'` | 3D sahne yaşam döngüsü yönetimi |
| `authStateChanged` | `user` | Firebase auth durumu değişti |
| `gameSynced` | `roomData` | Ham RTDB snapshot'ı yerel ile senkronize edildi |
| `botReplacement` | `{ oldName, newName }` | Bağlantısı kesilen insan bot ile değiştirildi |
| `showEmoji` | `{ playerId, emoji }` | Uzak oyuncu emoji tepkisi gönderdi |
| `profileLoaded` | `userData` veya `null` | Firestore profil yüklendi |
| `scoreUpdated` | `newScore` | Skor değişti |
| `resurrected` | `playerId` | Elenen oyuncu pile kazanarak geri döndü |
| `musicToggled` | `boolean` | Müzik açıldı/kapandı |

---

### 4.2 GameState (`game.js`)

Singleton nesnesi. Tüm offline oyun durumunu tutar:

```javascript
GameState = {
    players: [[], [], [], []],    // Her oyuncunun kart dizisi
                                   // [0]: insan (offline) veya lokal oyuncu (online)
    pile: [],                      // Mevcut el'in kartları (üst = son eleman)
    burnPile: [],                  // Geçersiz slap/timeout cezası kartları (pile'dan AYRI)
    activePlayerId: 0,             // Kimin sırası
    challenge: {
        active: false,
        attackerId: null,          // Yüz kartını oynayan
        defenderId: null,          // Karşılık vermesi gereken
        chancesLeft: 0             // Kalan kart sayısı
    },
    streaks: [0, 0, 0, 0],        // Her oyuncunun ardışık slap kazanma sayısı
    gameStarted: boolean,
    gameOver: boolean,
    isMultiplayer: boolean,        // MultiplayerMode tarafından true yapılır
    humanEliminated: boolean,      // İnsan sıfır karta düştüğünde
    challengeResolverActive: boolean, // Kilit: pile sweep süreci devam ediyor
    lastPlayTime: timestamp,       // Spam koruması + fast slap tespiti
    lastSlapWinTime: timestamp,    // Çift slap race condition engelleyici (500ms grace)
    stats: {                       // Oyun sonu ekranı için istatistikler
        bestReflex: ms,            // En hızlı geçerli slap (ms)
        cardsWon: number,          // Kazanılan toplam kart sayısı
        burns: number,             // Yakılan kart sayısı (geçersiz slap/timeout)
        resurrections: number      // Sıfır karttan geri dönme sayısı
    }
}
```

**Kritik kural — Kart düzeni:**
- Kartlar **üstten çekilir** (`shift()`) — `players[id][0]` en üstteki kartdır.
- Kazanılan kartlar **alta eklenir** (`push()`).
- `winPile()` çağrısında: `players[winnerId].push(...burnPile, ...pile)` — yanmış kartlar önce, pile sırası korunur.

**Başlatma:**
```javascript
GameState.init()  // Yeni 52 kartlık deste oluşturur, shuffle, 4'e eşit dağıtır (13'er)
window.GameState = this  // Tarayıcı konsolundan test için exposed
```

---

### 4.3 Slap Kuralları — Tek Kaynak: `slapRules.js`

> **ÖNEMLİ:** Slap mantığı `slapRules.js`'te tanımlanmıştır. `game.js` ve `firebaseSync.js` buradan import etmelidir. Kuralları başka yerde çoğaltma.

```javascript
export const SLAP_RULES = {
    doubles:  pile => pile[-1].rank === pile[-2].rank,
    tens:     pile => her ikisi <= 10 VE toplamı === 10,
    marriage: pile => (K+Q veya Q+K),
    sandwich: pile => pile[-1].rank === pile[-3].rank
}

export function evaluateSlap(pile)      // → rule label | false
export function getSlapIndices(pile, label) // → [index, index] (UI highlight için)
```

**Uyarı:** `game.js::isValidSlap()` ve `firebaseSync.js::evaluateSlap()` şu an hâlâ kendi kopya implementasyonlarını içeriyor. Her iki dosya da `slapRules.js`'e geçiş bekliyor. Herhangi bir kural değişikliğinde **üç yeri de** güncelle veya geçişi tamamla.

**Tens kuralı sınırı:** Sadece sayı kartları (≤10) için geçerlidir. J/Q/K/A dahil değil. Bu oyuncuya henüz açıkça gösterilmiyor (UX borcu).

---

### 4.4 Challenge (Yüz Kartı Meydan Okuma) Sistemi

J, Q, K, A oynanında challenge başlar:

| Kart | Kalan Şans |
|------|-----------|
| J (11) | 1 |
| Q (12) | 2 |
| K (13) | 3 |
| A (14) | 4 |

**Akış:**
1. Saldırgan yüz kartı oynar → `challenge.active = true`
2. Savunmacı kalan şans kadar kart oynar:
   - Yüz kartı oynarsa → roller değişir, kalan şans yeni karta göre sıfırlanır
   - Normal kart oynarsa → `chancesLeft--`
   - Şans tükenirse → saldırgan pile'ı kazanır (`reason: 'challenge'`)
3. Challenge kazanımı **streak artırmaz veya sıfırlamaz** (sadece slap streak'i etkiler).

---

### 4.5 Multiplayer Yetki Modeli

**Altın Kural: Multiplayer'da GameState'i UI'dan asla doğrudan mutasyona uğratma. RTDB snapshot tek gerçek kaynaktır.**

Tüm yetkili durum mutasyonları `firebaseSync.js` içinde **RTDB transaction'ları** olarak çalışır:

```javascript
FirebaseSync.pushPlayCard({ playerIndex })    // Kart oynama — sunucu taraflı doğrulama
FirebaseSync.pushSlapAttempt({ playerIndex }) // Slap — sunucu taraflı doğrulama
FirebaseSync.convertToBot(playerIndex)        // Bağlantısı kesilen oyuncuyu bot ile değiştir
FirebaseSync.abandonRoom()                    // Oyuncuyu bağlantısız işaretle, gerekirse host'u devret
```

`syncToLocal(data)` her RTDB snapshot güncellemesinde çağrılır:
1. **Delta hesaplama:** `pile grew` / `pile cleared` / `burn grew` durumlarını tespit eder.
2. **Event sentezi:** `cardPlayed`, `invalidSlap`, `pileWon` eventlerini yerel UI için üretir.
3. **İndeks rotasyonu:** Lokal oyuncu her zaman görsel indeks 0'da olacak şekilde döndürür.
4. **GameState senkronizasyonu:** `GameState.*` alanlarını doğrudan günceller.
5. **Emoji ve bot değişim tespiti:** Delta karşılaştırmasıyla elde edilir.

---

### 4.6 Oyuncu İndeksleri (Multiplayer)

**DB indeksleri** (0–3): Mutlak, oda oluşturulurken atanır.  
**Görsel indeksler** (0–3): Her istemci için döndürülmüş. Lokal oyuncu her zaman 0.

```javascript
// DB → Görsel dönüşüm
visualIndex = (dbIndex - localPlayerIndex + 4) % 4

// Görsel → DB dönüşüm
dbIndex = (visualIndex + localPlayerIndex) % 4
```

**Kural:** `firebaseSync.js`'e yazarken her zaman **DB indeksleri** kullan. UI'a event emit ederken her zaman **görsel indeks** kullan.

---

## 5. Firebase Veri Şeması

### 5.1 Realtime Database — `gameRooms/{roomId}`

```json
{
  "players": [
    {
      "uid": "firebase_uid veya bot_timestamp",
      "name": "Oyuncu adı",
      "index": 0,
      "cards": [{ "rank": 14, "suit": "spades" }, ...],
      "status": "online | disconnected",
      "disconnectedAt": null,
      "streak": 0,
      "activeEmoji": { "e": "😂", "t": 1720000000000 }
    },
    ...
  ],
  "playerIds": { "firebase_uid": true, ... },
  "pile": [{ "rank": 7, "suit": "hearts" }, ...],
  "burnPile": [],
  "activePlayerId": 0,
  "challenge": {
    "active": false,
    "attackerId": null,
    "defenderId": null,
    "chancesLeft": 0
  },
  "gameStarted": true,
  "gameOver": false,
  "winnerIndex": -1,
  "winnerId": -1,
  "lastPlayTime": 1720000000000,
  "lastWinReason": "slap | challenge",
  "lastBurnReason": "invalid_slap | timeout",
  "lastShieldShatterTime": 0,
  "lastShieldShatterId": -1,
  "status": "playing | abandoned",
  "abandonedBy": -1,
  "hostId": "firebase_uid"
}
```

**Uyarılar:**
- `pile[-1]` = en son oynanan kart (en üstteki).
- `burnPile` slap kurallarına dahil **değildir** — sadece `winPile`'da kazanana verilir.
- `lastShieldShatterTime` ve `lastShieldShatterId` delta tespiti için kullanılır (timestamp karşılaştırması).
- `activeEmoji.t` = Unix ms timestamp; 5 saniyeden eski emojiler gösterilmez.

### 5.2 Realtime Database — `lobbyRooms/{tableId}`

Oda oluşturulduğunda TableManager tarafından yazılır. LobbyUI bekleme odasını buradan günceller.

### 5.3 Firestore — `users/{uid}`

```json
{
  "username": "OyuncuAdı",
  "email": "oyuncu@example.com",
  "totalScore": 42,
  "gamesPlayed": 15,
  "gamesWon": 7,
  "bestReflex": 312
}
```

**Yazma zamanlaması:**
- `totalScore` → `ScoreSystem.addPoints(1)` — oyun sonunda, kazanan için
- `gamesPlayed` / `gamesWon` → `ScoreSystem.incrementGames()` — oyun sonunda
- `bestReflex` → `ScoreSystem.saveBestReflexToFirestore()` — oturum boyunca en hızlı slap kaydedilir, oyun sonunda karşılaştırılarak yazılır

### 5.4 Firestore — `queues/{auto-id}` (Otomatik Eşleştirme)

```json
{
  "uid": "firebase_uid",
  "name": "Oyuncu adı",
  "joinedAt": serverTimestamp,
  "roomId": null
}
```

En eski 4 giriş tespit edildiğinde (`joinedAt` sıralı, limit 4), en eski giriş sahibi oda oluşturur ve tüm kayıtlara `roomId` + `playerIndex` yazar. Diğerleri snapshot ile haberdar olur.

---

## 6. Anahtar Alt Sistemler

### 6.1 Settings (`settings.js`)

`Settings.config` localStorage'dan yüklenir (`'ersSettings'`).

| Alan | Tip | Varsayılan | Açıklama |
|------|-----|-----------|----------|
| `theme` | string | `'theme-classic'` | CSS sınıfı olarak `document.body`'e eklenir |
| `difficulty` | `'easy'` \| `'medium'` \| `'hard'` | `'medium'` | Turn timeout + bot tepki süresi |
| `language` | locale key | `'en'` | `localization.js`'e iletilir |
| `playerName` | string | `''` | Lobi ve profil için görüntü adı |
| `musicEnabled` | boolean | `true` | BGM açık/kapalı |
| `sfxEnabled` | boolean | `true` | SFX açık/kapalı |
| `fastAnimations` | boolean | `false` | `winPile` geçiş gecikmesini azaltır |

**Tema arka planları:** Tema `'theme-blue'` ise `assets/blue_game.jpg` / `assets/blue_menu.jpg` CSS `var(--bg-game)` üzerinden uygulanır.

---

### 6.2 Bot AI (`ai.js`)

`AIController` tamamen EventBus odaklıdır. Sadece offline modda (`GameManager.activeMode === 'bots'`) çalışır.

**Bot konfigürasyonu (`BotConfig`):**

| Zorluk | Kart oynama gecikmesi | Slap tepki süresi | Doğruluk | Yanlış slap |
|--------|-----------------------|-------------------|----------|------------|
| `easy` | 1200–1800ms | 1300–2600ms | %40 | %7.5 |
| `medium` | 900–1300ms | 900–1600ms | %65 | %4 |
| `hard` | 700–1000ms | 700–1200ms | %82 | %1.5 |
| `challenger` | 600–850ms | 550–950ms | %88 | %1.5 |

**`challenger` seviyesi** hem en yüksek zorluk hem de multiplayer bot devralma seviyesidir (`convertToBot()` sonrası).

**Slap karar akışı:**
1. `cardPlayed` eventi tetiklenir.
2. `GameState.isValidSlap()` kontrolü yapılır.
3. Geçerliyse: `config.accuracy` olasılığıyla (`Math.random() < accuracy`) her bot için slap timeout zamanlanır.
4. Geçersizse: `config.falseSlap` olasılığıyla yanlış slap zamanlanır (ek 200ms gecikme ile).
5. Drift koruması: Timeout ateşlendiğinde > 2000ms gecikmişse (sekme askıya alma vb.) atlanır.

**Multiplayer bot devralma:** Host istemci, `multiplayerMode.js` içindeki `checkBotTurn()` / `checkBotSlaps()` üzerinden bot'lar için RTDB transaction'larını tetikler.

---

### 6.3 Kalkan (Shield) Sistemi

- **Kazanma:** 3 ardışık slap kazanımında (`streak >= 3`) kalkan aktif olur.
- **Yenileme:** Kalkan aktifken slap kazanılırsa streak 3'te kalır, 30s timer sıfırlanır.
- **Koruma:** Geçersiz slap yapıldığında kalkan absorbe eder ve parçalanır (`streak = 0`).
- **Pasif olma:** 30s sonra otomatik pasif olur (`shieldExpired`).
- **Diğerlerinin kazanımı:** Başka oyuncu pile kazandığında kalkanı olmayanların streak'i sıfırlanır; **kalkanı olanın etkilenmez**.
- **Timer yönetimi:**
  - Offline: `GameState.shieldDecayTimers[playerId]`
  - Multiplayer: `FirebaseSync.dbShieldDecayTimers[playerId]`
  - Her iki timer ayrı çalışır ve senkronizasyonları garanti değildir (COUNCIL borcu).

---

### 6.4 Turn Timer & Timeout

```javascript
GameState.getTimeoutDuration() → ms
// Multiplayer: her zaman 15000ms
// Offline easy: 20000ms | medium: 15000ms | hard: 10000ms
```

Timeout tetiklendiğinde:
1. Oyuncunun üst kartı `burnPile`'a aktarılır.
2. Streak sıfırlanır (kalkan yoksa).
3. `invalidSlap { reason: 'timeout' }` eventi emit edilir.
4. Challenge aktifse → attacker kazanır.
5. Multiplayer'da timeout sunucu taraflı yönetilir — istemci timeout'u tetiklemez.

---

### 6.5 Audio Sistemi (`audioManager.js`)

Web Audio API kullanır. Her ses için tek `Audio` elementi ön-oluşturulur (çakışma önleme).

| Ses | Tetikleyici EventBus eventi |
|-----|---------------------------|
| `card_place.mp3` | `cardPlayed` |
| `slap.mp3` | `pileWon` (reason: 'slap') |
| `invalid_slap.mp3` | `invalidSlap` |
| `win.mp3` | `gameOver` |
| `menu_music.mp3` (BGM) | `gameStateChanged → 'menu'` |
| `gameplay_music.mp3` (BGM) | `gameStarted` / `gameStateChanged → 'gameplay'` |

**BGM Autoplay:** Tarayıcı politikası nedeniyle ilk kullanıcı etkileşimine (click/touchstart) kadar ertelenir.  
**Sekme gizleme:** `visibilitychange` ile BGM duraklama/devam.  
**3D Ses (Panner):** SFX'ler oyuncu pozisyonuna göre `StereoPannerNode` veya `PannerNode` ile konumlandırılır (sol bot, üst bot, sağ bot için ayrı stereo pozisyon).

---

### 6.6 Reconnect (`reconnectManager.js`)

Sayfa yüklendiğinde:
1. `localStorage.getItem('ers_active_table')` kontrol edilir.
2. Firestore `multiplayer_tables/{tableId}` dokümanı okunur.
3. `gameState.status === 'playing'` ve oyuncu elenmemişse popup gösterilir.
4. 60 saniyelik geri sayım — süre dolarsa `localStorage` temizlenir.

**Yeniden Bağlan:** `TableManager.joinTable(tid)` → `LobbyUI.enterWaitingRoom(tid, false)`.  
**Terk Et:** `FirebaseSync.convertToBot(playerIndex)` → `TableManager.leaveTable()`.

**Temizleme:** `gameOver` tetiklendiğinde `localStorage.removeItem('ers_active_table')`.

**Bilinen sınır:** Temizleme sadece `gameOver` sonrası. Sekme kapanması / tarayıcı çökmesi durumunda `ers_active_table` silinmez (COUNCIL borcu).

---

### 6.7 Lobi ve Bekleme Odası Akışı

```
Ana Menü
└─ "Multiplayer" tıklanır
   └─ LobbyUI.openLobby()
      ├─ "Masa Oluştur" → TableManager.createTable() → 6 karakterlik tableId → WaitingRoom
      └─ "Katıl" → tableId gir → TableManager.joinTable() → WaitingRoom
         └─ WaitingRoom: Oyuncuları listeler, host "Başlat" butonunu görür
            └─ Host "Başlat" tıklar → GameManager.startMultiplayerGame()
               └─ MultiplayerMode.start(roomId, playerIndex)
                  └─ FirebaseSync.listenToRoom(roomId, playerIndex)
```

Oda ID'si kullanıcıya kopyalanabilir formda gösterilir (`btn-copy-id`). Arkadaşa manuel olarak gönderilir — davet linki otomatik yok (COUNCIL borcu).

---

### 6.8 Otomatik Eşleştirme (Matchmaking)

`Matchmaking.joinQueue()` çağrısında:
1. Firestore `queues` koleksiyonuna giriş eklenir.
2. Kuyruktaki en eski 4 giriş kontrol edilir.
3. En eski giriş sahibi oda oluşturur ve RTDB'ye yazar.
4. Tüm kuyruktaki oyunculara `roomId` + `playerIndex` atanır.
5. Her istemci Firestore snapshot'ı ile haberi alır.

---

### 6.9 Paralaks 3D Ana Menü (`parallax3d.js`)

Menü arka planında CSS 3D + JS mouse parallax efekti:

| Özellik | Değer |
|---------|-------|
| Arka plan kayma | ±15px |
| UI katmanı kayma | ±5px (ters yön) |
| Buton 3D tilt | ±8° |
| Çıkış animasyonu | 1000ms |
| Mobil | Tamamen devre dışı (`< 769px`) |

**Yaşam döngüsü:**
- `init()` → Menü yüklendiğinde
- `dispose()` → Oyuna geçildiğinde (GPU belleği serbest bırakma)
- `resume()` → Menüye dönüldüğünde (oyun sonu, quit)
- `setThemeLight(theme)` → Tema değiştiğinde ışık rengini güncelle

`gameStateChanged` eventi üzerinden otomatik yönetilir.

---

### 6.10 Emoji Tepkileri

Oyuncular oyun sırasında emoji gönderebilir. Mekanizma:
1. Oyuncu emoji seçer → `players/{dbIndex}/activeEmoji: { e: '😂', t: Date.now() }` RTDB'ye yazılır.
2. RTDB kuralları: Sadece kendi UID'sine ait slot'a yazabilir.
3. `syncToLocal()` delta tespiti: `activeEmoji.t > lastEmojiT[i]` → `showEmoji` emit edilir.
4. 5 saniyeden eski emojiler gösterilmez (staleness koruması).

---

### 6.11 Spectator Modu (Kısmi)

İnsan oyuncu elendikten sonra (`humanEliminated = true`) offline modda:
- Oyun botlar arasında devam eder.
- "Observe" butonu ile geri oyun ekranına dönülebilir.
- İnsan destesi kilitlenir (`pointerEvents: none`), pile kilitlenir.
- Bu bir tam özellik değil — VictoryScreen'de `winnerId === 99` koşulu ile yönetilir.

---

### 6.12 Oyun Sonu ve İstatistik Paneli (`victoryScreen.js`)

`gameOver` eventi tetiklendikten 1500ms sonra:
1. Konfeti animasyonu (`stopParticles()`)
2. İstatistik paneli gösterilir:
   - En hızlı slap (ms)
   - Kazanılan kart sayısı
   - Yakılan kart sayısı
   - Yeniden doğma sayısı
3. Kazanan için `ScoreSystem.addPoints(1)` + `incrementGames(true)`.
4. Kaybeden için `incrementGames(false)`.
5. Oturum `bestReflex` Firestore'a yazılır (yalnızca geliştirme).

**Yeniden Oyna:**
- Bot modunda: `GameManager.startBotGame()` (yeni oyun, aynı mod)
- Multiplayer modunda: `returnToWaitingRoom()` (aynı odada bekleme odasına döner)

---

### 6.13 Skor Tablosu (`leaderboard.js`)

Firestore `users` koleksiyonunu `totalScore desc, limit 10` ile sorgular. Sonuçlar sayfa yüklendiğinde değil, kullanıcı paneli açtığında çekilir (on-demand).

---

## 6.14–6.19 — v2.9.0 Eklentileri

Bu 6 alt bölüm 2026-07'de eklendi: 5 yeni özellik + rules panel'in uzun süredir tutmadığı bir vaadin (Perfect Slap) gerçek implementasyonu. Hepsi bilinçli olarak **düşük riskli** tasarlandı: hiçbiri `slapRules.js`/`game.js`'in çekirdek slap mantığını, `firebaseSync.js`/`multiplayerMode.js`'in yetkili-sunucu yüzeyini veya `database.rules.json`'ı değiştirmiyor. Aşağıdaki her bölüm "neden bu şekilde" kısmını da içeriyor — devralan mühendis neyin bilinçli bir sınır olduğunu, neyin sonradan genişletilebileceğini görsün.

### 6.14 Pratik / Öğretici Modu (`tutorialMode.js`)

**Amaç:** COUNCIL.md'nin Ürün bölümü uzun zamandır "yeni oyuncu challenge mekanizmasını anlayamadan eleniyor" riskini işaretliyordu ama somut bir çözüm önerilmemişti. Bu, o boşluğu dolduruyor.

**Kritik mimari karar:** Gerçek `GameState` singleton'ı KULLANILMIYOR. Sebep: `GameState` üzerinden `slap()`/`playCard()` çağırmak `pileWon`/`cardPlayed`/`gameOver` event'lerini tetikler — bunları `ScoreSystem`, `StreakTracker`, `VictoryScreen` ve `AIController` da dinliyor. Senaryolu bir öğretici elin sahte bir refleks süresini veya sahte bir galibiyeti bu sistemlere sızdırması gerçek bir risk (örn. `ScoreSystem.sessionBestReflex` kirlenmesi → bir sonraki gerçek oyunun Firestore'a yanlış "en iyi refleks" yazması).

Bunun yerine `tutorialMode.js` tamamen izole bir mini-simülasyon:
- Kendi yerel `this.pile` dizisini tutar, hiçbir paylaşılan event emit ETMEZ.
- `game.js`'ten SADECE saf yardımcı fonksiyonları import eder (`getRankName`, `getSuitSymbol`) — `GameState`'in kendisini değil.
- `slapRules.js`'ten gerçek `evaluateSlap()`'i import eder — yani öğretilen kurallar %100 gerçek kural motoruyla doğrulanmış (bkz. bu implementasyonun test scripti: 4 senaryo da PASS, kısmi pile'larda yanlış-pozitif YOK).
- Kart görselleri `ui.js::createCardElement()` ile AYNI DOM yapısını/CSS class'larını kullanır (`.card`, `.red`/`.black`, `.card-top/-center/-bottom`) — görsel tutarlılık için, ama kendi `#tutorial-pile` container'ına render eder.

**Akış:** 4 sabit desen (doubles: 5♠5♥, tens: 4♣6♦, marriage: K♠Q♥, sandwich: 9♣3♥9♦) tek tek kart-kart açılır → desen tamamlanınca coach-mark metni gösterilir ve dokunma dinleyicisi açılır → doğru dokunuş bir sonraki adıma geçer. Ardından J♠→Q♦ ile bir challenge senaryosu gösterilir (otomatik, dokunuş gerektirmez). Bitince tamamlama ekranı.

Ekranlar: `index.html`'de yeni `#tutorial-screen` (`.screen` konvansiyonu). Ana menüde `#btn-practice` (`.secondary-actions` içinde ilk sırada).

**Genişletme fikri (yapılmadı):** İleride gerçek `GameState`'e geçmek istenirse, önce `ScoreSystem`/`StreakTracker`'a `GameManager.activeMode !== 'tutorial'` koruması eklenmeli.

---

### 6.15 Bot Kişilikleri (`ai.js` → `BotPersonalities`)

**Amaç:** Offline botlar öncesinde sadece "Bot 1/2/3" idi, tek fark zorluk seviyesiydi. Artık her koltuğun sabit bir karakteri var: **Blitz** (koltuk 1, agresif/blöfçü), **Chaos** (koltuk 2, tutarsız/yüksek varyans), **Viper**/**Kobra** (koltuk 3, sabırlı/hassas).

**Nasıl çalışır:** `getPersonalityConfig(botId, baseConfig)` seçili zorluk seviyesinin (`easy`/`medium`/`hard`/`challenger`) reaksiyon aralığının ORTA NOKTASINI kaydırır ve YARIÇAPINI genişletir/daraltır — mutlak sayılar yerine çarpanlarla çalışır. Bu sayede bir kişilik zorluk seviyesini gizlice kolaylaştırmıyor/zorlaştırmıyor, sadece "hissi" değiştiriyor. Tüm 4 zorluk × 3 kişilik kombinasyonu simüle edildi, dejenere değer yok (bkz. bu oturumun test çıktısı).

**Neden multiplayer'ı etkilemiyor:** `multiplayerMode.js::checkBotTurn()`/`checkBotSlaps()` `BotConfig.challenger`'ı DOĞRUDAN okuyor, `AIController`'a hiç dokunmuyor. `AIController`'ın kendi event handler'ları zaten `GameManager.activeMode !== 'bots'` koşuluyla no-op oluyor. Yani `BotPersonalities` sadece offline Bot Mode'da aktif — bilinçli bir kapsam sınırı, multiplayer'ın yetkili-olmayan client kodu genişletilmiş olmasın diye.

**Not:** `multiplayerMode.js::getVisualNames()` fallback yolu `Localization.get('bot1'/'bot2'/'bot3')` kullanıyor — yani yeni isimler (Blitz/Chaos/Viper) senkron tamamlanmadan önceki kısa an için multiplayer'da da görünebilir (kozmetik, zararsız; gerçek isim Firebase'den senkronlanınca üzerine yazılıyor).

---

### 6.16 Oturum Galibiyet Serisi (`streakTracker.js`)

Sadece `gameOver` event'ini dinler (yerel `winnerId === 0` ise seri++, değilse sıfırla). Firestore'a hiçbir şey YAZMAZ — tamamen istemci-yerel, sayfa yenilenince sıfırlanır (bilinçli: "bu oturumdaki sıcak seri", kalıcı bir istatistik değil).

**Bilinçli olarak tek-yönlü:** Kayıp serisi ASLA gösterilmez/duyurulmaz, sessizce sıfırlanır. Sadece galibiyet serisi kutlanır. `VictoryScreen.renderStreakBanner()` içinde çağrılır.

---

### 6.17 Paylaşılabilir Maç Sonu Kartı (`resultCard.js`)

`victoryScreen.js`'e eklenen "Share Result" butonu 1080×1080 bir canvas render eder (galibiyet/kayıp, kazanan adı, en iyi refleks, kazanılan kart, varsa galibiyet serisi) ve `navigator.share()` ile paylaşım sayfasını açar; desteklenmiyorsa doğrudan PNG indirmeye düşer. Yeni asset/ağ isteği YOK — tamamen canvas çizimi (`audioManager.js`'in SFX'leri sentezlemesiyle aynı felsefe).

**Dikkat:** Canvas metin etiketleri (`shareCardWin`/`shareCardReflex` vb.) BİLEREK ayrı, kısa tutulan localization anahtarları — mevcut daha uzun UI metinlerini (örn. `statReaction`) yeniden kullanmak, Almanca/Rusça gibi dillerde 1080px canvas'ta taşmaya yol açabilirdi. Bu kartı büyütürseniz/yeni bir dil eklerseniz bu anahtarları KISA tutmaya devam edin.

---

### 6.18 Konfor ve Erişilebilirlik Ayarları (`settings.js`)

3 yeni `Settings.config` alanı: `reducedMotion`, `highLegibility`, `largerText`.

- **`reducedMotion`:** `body.reduced-motion` class'ı → tüm animasyon/transition süreleri `0.001s`'e düşürülüyor (tamamen `none` DEĞİL — element son görsel durumuna hâlâ ulaşsın diye). Ayrıca `parallax3d.js::init()`/`resume()` bu bayrağı okuyup mouse-parallax'ı hiç başlatmıyor. İlk ziyarette (henüz kayıtlı ayar yokken) OS'in `prefers-reduced-motion` sinyali varsayılan olarak alınır; kullanıcı sonradan elle değiştirirse o zaman onun tercihi her zaman kazanır.
- **`highLegibility`:** Sistem sans-serif font + geniş satır/harf aralığı + text-shadow kaldırma. Yeni font dosyası YOK (CSP'ye dokunmadan).
- **`largerText`:** ⚠️ `document.documentElement.style.fontSize` (html kök elemanı) üzerinden ayarlanıyor, `body` class'ı ÜZERİNDEN DEĞİL — çünkü `rem` birimleri her zaman `<html>`'e görecelidir, `<body>`'e değil. İlk versiyonda bu hata yapıldı ve düzeltildi; ileride benzer bir "ölçekleme" özelliği eklenirse aynı tuzağa dikkat edin.

---

### 6.19 Perfect Slap Hassasiyet Bonusu (`ui.js` + `audioManager.js`)

**Bulunan hata:** Kurallar paneli (`rPerfectTitle`/`rPerfectDesc`, 4 dilde) uzun zamandır oyunculara pile merkezine 15px mesafede yapılan slap'in özel bir bonus tetiklediğini söylüyordu — ama kodda bu mekanik hiç yoktu (`grep` ile doğrulandı: `perfect`/precision/click-position ile ilgili sıfır sonuç). Bu, panelin verdiği bir sözün gerçek implementasyonu.

**Nasıl çalışır:** `ui.js`'te `#center-pile`'ın `pointerdown` dinleyicisi artık `e.clientX/clientY`'yi `#pile-cards`'ın merkezine göre kaydediyor (`this._lastSlapAttempt = { dist, t }`). `pileWon` handler'ında, kazanan slap `winnerId === 0` ve `reason === 'slap'` ise ve son kayıtlı dokunuş 300ms içinde + ≤15px mesafedeyse → `triggerPerfectSlap()`: neon yıldız patlaması (CSS) + 3 notalı yükselen chime (`audioManager.js::playPerfectSlap()`, C6→E6→G6 sine dalgaları — mevcut `playGodlikeSlap()`'ten farklı, ayrı bir sonik imza).

---

### 6.20 v2.9.0 Cila Geçişi (Aynı Oturum, İkinci Tur)

İlk v2.9.0 teslimatından hemen sonra, aynı oturumda küçük ama gerçek bir cila turu yapıldı. Liste halinde:

- **`.secondary-actions` artık `flex-wrap: wrap`** — 4. buton (Practice Mode) eklenince dar ekranlarda taşma riski vardı, düzeltildi.
- **Klavye focus paritesi** — `.tutorial-exit-btn` ve `.share-result-btn` `.btn` class'ını kullanmadığı için paylaşılan `:focus` stilini miras almıyordu; ikisine de `:focus-visible` eklendi.
- **Pratik Modu artık sessiz değil** — kart dağıtımında `cardPlace`, doğru dokunuşta `slap`, yanlışta `invalidSlap`, tamamlanınca `win` SFX'i çalıyor (hepsi `AudioManager.playSFX()` üzerinden, yeni ses dosyası yok).
- **Pratik Modu ilerleme noktaları** (`#tutorial-progress`, 5 nokta: 4 desen + 1 challenge). Dikkat: "tamamlandı" durumu, ekran `tutorial-done`'a geçmeden HEMEN ÖNCE gösteriliyor (challenge'ın Queen'i düşünce, `finish()` çağrılmadan ~1.5sn önce) — yoksa kullanıcı hiç görmeden ekran değişirdi. İlk yazımda bu hata yapılmıştı, düzeltildi.
- **Bot kişilik ikonları masada** — `ui.js::getVisualNameHTML()` artık `_personalityIcon(visualId)` ile ⚡(Blitz)/🌀(Chaos)/🐍(Viper) ikonlarını isim yanına ekliyor, SADECE `GameManager.activeMode === 'bots'` iken (multiplayer'a hiç dokunmuyor).
- **Konfor ayarları alt-metinleri** — Reduced Motion / High Legibility / Larger Text VE mevcut Fast Animations toggle'ının artık her birinin altında kısa bir açıklama var (`reducedMotionDesc` vb., 4 dilde). Salt checkbox yerine ne işe yaradığını söyleyen bir panel.
- **Galibiyet serisi kilometre taşları** — `streakTracker.js::getBannerInfo()` artık `isMilestone` (`currentStreak % 5 === 0`) döndürüyor; 5/10/15... serilerde normal "yeni rekor" altın rozeti yerine daha büyük, nabız gibi atan kırmızı `.streak-banner-milestone` gösteriliyor. Öncelik sırası: milestone > yeni rekor > normal.

**Localization anahtar sayısı bu turdan sonra: 258 (4 dilde tam parite, script ile doğrulandı).**

---

## 6.21–6.25 — v2.9.0 Üçüncü Tur: 5 Yeni Özellik

Bu 5 alt bölüm, §6.14–6.19'daki ilk 5 fikirden VE iki analiz dokümanından (sunucu-doğrulama/büyüme fikirleri, "10 AAA fikri") bağımsız, yeni bir "5 benzersiz özellik" turu. Hepsi aynı disiplinle: `slapRules.js`/`game.js`'in çekirdek mantığına veya multiplayer yetkili-sunucu yüzeyine dokunmadan, mümkün olduğunca mevcut event/altyapıyı yeniden kullanarak.

**Bu turda gerçek bir hata yapıldı ve düzeltildi — devralan mühendis için not:** Başlangıçta 5. fikir olarak "Live Action Log" (oyun olaylarının metin günlüğü) inşa edildi — ta ki `ui.js`'te ZATEN `addLog()` adında olgun, aktif olarak kullanılan, neredeyse AYNI İŞİ yapan bir sistem olduğu fark edilinceye kadar (bkz. §6.21'in hemen altındaki not değil, bu paragraf). Yeni dosya (`actionLog.js`) ve ilgili localization anahtarları tamamen silindi, parite yeniden doğrulandı, ve yerine gerçekten farklı bir 5. fikir (§6.25, Bot Table Talk) kondu. Bunu buraya yazmamın sebebi: **yeni bir özellik önerirken önce ui.js/game.js'te ZATEN olup olmadığını `grep` ile kontrol et** — bu oturumda bu adımı ikinci kez atladığımda (ilk kez COUNCIL.md/CLAUDE.md'nin kendi güncel olmayan açıklamalarına güvenip) gerçek bir tekrar riski oluştu.

### 6.21 Danger Zone Tension System (`ui.js` + `audioManager.js`)

Slap hızına dayalı mevcut "Slap Juice" (shake/particle) ve streak'e dayalı mevcut kalkan parıltısından TAMAMEN farklı, üçüncü bir görsel eksen: **kart sayısına** dayalı gerilim.

- **Görsel:** `ui.js::updateCounts()` içine eklendi (mevcut kalkan/streak mantığının hemen yanına, aynı desenle). 2 kartta amber `outline` pulse (`.danger-warning`), 1 kartta kırmızı `outline` pulse + "LAST CARD!" rozeti (`.danger-critical` + `.deck-lastcard`). **Bilinçli olarak `box-shadow`/`border` değil `outline` kullanıldı** — `.combustion-glow` bu iki property'yi `!important` ile zaten kullanıyor; aynı property'lere yazılsaydı, bir oyuncu HEM kalkanlı HEM son-kartında olduğunda biri diğerini ezerdi. `outline` tamamen ayrı bir kutu modeli property'si, çakışma yok.
- **Yan bulgu/düzeltme:** `.deck`'te `position: relative` YOKTU — yani mevcut kalkan ikonu muhtemelen yanlış bir ata elemente göre konumlanıyordu. Eklendi (küçük, güvenli, ek bonus düzeltme).
- **Ses:** `audioManager.js`'e `setTensionLevel(level)` / `stopTensionCompletely()` — tek, kalıcı, düşük frekanslı bir drone (55Hz sine), gain ile yumuşak geçiş yapıyor. Bu dosyadaki DİĞER her ses tek-seferlik (play-and-forget); bu tek İSTİSNA, bu yüzden kendi yaşam döngüsü var (`gameOver`/`gameStarted`'da temizleniyor).
- **Multiplayer uyumluluğu:** Tamamen `GameState.players[i].length`'i OKUYARAK çalışıyor (zaten senkronize) — `game.js`/`firebaseSync.js`'e SIFIR değişiklik, bu yüzden offline VE multiplayer'da aynı şekilde ve güvenle çalışıyor (BotPersonalities'in aksine, offline'a özel DEĞİL).

### 6.22 Bot Nemesis Tracker (`botNemesis.js`)

`localStorage` tabanlı (profileUI.js'in `ers_match_history` deseniyle birebir aynı), kalıcı, "hangi bot kişiliği seni en çok yendi" kaydı. Sadece offline Bot Modu'nda (`GameState.isMultiplayer` kontrolü) — multiplayer'da bot koltuklarının kişiliği yok zaten (§6.15).

`gameOver` event'ini dinler, `winnerId` 1-3 ise o botun sayacını `ers_bot_nemesis` anahtarında artırır. Profil panelinde (`#bot-nemesis-container`, match history'nin hemen altında) her botun kazanma sayısını ve en çok kazanan "nemesis"i gösterir. `StreakTracker`'dan farkı: bu KALICI (oturumlar arası hayatta kalır), StreakTracker oturum-içi. Elo/skor tablosundan farkı: küresel değil, tamamen kişisel ve 3 spesifik bot kişiliğine özel.

### 6.23 MVP Moment (`victoryScreen.js`)

Oyun sonu ekranına, mevcut `GameState.stats`'tan (bestReflex, cardsWon, burns, resurrections) hesaplanan TEK SATIRLIK bir anlatı vurgusu — YENİ hiçbir takip eklenmedi. `computeMvpMoment(stats, won)` öncelik sırasıyla kontrol eder: comeback (resurrections≥2) > lightning reflex (≤250ms) > flawless (0 yakma + 15+ kart) > survivor (resurrections=1) > solid win (genel galibiyet) > (kayıpta hiçbir şey — bkz. aşağıdaki not).

**Bilinçli tasarım kararı:** Kayıpta hiçbir "MVP Moment" göstermez eğer yukarıdaki koşullardan hiçbiri tutmuyorsa — StreakTracker'ın "sadece galibiyet serisini kutla, kayıp serisini hiç gösterme" ilkesiyle aynı: uydurma bir "iyi kaybettin" mesajı yerine, sessizce hiçbir şey göstermemek daha dürüst ve daha az riskli.

Öncelik sıralaması Node ile test edildi (7/7 geçti) — özellikle "hem lightning hem survivor koşulu tutuyorsa lightning kazanır" edge case'i.

### 6.24 Quick Match Timer / Blitz Mode (`game.js`, `matchTimer.js`, `settings.js`)

Offline-only, sınırlı süreli maç seçeneği: `Settings.config.matchLength` = `'full'` (varsayılan) veya `'blitz'` (5 dakika). Süre dolunca en çok kartı olan oyuncu kazanır.

- `game.js::forceTimeUp()` — TAMAMEN YENİ, ek bir metod. Mevcut `checkGameOver()`'ın kazanma-koşulu mantığına HİÇ dokunmuyor; sadece maksimum kart sayısını bulup aynı `EventBus.emit('gameOver', winnerId)`'i tetikliyor — yani VictoryScreen/ScoreSystem/StreakTracker/BotNemesis/MVP Moment'ın HİÇBİRİ değişiklik gerektirmedi, hepsi zaten bu event'i dinliyor.
- `matchTimer.js` — geri sayım UI'ı + `forceTimeUp()` çağrısı. `gameOver` event'ini AYRICA dinleyip kendini hemen durduruyor (normal bir eleme ile biten oyunlarda 250ms'lik poll gecikmesi yerine anında temizlik).
- **Neden multiplayer'da yok:** Birden fazla gerçek oyuncunun cihazında senkronize bir geri sayım — kimin saati yetkili? — gerçekten daha zor bir problem ve bu oturumun kapsamı dışında bırakıldı (BotPersonalities/BotNemesis'teki "offline-only" mantığıyla aynı).

### 6.25 Bot Table Talk (`ai.js`)

BotPersonalities'e (§6.15) yeni bir OTONOM SOSYAL boyut ekliyor: botlar kendi galibiyetlerinde kişiliğe göre emoji ile tepki veriyor — MEVCUT emoji sistemini (`showEmoji` event'i, `ui.js::showFloatingEmoji()`) aynen kullanıyor, YENİ UI/event YOK, sadece yeni bir tetikleyici (`AIController.init()` içine eklenen bir `pileWon` dinleyicisi).

- Blitz sık tepki verir (`%35` şans), kendinden emin/yoğun emoji havuzu (🔥😎🤯).
- Viper nadiren tepki verir (`%10`), sakin/bilge emoji havuzu (😎🤔).
- Chaos tahmin edilemez (`%25`, ama havuzu daha kaotik: 🤯😱😂).

`grep` ile doğrulandı: `showEmoji` event'i şu ana kadar SADECE `playerId: 0` (insan) ile tetikleniyordu — botların otonom tepki vermesi gerçekten yeni. Tepki, pile-win shockwave/particle patlamasıyla görsel çakışmayı önlemek için 550ms gecikmeyle tetikleniyor. Sadece `GameManager.activeMode === 'bots'` iken (BotPersonalities ile aynı kapsam sınırı).

**Localization anahtar sayısı bu turdan sonra: 271 (4 dilde tam parite — bu sayı, silinen 10 `actionLog` anahtarının çıkarılmasından SONRAki gerçek son durum).**

---

## 6.26–6.28 — v2.9.0 Dördüncü Tur: UI Cilası + Kozmetik Sistemi

Kullanıcı isteği üzerine: 2 küçük görsel düzeltme + 3 yeni özellik (mağaza sistemi, önizlemeli kart skinleri, altın motifli örnek skin).

### 6.26 UI Cilası: Pratik Modu Çıkış Butonu + Hesap Paneli

- **`tutorial-exit-btn`:** Rengi jenerik griden, tutorial ekranının zaten kullandığı mor aksana taşındı (`rgba(167,139,250,...)` — progress dots ve coach panel ile aynı aile). Metin `✕` ikonu aldı (4 dilde). Pill şekli + hover'da hafif yükselme/glow eklendi.
- **Hesap paneli (`#account-panel`):** Girdi alanları artık `.auth-card` adlı görsel bir kart içinde (gradient arka plan, kenarlık, gölge) — önceden çıplak, kart-siz bir görünümdü. Her girdiye ikon eklendi (👤📧🔒), metin ortalanmış yerine sola hizalandı. **Önemli:** `.ui-input.crisp-dark` class'ının KENDİSİ değiştirilmedi — bu class 2 BAŞKA yerde de kullanılıyor (oyuncu adı girişi, masa kodu girişi) ve onların ortalanmış stilini korumaları gerekiyordu. Bunun yerine yeni bir `.auth-input` class'ı EKLENDİ (`class="ui-input crisp-dark auth-input"`), sadece hesap panelindeki 3 girdiye uygulandı. `account` başlığı anahtarına 🔐 ikonu eklendi (4 dilde). Hiçbir JS ID'si değişmedi (`profileUI.js`'in mevcut `getElementById` çağrıları dokunulmadan çalışıyor).

### 6.27 Kart Skinleri + Coin (`cardSkins.js`, `ui.js`, `settings.js`)

Tamamen kozmetik, istemci-yerel bir ilerleme sistemi: çevrimdışı maç oynayarak Coin kazan, skin kilidini aç, birini kuşan.

**Bilinçli mimari karar — neden sunucu doğrulaması YOK:** §7.4'teki gerçek oyun mantığının aksine (orada bir client'ın hile yapması BAŞKA oyuncuları etkiler — sahte kazanma, sahte kart), burada bir kullanıcının kendi `localStorage`'ını düzenleyip Coin/skin sahipliğini "hacklemesi" KİMSEYİ etkilemez — hiçbir eşleştirmeyi, skoru, adaleti bozmaz, sadece kendi ekranındaki kartların rengini değiştirir. Bu yüzden `BotNemesis`/`StreakTracker` ile aynı düşük-riskli `localStorage` deseni kullanıldı, Firestore/Cloud Function YOK. (Eğer ileride gerçek parayla satın alma eklenirse, o zaman §7.4'ün ele aldığı türden bir sunucu-yetkili doğrulama gerekir — ama ücretsiz, çevrimdışı, salt-kozmetik bir sistem için bu gerekli değil.)

- `CARD_SKINS`: 4 skin — `classic` (varsayılan, ücretsiz), `golden` (150 Coin), `neon` (150 Coin), `royal` (250 Coin).
- Coin kazanma: `gameOver`'ı dinler, SADECE offline Bot Modu'nda (BotNemesis/StreakTracker ile aynı kapsam), galibiyette 25, değilse 10 Coin.
- `ui.js::renderPileCard(card, playerId)` artık `playerId` alıyor (önceden almıyordu) — sadece `playerId === 0` (yerel insan) ise `Settings.config.equippedCardSkin`'in CSS class'ını karta ekliyor.
- **Kapsam sınırı, açıkça belirtildi:** Skin SADECE SENİN gördüğün karta uygulanıyor — multiplayer'da DİĞER oyuncular senin skinini GÖRMEZ (bu, RTDB şemasına yeni bir senkronize alan — örn. `players[i].cardSkin` — eklemeyi gerektirirdi, bu turda BİLİNÇLİ OLARAK yapılmadı, salt-kozmetik bir özellik için multiplayer şemasına dokunmamak adına). Doğal bir sonraki adım ama şu an değil.
- Skin CSS'leri (`.card-skin-golden/-neon/-royal`) SADECE `background`/`border`/`box-shadow`'u değiştiriyor — `.card.red`/`.card.black`'in `color` kuralına HİÇ dokunmuyor, yani suit renk okunabilirliği hangi skin seçili olursa olsun korunuyor.

### 6.28 Shop UI (`shopUI.js`)

Yeni `#shop-panel` ekranı (ana menüde `🛍️ Shop` butonu, `.secondary-actions` satırında — bu artık 5. buton, satır zaten `flex-wrap` yapıyordu). Her skin için: örnek bir Maça Ası kartı GERÇEK `.card` DOM yapısıyla render edilmiş önizleme (gerçek oyunda göreceğinle birebir aynı), isim, ve duruma göre "Kilidi Aç — 🪙 N" / "Kuşan" / "Kuşanıldı ✓" butonu. Basit ekran geçişleri (`rules`/`leaderboard`/`settings` panelleriyle aynı desen) — Spline3D parallax'ı durdurmaya gerek yok, çünkü bu panel türü zaten onu duraklatmıyor (main.js'teki mevcut basit alt-panel deseniyle doğrulandı).

**Localization anahtar sayısı bu turdan sonra: 280 (4 dilde tam parite).**

---

## 6.29 Dış İnceleme Turu: Bulunan ve Düzeltilen Sorunlar

Kullanıcı projeyi ("bu hali nasıl oldu, hataları raporla") bağımsız bir incelemeye soktu. İnceleme sırasında ortaya çıkan İLK ve en önemli gözlem: proje, bu dokümanın önceki bölümlerinin anlattığından DAHA FAZLASINI içeriyordu — kart skinleri 4'ten 12'ye çıkmış, rarity sistemi (`common`/`epic`/`rare`/`legendary`) ve parçacık/parıltı efektleri eklenmişti, bunların hiçbiri önceki bölümlerde belgelenmemişti. **Bu döngüyü devralan mühendis için ders:** `CLAUDE.md` gerçek kod durumunun HER ZAMAN gerisinde kalabilir — bu doküman bu yüzden defalarca "önce `grep` ile doğrula" diyor (bkz. §6.21 girişi, BUG-03). Bulunanlar ve düzeltilenler:

- **🔴 Kritik: Canlı "Tester" hile butonu.** Mağaza panelinde TÜM kullanıcıların gördüğü "+1000 🪙 (Tester)" butonu + `window.addCoins()`/`window.buyAllSkins()`/`window.CardSkins` global debug hook'ları vardı. Coin sistemi rekabetsel olduğu için güvenlik riski değildi ama unutulmuş test kodu, üstelik `data-i18n` yok (4 dil desteğini bozuyordu). **Tamamen kaldırıldı** (`index.html`, `shopUI.js::init()`).
- **🟡 Üç dosyada tekrarlanan skin verisi.** `cardSkins.js::CARD_SKINS`, `ui.js`'in kendi `FX_MAP`'i, `shopUI.js`'in kendi `SKIN_FX`'i — üçü de aynı renk/rarity/parçacık-sayısı verisini bağımsız tanımlıyordu (şu ana kadar sürüklenme yoktu, ama `slapRules.js`'in yaşadığı TAM olarak aynı risk deseni). **`cardSkins.js::getSkinFX(skinId)` eklendi**, `ui.js` ve `shopUI.js` artık kendi kopyalarını tutmuyor, oradan okuyor. Node ile doğrulandı: her 11 skin'in FX değeri, konsolidasyondan önceki/sonraki haliyle birebir aynı (key-order-bağımsız deep-equal kontrolü).
- **🟡 Mağazada hiç ses yoktu.** `audioManager.js::playSkinUnlock(rarity)` (legendary'de 4 nota, diğerlerinde 3 nota yükselen arpej) ve `playSkinEquip()` (kısa onay sesi) eklendi. Satın alma sonrası otomatik kuşanma SESSİZ tutuldu (`equip(skinId, silent=true)`) — unlock sesi zaten o anı kutluyor, üst üste binmesin diye.
- **🟡 Mağaza grid'i mobilde responsive değildi.** 12 skin'e çıkarken 2 sütundan 3 sütuna geçilmiş ama dar ekran için `@media` düzeltmesi eklenmemişti. `@media (max-width: 480px)` ile 2 sütuna dönüş eklendi.
- **🟡 ~30 kullanılmayan localization anahtarı.** Eski kurallar paneli metinleri (`slapDoublesDesc` vb. — artık `rSlapTitle`/`rSlapDesc` tarzı `r`-önekli anahtarlar kullanılıyor) ve eski auth placeholder'ları (`usernamePlaceholder` vb. — artık `phUsername` vb. kullanılıyor) hiçbir yerde referans edilmiyordu. Bu, BENİM çalışmamdan ÖNCEye ait bir birikimdi. 32 anahtar × 4 dil = 128 satır kaldırıldı; script ile doğrulandı (kaldırmadan önce VE sonra: hiçbir kod yolu bu anahtarları çağırmıyor). **Anahtar sayısı: 288 → 256.**
- **Not (küçük, düzeltilmedi):** `ShopUI.equip(skinId)` sahiplik kontrolü yapmıyor — normal UI akışında sorun değil (buton zaten sadece sahip olunan skin'lerde "Kuşan" gösteriyor) ama savunmacı kod açısından eksik. Coin sisteminin düşük-riskli doğası (bkz. §6.27) nedeniyle öncelikli değil.

Bu turdan sonra tüm doğrulamalar tekrar çalıştırıldı: 33 client dosyası + 3 Cloud Function dosyası syntax-temiz, 53/53 mantık testi geçiyor, CSS/HTML dengeli, 256 anahtar × 4 dilde tam parite.

---

## 6.30 Kullanıcı İsteği: Yetersiz Bakiye Uyarısı + Multiplayer Coin

- **Yetersiz bakiye uyarısı:** `CardSkins.purchase()` artık başarısızlık NEDENİNİ döndürüyor (`reason: 'insufficient_funds' | 'already_owned' | ...` + `needed: <eksik miktar>`). Mağazanın kendi bildirim elementi eklendi (`#shop-notification`) — **`#notifications`'ı YENİDEN KULLANMADIK**, çünkü o `#game-container` içinde yaşıyor ve mağaza panelinde (ayrı bir `.screen`) görünmez olurdu. Ayrıca `AudioManager.playSFX('invalidSlap')` tepki sesi olarak yeniden kullanıldı (yeni ses eklemek yerine).
- **Coin artık multiplayer'da da kazanılıyor**, sadece bot modunda değil — `GameManager.activeMode` kontrolü `'bots' || 'multiplayer'` oldu. Ödül 20 (katılım) / 40 (galibiyet) olarak yeniden kalibre edildi: en kötü senaryoda (hiç kazanmadan) 8 oyun = 160 coin, en ucuz skin'in (150) üzerinde — Node ile Monte Carlo simülasyonuyla doğrulandı.
- **Yeni bir korunma eklendi:** `scoreSystem.js`'nin zaten kullandığı `gameProcessed` bayrağı `CardSkins`'e de eklendi — `gameOver` bazı edge case'lerde birden fazla ateşleyebiliyor (bu, scoreSystem.js'in KENDİ yorumundan biliniyordu), bu bayrak olmadan multiplayer'a genişletme çifte-coin riski taşırdı.

---

## 7. Güvenlik

### 7.1 Firebase Hosting Başlıkları (`firebase.json`)

| Başlık | Değer |
|--------|-------|
| `Cache-Control` | `no-cache, no-store, must-revalidate` — index.html, *.js, *.css |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `script-src 'self' gstatic.com apis.google.com` |

**CSP Uyarısı:** Yeni harici script kaynağı ekliyorsan `firebase.json`'daki CSP başlığını güncellemeyi unutma.

### 7.2 RTDB Güvenlik Kuralları (`database.rules.json`)

| Kural | Açıklama |
|-------|----------|
| `lobbyRooms` | Auth zorunlu. Yazma: host veya mevcut oyuncu. |
| `gameRooms` | Okuma/Yazma: `playerIds` içinde UID olan kullanıcıya özel. |
| `gameRooms.players.*.activeEmoji` | Sadece kendi UID'li slot'a yazabilir. |
| `presence` | `$uid === auth.uid` — sadece kendi presence'ını yaz. |

**⚠️ Önemli netleştirme (v2.9.0):** Yukarıdaki `gameRooms` kuralı SADECE "bu odaya kim dokunabilir" sorusunu cevaplıyor (sahiplik/üyelik kontrolü) — "yazılan İÇERİK geçerli mi" sorusunu HİÇ cevaplamıyor. Odadaki 4 oyuncudan biri, DevTools konsolundan `pile`/`players/*/cards`/`activePlayerId`/`winnerId` gibi alanlara istediği HERHANGİ bir değeri yazabilir; bu kural bunu engellemez. Bu, önceki bir CLAUDE.md sürümünde "yetkili" diye tanımlanmıştı ki bu yanıltıcıydı — sahiplik ≠ içerik doğrulama. Bkz. §7.4.

### 7.3 Auth Sistemi (`auth.js`)

- E-posta + şifre kaydı ve girişi
- `updateProfile(displayName)` ile kullanıcı adı Firebase Auth profile'a yazılır
- Firestore `users/{uid}` dokümanı kayıt anında seed edilir (race condition koruması: merge: true)
- Dostu hata mesajları: `getFriendlyErrorMessage(code)` ile koddan okunabilir metne

### 7.4 Sunucu Tarafı Doğrulama — `functions/` (v2.9.0, aşamalı devrede)

**Sorunun tam kapsamı (§7.2'den daha geniş):** `firebaseSync.js::pushSlapAttempt`/`pushPlayCard` şu ana kadar sadece "geçerli bir şaplak mı" sorusunu client-side kontrol ediyordu (doc1'in odaklandığı risk). Ama bu oturumda `multiplayerMode.js`'i incelerken DAHA CİDDİ bir şey ortaya çıktı: bu iki fonksiyon `playerIndex` parametresini HİÇBİR KİMLİK DOĞRULAMASI yapmadan doğrudan kabul ediyor. Yani bir oyuncu, DevTools'tan `FirebaseSync.pushSlapAttempt({playerIndex: 2})` çağırarak — kendi koltuğu olmasa bile — BAŞKA BİR GERÇEK OYUNCUNUN koltuğu adına hamle yapabilirdi. `multiplayerMode.js::slap()` içindeki `// Push a slap event via RTDB Transaction (Secure and Free)` yorumu bu konudaki asıl yanılgıyı da gösteriyor: RTDB transaction'ları ATOMİKLİK sağlar (çakışan yazmalarda veri kaybını önler), YETKİLENDİRME sağlamaz — bunlar farklı şeyler, ve orijinal kod bunu karıştırmış.

**Ne yapıldı:**
1. `functions/gameLogic.js` — `pushSlapAttempt`/`pushPlayCard`'ın transaction gövdelerinin SAF (Firebase SDK'sız), test edilebilir, satır satır sadık portu. `resolveActingSeat(room, callerUid, actingForBotSeat)` yeni: gerçek oyuncu kendi UID'siyle kendi koltuğunu bulur; host bir bot koltuğu adına hareket ediyorsa (`actingForBotSeat` parametresi ile) hem o koltuğun gerçekten bot olduğu HEM DE çağıranın gerçekten güncel host olduğu ayrıca doğrulanır (bu, `multiplayerMode.js`'deki `amIHost` client-side kontrolünü sunucu tarafında da GERÇEK bir sınıra dönüştürür — önceden sadece bir client kolaylığıydı, hiç zorlanmıyordu).
2. `functions/index.js` — `attemptSlap`/`attemptPlayCard` adında iki `onCall` fonksiyonu, `gameLogic.js`'i gerçek bir RTDB transaction'ına bağlayan ince bir sarmalayıcı. Ayrıca `roomId` formatı regex ile doğrulanıyor (path-injection'a karşı savunma).
3. `functions/slapRules.js` — client'ın `public/js/slapRules.js`'inin elle senkronize edilen bir kopyası. Firebase Functions `functions/` dizinini İZOLE deploy eder, yani deploy anında `../public/js/`'e erişemez — bu, sıfır-build-step felsefesiyle çelişmeden gerçek bir paylaşılan modül kurmanın önündeki gerçek bir engel. **Slap kurallarını değiştirirsen bu İKİ dosyayı da elle güncelle**, yoksa offline ve multiplayer farklı kurallar uygular.
4. `firebaseSync.js`'e `USE_SERVER_VALIDATION` bayrağı (varsayılan `false`) + `_pushSlapAttemptSecure`/`_pushPlayCardSecure`. Bayrak açıkken mevcut `pushSlapAttempt`/`pushPlayCard` çağrı noktaları (multiplayerMode.js'te HİÇBİR DEĞİŞİKLİK YOK) şeffafça bu güvenli yola yönleniyor.
5. `test_gameLogic.mjs` (proje kökünde) — `node test_gameLogic.mjs` ile çalıştırılan 53 birim test. Kimlik/yetki çözümleme, kalkan yenileme/kırılma, normal yakma vs. ölü-şaplak elenmesi, meydan okuma sırasında son kartı yakıp diskalifiye olma, karşı-meydan-okuma, şans tükenmesi, savunmacının eli boşken otomatik kaybı, ve tüm kazanma koşulu yolları test ediliyor. **53/53 geçiyor.**

**Ne test EDİLMEDİ (dürüstçe):** Bu birim testleri oyun KURALLARININ izole halde doğru davrandığını kanıtlıyor. `onCall`/RTDB transaction bağlantısını, deploy yapılandırmasını, veya eşzamanlı erişim davranışını KANITLAMIYOR — bunun için gerçek bir Firebase projesi veya emulator gerekiyor, ve bu oturumu yazan ortamda ağ erişimi yoktu. Bu yüzden:

**Aşamalı devreye alma planı:**
- **Faz 1 (bu teslimat):** `functions/` yazıldı + test edildi, `USE_SERVER_VALIDATION = false`, `database.rules.json` DOKUNULMADI. Hiçbir şey canlıda değişmedi.
- **Faz 2 (senin yapman gereken):** `cd functions && npm install`, sonra `firebase emulators:start` ile gerçek oynanışa karşı test et (özellikle: tüm 4 kazanma yolu, her iki yakma yolu, meydan okuma başlangıç/kazanma/kaybetme, host migrasyonu, ölü-şaplak elenmesi). Emulator'da temiz çalışırsa `firebase deploy --only functions`, sonra `FirebaseSync.USE_SERVER_VALIDATION = true` yap ve birkaç gerçek maçta izle.
- **Faz 3 (Faz 2 sorunsuz geçtikten SONRA):** `database.rules.json`'da `gameRooms/$roomId/players/*/cards`, `pile`, `burnPile`, `activePlayerId`, `challenge`, `gameOver`, `winnerId` alanlarına client'tan DOĞRUDAN yazmayı kapat (Admin SDK zaten güvenlik kurallarından muaf, Cloud Function'lar etkilenmez). Bu, gerçek "yetkili sunucu" anını işaretler.

Faz 3'e Faz 2 olmadan atlama — test edilmemiş bir Cloud Function'a TEK yol olarak bağımlı kalırsan ve bir hata varsa, multiplayer tamamen kırılır ve geri dönüş yolu kalmaz.

---

## 8. Deployment

```bash
# Firebase Hosting deploy (firebase CLI gerekir)
firebase deploy --only hosting

# RTDB kurallarını deploy et
firebase deploy --only database

# Cloud Functions deploy (v2.9.0, henüz YAPILMADI — bkz. §7.4 Faz 2)
cd functions && npm install && cd ..
firebase deploy --only functions

# Hepsi birden
firebase deploy
```

Build adımı yok. Tüm JS native ES modülleri olarak servis edilir. `firebase.json` tüm route'ları `index.html`'e yönlendirir (SPA). `functions/` bu kuralın DIŞINDA — Node.js ortamında çalışır, kendi `package.json`'ı var, ayrı deploy edilir. **`firebase deploy --only functions`'ı çalıştırmadan/emulator'da test etmeden önce §7.4'ü oku.**

**Cache:** `index.html` ve tüm `*.js`/`*.css` `no-cache, no-store` — yenileme her zaman güncel sürümü getirir.

---

## 9. Bilinen Hatalar ve Düzeltilen Sorunlar

| ID | Durum | Açıklama |
|---|---|---|
| BUG-01 | ✅ Düzeltildi | `GameState.init()` çağrısında streak'ler sıfırlanmıyordu |
| BUG-02 | ✅ Düzeltildi | `quitGame()` sırasında streak'ler temizlenmiyordu — oturumlar arası taşınma |
| BUG-03 | ✅ Düzeltildi (v2.9.0) | Kurallar paneli "Perfect Slap" adında bir mekanik vaat ediyordu (4 dilde, `rPerfectTitle`/`rPerfectDesc`) ama kodda hiç implemente edilmemişti — panel bir yalan söylüyordu. Bkz. §6.19. |
| BUG-04 | ✅ Düzeltildi (v2.9.0) | `localization.js`'de 4 anahtar (`emailLabel`, `matchHistoryTitle`, `last5matches`, `cancel`) sadece EN/TR/DE/RU'nun BİRİNDE bile tanımlı değildi — `Localization.get()` bu anahtarlarda ham key string'ini döndürüyordu. Tüm 4 dile eklendi; artık script ile doğrulanan tam paritede (253/253 anahtar). |

**Önemli pattern:** Herhangi bir edge case düzeltildiğinde hem `game.js` (offline) hem `firebaseSync.js` (multiplayer transaction) kontrol edilmeli — aynı hata genellikle her ikisinde de bulunur.

**Yeni pattern (v2.9.0'dan sonra):** `localization.js`'ye anahtar eklerken/değiştirirken, 4 dil bloğunun da güncellendiğini ve parite bozulmadığını doğrulamak için hızlı bir Node script çalıştırın (dosyayı `require()` edilebilir hale getirip `Object.keys()` karşılaştırması — bu oturumda kullanılan yöntem). Elle saymaya güvenmeyin, 253 anahtar × 4 dilde bir satır kolayca atlanır.

---

## 10. Geliştirme Kuralları

- **Bundler yok** — native ES module `import` kullan. `require()` veya CommonJS ekleme.
- **TypeScript yok** — sade JavaScript. Açıkça istenmedikçe değiştirme.
- **Tek CSS dosyası** — tüm stiller `public/style.css`'te. Bileşen bazlı CSS dosyası oluşturma.
- **Lokalizasyon zorunluluğu** — tüm kullanıcıya gösterilen dizgiler `localization.js`'den gelmeli. JS veya HTML'ye İngilizce dizgi yazma.
- **Firebase SDK versiyonu** — `10.7.1` (CDN'den). Multiplayer'ı kapsamlı test etmeden değiştirme.
- **Bot backfill kuralı** — Multiplayer'da insan bağlantısı kesilince `convertToBot()` host istemci tarafından çağrılır. Multiplayer botları host'un `ai.js`'i yönetir.
- **Test arayüzü** — `GameState.init()` sonrası `window.GameState` tarayıcı konsolundan erişilebilir.
- **Slap kural değişikliği protokolü** — `slapRules.js` güncelle → `game.js::isValidSlap()` güncelle → `firebaseSync.js::evaluateSlap()` güncelle. Üçünün de güncellenmeden deploy yapma.

---

## 11. EventBus Listener Temizleme Uyarısı

`EventBus.off()` eksik kullanımı dinleyici birikimine yol açar. Mevcut tek koruma `GameState._turnListenerAttached` guard'ıdır. Diğer listener'lar için temizleme yapılmıyor (COUNCIL borcu). Yeni modül eklerken `off()` çağrılarını sağla.

---

## 12. Feature Roadmap

Tam öncelikli yol haritası için [`COUNCIL.md`](./COUNCIL.md)'e bakın (dört perspektifli sorgulama: Mühendis, Tasarımcı, Rekabetçi Oyuncu, Ürün).

**v2.9.0 notu:** Bu listedeki madde 2 (rulesPanel içeriği) ve madde 8 (shield countdown) kodda ARTIK MEVCUT — bu doküman güncellemesinden önce muhtemelen ayrı bir oturumda tamamlanmış ama roadmap'ten düşülmemiş. Devralan mühendis bu listeye güvenmeden önce kodda `grep` ile doğrulasın; bu doküman geçmişte de gerçek kod durumunun gerisinde kalmış (bkz. BUG-03, rulesPanel.js'in "içerik yok" sanılması). v2.9.0'da eklenen 5 yeni özellik + Perfect Slap düzeltmesi için §6.14–6.19'a bakın — bunlar bu roadmap'te DEĞİL, ayrı bir oturumdaki iki analiz dokümanının (sunucu-doğrulama/büyüme fikirleri ve "10 AAA fikri") kapsamadığı, bilinçli olarak farklı 5 fikirdi. Ayrıca **sunucu tarafı doğrulama artık tamamen açık DEĞİL** — §7.4'te Faz 1'i (yazıldı + birim test edildi, henüz deploy edilmedi/aktif değil) tamamlandı, Faz 2-3 (emulator testi, deploy, `database.rules.json` kilitleme) devralan mühendisi bekliyor. O iki dokümandaki DİĞER hiçbir madde (Ranked/Elo, başarımlar, günlük görevler, ev kuralları motoru, tam multiplayer seyirci modu, kozmetikler, PWA, WebRTC sesli sohbet, çip/turnuva ekonomisi, slow-mo replay, RuleEngine birleştirmesi) bu oturumda YAPILMADI — hâlâ tamamen açık.

**Kısa vadeli öncelikler (sırayla, doğrulanmamış eskiler dahil):**
1. `game.js` unit testleri — slap kuralları, challenge, burnPile, dead-game
2. ~~`rulesPanel` içeriği + geçersiz slap geri bildirimi~~ — içerik kısmı yapılmış görünüyor (bkz. yukarıdaki not); inline geçersiz-slap tooltip'i doğrulanmadı
3. Multiplayer reconnect sertleştirme (`localStorage` temizleme yalnızca `gameOver`'da — crash'te kaybolabilir)
4. `firebaseSync.js` bölünmesi → `deltaEngine.js`, `transactionWriter.js`, `syncMapper.js`
5. Kural presetleri — lobi'de slap kurallarını açma/kapama
6. Streak / achievement istatistikleri — `UserProfile`'e kişisel kayıtlar (NOT: oturum-içi galibiyet serisi artık var, bkz. §6.16 — ama bu kalıcı/Firestore değil, bilinçli olarak öyle)
7. Davet linki — arkadaşa oda ID'si otomatik paylaşım
8. ~~Shield countdown görsel göstergesi~~ — kodda mevcut görünüyor (bkz. yukarıdaki not)
9. Mobile dokunma alanı iyileştirmeleri

---

## 13. Sık Yapılan Hatalar

| Hata | Doğrusu |
|------|---------|
| Multiplayer'da `GameState.*` doğrudan mutasyon | RTDB transaction'ı kullan, snapshot kendisi günceller |
| Slap kuralını sadece `game.js`'te güncelleme | `slapRules.js` + `game.js` + `firebaseSync.js` — üçü birlikte |
| BGM'i `DOMContentLoaded`'da başlatma | İlk kullanıcı etkileşimine kadar ertele |
| CSP'yi güncellemeden harici script ekleme | `firebase.json` → CSP header'ı güncelle |
| Shield timer'ları tek yerde yönetme | Offline: `shieldDecayTimers`, Multiplayer: `dbShieldDecayTimers` — ayrı |
| `visualIndex` yerine `dbIndex` ile emit | UI event'lerinde her zaman `visualIndex` kullan |
| `style.css`'yi bölmeye çalışma | Tek dosya kuralı — dağıtma |
