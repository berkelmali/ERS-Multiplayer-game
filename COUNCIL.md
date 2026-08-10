# ERS Game — Sorgulayıcı Konsey (Challenger Council)

Bu belge bir yol haritası değil, **aktif bir sorgulama aracıdır.**  
Her öneride önce riski sor, sonra alternatifi yaz, sonra uygula.

---

## Konsey Kuralları

Bu konsey **onaylamak için değil, doğruluğu sağlamak için** vardır.

1. **Övgü ve giriş yasak.** Her analiz doğrudan riskle başlar.
2. **Risk ilk cümlede.** Eğer bir öneride hata veya tehlikeli varsayım varsa, bunu ilk cümlede söyle.
3. **Güven etiketleri zorunlu:**
   - `[Kesin]` — Kodda kanıtlanmış gerçek
   - `[Muhtemel]` — Güçlü çıkarım, test edilmedi
   - `[Tahmin]` — Bilgi eksikliğini dolduran varsayım
4. **Katılmama şablonu:**
   > *Katılmıyorum çünkü [neden]. Bunun yerine yapılacak: [alternatif]. Bu yaklaşımın riski: [dezavantaj].*
5. **Pozisyon koru.** Yeni bir kod kanıtı sunulmadıkça geri adım atma.

---

## Konsey Üyeleri ve Sorumlulukları

Her özellik veya karar aşağıdaki **dört perspektiften** sorgulanır. Her üye kendi alanında itiraz eder, onaylamaz.

---

### 🔴 Mühendis — Kod Kalitesi & Dayanıklılık

**Görevi:** Teknik borçları, mimari kırılganlıkları ve test edilemeyen kodları tespit et.

**ERS projesinde aktif riskler:**

- `[Kesin]` `game.js::isValidSlap()` ve `firebaseSync.js::evaluateSlap()` ayrı uygulamalardır. Birine kural eklenip diğeri unutulursa offline/online davranış ayrışır.
- `[Kesin]` `shield` sistemi hem `game.js` içinde (`shieldDecayTimers`) hem `firebaseSync.js` içinde (`dbShieldDecayTimers`) ayrı timer'larla yönetiliyor. Bu iki bağımsız saatin senkron kalması garanti değil.
- `[Muhtemel]` `EventBus.off()` çağrısı eksik listener'lar birikmesine neden olabilir. `_turnListenerAttached` guard'ı `init()` içinde var ama diğer event'ler için yok.
- `[Muhtemel]` `firebaseSync.js` 993 satır, tek sorumluluk ilkesini ihlal ediyor — delta hesaplama, RTDB transaction yazma, index rotasyonu ve shield timer'ları aynı dosyada.
- `[Tahmin]` Test yoksa refactor edilemez. Mevcut mimariyle `game.js` unit test yazmak mümkün ama `firebaseSync.js` için mock RTDB gerekecek.

**Konsey soruları — Mühendis:**
- Yeni bir slap kuralı eklerken `game.js` ve `firebaseSync.js` ikisini de güncellediğini nasıl garanti ediyorsun?
- `EventBus.on()` çağrılarını kim temizliyor? Sayfada kalınca listener leak oluşuyor mu?
- `firebaseSync.js` bölünebilir mi? (`deltaEngine.js`, `transactionWriter.js`, `syncMapper.js`)

---

### 🟡 Tasarımcı — Kullanıcı Deneyimi & Netlik

**Görevi:** Oyuncunun ne olduğunu anlayamadığı anları, belirsiz geri bildirimleri ve mobil kırılmaları tespit et.

**ERS projesinde aktif riskler:**

- `[Kesin]` `rulesPanel.js` 606 byte — pratikte içerik yok. Oyuncu neden slap'ının geçersiz olduğunu oyun içinde öğrenemez.
- `[Muhtemel]` Turn timer görsel olarak UI'da gösteriliyor ama timer'ın kaç saniyede dolacağı `difficulty`'ye göre değişiyor ve oyuncu bunu bilmiyor.
- `[Muhtemel]` Shield kazanma/kaybetme animasyonları var ama shield'ın ne zaman dolacağına dair (30s) görsel countdown yok.
- `[Tahmin]` Mobil'de slap için dokunma alanı yeterince büyük olmayabilir — `tableManager.js` masaüstü öncelikli tasarlanmış görünüyor.

**Konsey soruları — Tasarımcı:**
- Oyuncu ilk kez oynuyor. Invalid slap yedi. Neden yediğini öğrenebiliyor mu? Eğer hayır, bu bir tasarım borcu.
- Shield'ın 30 saniye sonra dolacağını kullanıcı görsel olarak fark edebiliyor mu?
- `rulesPanel` açılacaksa, içinde ne olması gerekiyor?

---

### 🟠 Rekabetçi Oyuncu — Denge & Adalet

**Görevi:** Hile açıklarını, gecikme avantajlarını ve kural tutarsızlıklarını tespit et.

**ERS projesinde aktif riskler:**

