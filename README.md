# 🃏 ERS (Egyptian Rat Screw) — Realtime Multiplayer Web Game

[![Firebase](https://img.shields.io/badge/Firebase-10.7.1-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B%20Native%20Modules-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![CSS3](https://img.shields.io/badge/CSS3-3D%20Transforms%20%26%20Animations-1572B6?logo=css3&logoColor=white)](https://w3.org/TR/css-transforms-1/)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **TR:** Tarayıcı üzerinden gerçek zamanlı, çok oyunculu ve yapay zeka destekli Mısır Fare Kapanı (Egyptian Rat Screw) kart oyunu.  
> **EN:** A fast-paced, real-time multiplayer & AI-powered web implementation of the classic Egyptian Rat Screw card game.

---

## 🌟 Öne Çıkan Özellikler / Key Features

### 🎮 Oyun Modları / Game Modes
* **🤖 Tek Oyunculu (Offline vs AI):** Farklı kişiliklere (`Aggressive`, `Cautious`, `Balanced`, `Troll`) ve canlı sohbet yeteneğine sahip 3 yapay zeka botuna karşı oyna.
* **🌐 Çok Oyunculu (Online Multiplayer):** Firebase Realtime Database & Firestore kuyruk sistemi ile 2-4 gerçek oyuncuyla eşleş. Eksik slotlar otomatik olarak botlarla doldurulur.
* **🎓 Pratik & Öğretici Modu (Tutorial Mode):** Oyuna yeni başlayanlar için adım adım Slap (el basma) ve Meydan Okuma (Challenge) kurallarını öğreten etkileşimli kılavuz.

### ⚡ Oyun Mekanikleri & Görsellik / Gameplay Mechanics & Visuals
* **⚡ Perfect Slap & Danger Zone:** Saliselerle ölçülen refleks takibi! Mükemmel zamanlamayla basılan el ekstra puan ve visual/audio efektler kazandırır.
* **🎨 3D Parallax Masa & Dinamik Deste:** CSS 3D transformasyonları, dynamic card placement, kart dağıtma ve toplama animasyonları.
* **🎵 Web Audio API Ses Motoru:** Gerilim yükseldikçe dinamik olarak katmanlanan arka plan müziği (Tension Drone) ve zengin SFX setleri.
* **🛒 Kart Kostümleri & Mağaza (Shop & Cosmetics):** Maç kazandıkça biriken madeni paralarla (Coins) açılabilen özel kart desteleri ve temalar.
* **🖼️ Paylaşılabilir Maç Kartı (Canvas Result Card):** Maç sonlarında Canvas teknolojisi ile oluşturulan, istatistikleri ve MVP anını içeren indirilebilir/paylaşılabilir görsel kart.
* **🌍 Çok Dilli Desteği (i18n):** Türkçe 🇹🇷, İngilizce 🇬🇧, Almanca 🇩🇪 ve İspanyolca 🇪🇸 dil desteği.
* **🎨 5 Renkli Tema:** Classic, Blue, Dark, Green, Red temaları.

---

## 📜 Slap (El Basma) & Meydan Okuma Kuralları / Rules

### 🖐️ Slap Kuralları (Geçerli Durumlar)
Masadaki ortaya atılan kart diziliminde aşağıdaki durumlar oluştuğunda masaya ilk basan oyuncu yerdeki tüm kartları toplar:

| Kural Name | Örnek / Example | Açıklama |
|---|---|---|
| **Double (Çift)** | `7` - `7` | Üst üste aynı değerde iki kart |
| **Sandwich (Sandviç)** | `7` - `K` - `7` | Arasında 1 farklı kart bulunan aynı değerde iki kart |
| **Tens (Onlular)** | `4` - `6` veya `7` - `3` | Üst üste gelen iki kartın toplamının 10 etmesi (Resimli kartlar hariç) |
| **Marriage (Evlilik)** | `K` - `Q` veya `Q` - `K` | Yan yana gelen Kral ve Kraliçe |
| **Top-Bottom (Baş-Son)** | `A` ... `A` | Masaya atılan ilk kart ile en son atılan kartın eşleşmesi |
| **Four in a Row (Dörtlü Seri)** | `2` - `3` - `4` - `5` | Art arda gelen 4 sıralı kart dizilimi |
| **Triple (Üçlü)** | `9` - `9` - `9` | Üst üste aynı değerde 3 kart |

> ⚠️ **Hatalı Slap (Burn):** Yanlış zamanda el basan oyuncu destesine ceza olarak 1 kart yakar (burn pile).

---

### ⚔️ Meydan Okuma (Challenge) Kuralları
Resimli bir kart (As, Papaz, Kız, Vale) atıldığında bir sonraki oyuncunun kartı bozmak için belirli sayıda hakkı vardır:

* **As (Ace):** 4 Hak
* **Papaz (King):** 3 Hak
* **Kız (Queen):** 2 Hak
* **Vale (Jack):** 1 Hak

Eğer savunmadaki oyuncu hakları bitene kadar resimli kart atamazsa, meydan okuyan oyuncu ortadaki tüm kartları alır. Savunmacı resimli kart atarsa meydan okuma sırası bir sonraki oyuncuya geçer.

---

## 🛠️ Teknoloji Yığını / Tech Stack

* **Frontend:** Vanilla JavaScript (Native ES6 Modules — `import`/`export`), HTML5, Vanilla CSS3 (Custom Properties & 3D Tilt/Transformations). Build adımı gerektirmez, dosyalar doğrudan servis edilir.
* **Backend & Cloud Services:**
  * **Firebase Realtime Database:** Gerçek zamanlı oyun durumu senkronizasyonu ve transactional durum güncellemeleri.
  * **Firebase Firestore:** Kullanıcı profilleri, küresel skor tablosu (Leaderboard) ve matchmaking kuyrukları.
  * **Firebase Cloud Functions (Node.js ESM):** Sunucu tarafı yetkili işlem doğrulamaları (`attemptSlap`, `attemptPlayCard`).
  * **Firebase Hosting:** Güvenli HTTP başlıkları (CSP, HSTS) ve performans optimize edilmiş CDN dağıtımı.
* **Testing:** Node.js Native Test Runner (`test_gameLogic.mjs` — 53 kapsamlı birim testi).

---

## 📁 Proje Dizin Yapısı / Directory Structure

```
ers-web/
├── public/                     # Frontend Statik Dosyaları
│   ├── index.html              # Uygulama ekranları ve HTML kabuğu
│   ├── style.css               # Tüm UI stilleri, temalar ve animasyonlar
│   ├── assets/                 # Arka plan görselleri ve logo
│   ├── audio/                  # SFX ses efektleri ve BGM müzikleri
│   └── js/                     # Native ES Modülleri
│       ├── main.js             # Giriş noktası & initialization
│       ├── game.js             # Çekirdek Oyun Motoru & GameState
│       ├── slapRules.js        # Slap kural motoru (Single source of truth)
│       ├── ai.js               # Bot yapay zekası & kişilik mantığı
│       ├── ui.js               # UI Render & Animasyon yöneticisi
│       ├── firebaseSync.js     # Realtime DB senkronizasyonu & Transactional yazma
│       ├── firebaseConfig.js   # Firebase servis yapılandırması
│       ├── tableManager.js     # 3D masa fiziği ve kart yerleşimi
│       ├── audioManager.js     # Web Audio API ses efektleri ve müzik
│       ├── localization.js     # i18n Dil sözlüğü (TR, EN, DE, ES)
│       ├── cardSkins.js        # Kart kaplamaları & ekonomi sistemi
│       ├── shopUI.js           # Mağaza paneli
│       └── victoryScreen.js    # Oyun sonu ekranı & MVP istatistikleri
├── functions/                  # Firebase Cloud Functions backend
│   ├── index.js                # Cloud Function endpoint tanımları
│   ├── gameLogic.js            # Saf, Firebase SDK'sız sunucu iş mantığı
│   └── package.json            # Node.js 20 ESM paketi
├── test_gameLogic.mjs          # Birim test kümesi (53/53 PASS)
├── firebase.json               # Firebase Hosting & Database kural yapılandırması
├── database.rules.json         # Realtime Database güvenlik kuralları
├── CLAUDE.md                   # Detaylı mimari ve geliştirici dokümantasyonu
└── COUNCIL.md                  # Geliştirme yol haritası
```

---

## 🚀 Kurulum ve Çalıştırma / Local Setup

 Proje native ES modülleri kullandığı için herhangi bir karmaşık derleme (build/webpack/vite) adımı gerektirmez.

### 1️⃣ Yerel Sunucuda Çalıştırma (Development)
Projeyi herhangi bir statik web sunucusu (VS Code Live Server, python http.server veya `npx serve`) ile çalıştırabilirsiniz:

```bash
# Proje dizinine gidin
cd ers-web

# Python 3 ile yerel sunucu başlatın:
python -m http.server 8000

# VEYA Node.js serve ile:
npx serve public
```
Tarayıcınızda `http://localhost:8000` veya gösterilen port adresini açarak oyunu oynayabilirsiniz.

---

### 2️⃣ Birim Testleri Çalıştırma (Unit Tests)
Oyun mantığının (Slap doğrulama, sıra takibi, challenge hesaplama) doğruluğunu sınamak için:

```bash
node test_gameLogic.mjs
```
*Tüm testlerin (53/53 PASS) başarıyla geçtiğini doğrulayın.*

---

### 3️⃣ Firebase Cloud Functions & Hosting Dağıtımı (Deployment)
Projeyi Firebase Hosting ve Cloud Functions üzerine canlıya almak için:

```bash
# Firebase CLI yükleyin (yüklü değilse)
npm install -g firebase-tools

# Firebase hesabınızla giriş yapın
firebase login

# Projeyi canlıya alın
firebase deploy
```

---

## 👥 Katkıda Bulunma / Contributing

1. Bu depoyu çatallayın (Fork)
2. Yeni bir özellik dalı oluşturun (`git checkout -b feature/harika-ozellik`)
3. Değişikliklerinizi kaydedin (`git commit -m 'feat: Harika özellik eklendi'`)
4. Dalınıza itin (`git push origin feature/harika-ozellik`)
5. Bir Çekme İsteği (Pull Request) oluşturun

---

## 📄 Lisans / License

Bu proje **MIT Lisansı** altında lisanslanmıştır. Detaylar için `LICENSE` dosyasına bakabilirsiniz.

---

<p align="center">
  Geliştirici: <b>Berk Elmalı</b> — <a href="https://github.com/berkelmali">@berkelmali</a>
</p>