- `[Kesin]` Multiplayer'da slap zaman damgası tamamen client-side (`Date.now()`). Yüksek latency'li oyuncu her zaman dezavantajlı — `firebaseSync.js::pushSlapAttempt` transaction'ı RTDB'ye ulaştığında geç kalabilir.
- `[Kesin]` Bot slap zamanlaması (`ai.js`) deterministik değil. Farklı `difficulty` seviyelerinde botların tepki süresi nasıl hesaplanıyor? Belgelenmemiş.
- `[Muhtemel]` `lastSlapWinTime` 500ms grace period çift slap yarış koşulunu önlüyor ama aynı anda iki gerçek oyuncu slap attığında transaction sıralaması first-writer-wins mi? RTDB transaction sırası ağ koşuluna bağlı.
- `[Tahmin]` "Tens" kuralı (sayı kartları toplamı 10) sadece `<= 10` kartlar için geçerli. J/Q/K/A dahil değil. Bu kural oyuncuya açıkça belirtilmiş mi?

**Konsey soruları — Rekabetçi Oyuncu:**
- İki oyuncu aynı anda slap atarsa kim kazanır? Bu kural dokümante edilmiş mi?
- Botlar `easy`/`hard` modunda ne kadar hızlı slap atıyor? Bu değerler ayarlanabilir mi?
- Yüksek ping'li oyuncu sistematik olarak mı kaybediyor?

---

### 🟢 Ürün & Topluluk — Bağlılık & Büyüme

**Görevi:** Oyuncunun neden geri döndüğünü sorgula. Yoksa geri dönmüyor mu?

**ERS projesinde aktif riskler:**

- `[Muhtemel]` `scoreSystem.js` ve `leaderboard.js` var ama kazanma dışında bir başarı metriği yok. Oyuncu "en hızlı slap" veya "en uzun streak" gibi kişisel kayıtlarını göremez.
- `[Muhtemel]` Tutorial veya pratik mod yok. Yeni oyuncu challenge mekanizmasını anlayamadan eleniyor.
- `[Tahmin]` Multiplayer lobi akışı — oda oluşturma, bekleme, bot backfill — yeni kullanıcı için karmaşık olabilir. Dropout noktası nerede?

**Konsey soruları — Ürün:**
- Oyuncu bir maç bitince ne yapıyor? Tekrar oynuyor mu? Hangi buton bunu kolaylaştırıyor?
- `UserProfile` içinde oyuncuya gösterilecek ne var? Sadece skor mu?
- Davet linki olmadan bir arkadaşla nasıl oynuyorsun?

---

## Karar Protokolü

Herhangi bir özellik veya değişiklik aşağıdaki kapılardan geçmeden uygulanamaz:

```
Araştır → Planla → Uygula → Gözden Geçir → Yayınla
```

| Kapı | Soru | Geçme kriteri |
|------|------|---------------|
| **Araştır** | Bu değişiklik neyi kırar? | `game.js` + `firebaseSync.js` ikisi birden incelendi |
| **Planla** | Offline ve multiplayer her ikisi için de çalışıyor mu? | Her iki kod yolu test planında var |
| **Uygula** | Slap kuralı değiştiyse iki dosya da güncellendi mi? | Diff'te her iki dosya görünüyor |
| **Gözden Geçir** | EventBus listener'ları temizlendi mi? | Leak riski değerlendirildi |
| **Yayınla** | CSP başlığı güncellendi mi (yeni kaynak eklendiyse)? | `firebase.json` kontrol edildi |

---

## Öncelik Sırası (Güncel)

Bu sıra tartışmaya açıktır. Her maddeyi değiştirmeden önce konsey sorularını cevapla.

1. **`game.js` unit testleri** — refactor için zemin. Slap kuralları, challenge, burnPile, dead-game.
   - *Konsey itirazı:* `GameState` singleton ve `window.GameState` exposure test izolasyonunu zorlaştırıyor. Test öncesi `init()` desenini gözden geçir.

2. **`rulesPanel` içeriği + invalid slap geri bildirimi** — oyuncunun öğrenmesi.
   - *Konsey itirazı:* Açılır panel yerine inline tooltip daha az sürtünme yaratır.

3. **Multiplayer reconnect sertleştirme** — `reconnectManager.js` + `localStorage` tabanlı yeniden bağlanma.
   - *Konsey itirazı:* `localStorage` temizleme sadece `gameOver` sonrası tetikleniyor. Sekme kapanıp tarayıcı çöktüğünde ne olur?

4. **`firebaseSync.js` bölünmesi** — delta engine, transaction writer, sync mapper.
   - *Konsey itirazı:* Bölme önce testler yazılmadan yapılırsa regresyon riski yüksek.

5. **Rule presets** — lobby'de slap kurallarını açma/kapama.
   - *Konsey itirazı:* Her kural kombinasyonu için `isValidSlap()` + `evaluateSlap()` ikisinin güncellenmesi gerekiyor. Tek kaynaklı bir `SLAP_RULES` config objesi bu riski azaltır.

6. **Streak / achievement istatistikleri** — `UserProfile`'e kişisel kayıtlar.
   - *Konsey itirazı:* Firestore yazma maliyetini hesapla — her oyun sonu güncelleme mi, yoksa batch mi?

---

## Bu Belgeyi Nasıl Kullanırsın

- **Yeni özellik ekleyeceksin:** Dört konsey üyesinin sorusunu cevapla. Cevaplamadan başlama.
- **Bug fix:** Hangi konsey üyesi bu hatayı önceden işaret etti? Yoksa buraya ekle.
- **Mimari karar:** Karar protokolü kapılarından geçir. Geçemeyen kararı ertelenir.
- **Bu belgeyi güncelle:** Eski bir madde çözüldüyse işaretle ve kanıtını (commit, test sonucu) yanına yaz.
