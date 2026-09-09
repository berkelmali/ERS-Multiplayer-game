# Memory export — 50 observations
_2026-09-08T17:24:41+00:00_


## 2026-09-05

### #1 [decision] ERS-07 konsey: davet linki kararı auth çözülene kadar ertelenir
**Why:** AuthSystem.currentUser yalnızca async onAuthStateChanged içinde atanıyor, yani DOMContentLoaded anında HER ZAMAN null. Açılışta ona bakan her dallanma yanlış cevap verir — giriş yapmış oyuncuya bile 'Please log in' gösteriliyordu.
_`project`: ers · `tags`: ERS-07,auth,council,invite · `files`: public/js/main.js_

### #2 [gotcha] Bekleyen davet kodunun TTL'i kendini yeniliyordu (peek vs consume)
**Why:** savePendingInvite() 'at' alanını varsayılan olarak now yapıyor. Kodu okuyup tekrar kaydetmek zaman damgasını her auth olayında sıfırlıyordu, 15 dakikalık pencere hiç dolmuyordu. Okumak için peek, yalnızca gerçekten katılırken consume.
_`project`: ers · `tags`: ERS-07,invite,ttl · `files`: public/js/inviteLink.js,public/js/main.js_

### #3 [decision] ERS-08 konsey: hata ekranı .screen ve .modal-overlay sistemlerinin İKİSİNE de girmez
**Why:** .modal-overlay display ve position vermiyor (onlar .screen'den geliyor), yani tek başına kalıcı görünür bir şerit olur. .screen ise dört dosyada toplu temizleniyor, yani modal kendi Tekrar Dene butonunun tetiklediği geçişte silinir. Çözüm #loading-overlay kalıbı: body çocuğu, kendi position:fixed'i, kendi .open anahtarı.
_`project`: ers · `tags`: ERS-08,council,modal,ui · `files`: public/js/errorScreen.js,tools/check-error-modal.mjs_

### #4 [bugfix] Uygulamada hiçbir ağ çağrısında zaman aşımı yoktu — catch bloğuna hiç girilmiyordu
**Why:** Firestore taşıma hatasında REDDETMEZ; okumayı kuyruğa alıp süresiz yeniden dener. Söz hiç sonuçlanmaz, finally çalışmaz, hideLoading tetiklenmez: kapatılamayan tam ekran spinner. ERS-08 baştan sona bir catch-bloğu tasarımıydı ve kullanıcının tarif ettiği senaryoda hiçbiri çalışmıyordu.
_`project`: ers · `tags`: ERS-08,network,timeout · `files`: public/js/errorCodes.js,public/js/ui.js_

### #5 [constraint] navigator.onLine yalnızca OLUMSUZ yönde güvenilir
**Why:** false ise gerçekten çevrimdışıdır. true yalnızca link katmanı bağlantısı demek, erişilebilirlik kanıtı değil — bu yüzden true hiçbir şeye karar veremez.
_`project`: ers · `tags`: ERS-08,network · `files`: public/js/errorCodes.js_

### #6 [constraint] Maç sırasında modal açılmaz; bağlantı kaybı bloklamayan bantla bildirilir
**Why:** El ortasında ekranı çalan bir modal, yerini aldığı sessizlikten kötüdür ve kopmaların çoğu bir iki saniyede kendi kendine düzelir.
_`project`: ers · `tags`: ERS-08,ui · `files`: public/js/connectionBanner.js,public/js/errorScreen.js_

### #7 [bugfix] Kalkanın aynı iş için iki 30sn saati vardı, sadece biri yenileniyordu
**Why:** shieldEarned yalnızca streak 0->3 geçişinde tetikleniyor. Yenileyen şaplak streak'i 3'te TUTTUĞU için olay hiç çıkmıyor: çizilen sayaç sıfıra inip kayboluyor, gerçek kalkan 30sn daha koruyordu. Duyuru arma fonksiyonunun İÇİNE taşındı — tek koşul ikisini de başlatmazsa sapma kaçınılmazdır.
_`project`: ers · `tags`: ERS-09,shield,ui · `files`: public/js/firebaseSync.js,public/js/game.js,public/js/ui.js_

### #8 [bugfix] window.AuthSystem hiç atanmıyordu; botlar kalkanını maç boyunca kaybetmiyordu
**Why:** expireDbShield bot kalkanını silme yetkisini window.AuthSystem üzerinden kontrol ediyordu. main.js window.GameState/HouseRules/UI atıyor ama AuthSystem'i asla. Kontrol kalıcı false; çok oyunculuda tek zaman-tabanlı sönümleme yolu bu ve sunucu da 3'teki streak'i koruyor. window.UI ile aynı sınıf: canlı olmayan bir isme bağlı güvence.
_`project`: ers · `tags`: ERS-09,multiplayer,shield · `files`: public/js/firebaseSync.js_

### #9 [bugfix] check-locales'in çift-anahtar dedektörü 39 çift tanımı göremiyordu
**Why:** Regex tam 8 boşluk girintili satır başı arıyordu; bloklar onlarca anahtarı tek uzun satıra paketliyor ve hepsi görünmezdi. Kapı yıllarca yeşil tik bastı. Artık girintiye değil anahtardan önceki ayırıcıya bakıyor. Bir kapının kendi kör noktası, kapının olmamasından kötüdür — yeşil tik 'kontrol edildi' demektir.
_`project`: ers · `tags`: ERS-09,gate,i18n · `files`: public/js/localization.js,tools/check-locales.mjs_

### #10 [bugfix] botReplacedMsg placeholder'ını kaybetti; oyuncu öznesiz cümle görüyordu
**Why:** ui.js:361-363 {old}/{new} yerleştiriyor ama çift tanımdan kazanan sürümde placeholder yoktu, yani iki replace no-op. Doğru şablon yüz satır yukarıda gölgeleniyordu. Dört dilde birden.
_`project`: ers · `tags`: ERS-09,i18n · `files`: public/js/localization.js,public/js/ui.js_

### #11 [constraint] USE_SERVER_VALIDATION false — canlı şaplak işlemi firebaseSync.js, testler gameLogic.js'i test ediyor
**Why:** Canlı çok oyunculu işlem firebaseSync.js:688-712 + _applySlapBurn. Test süitinin her applySlapAttempt iddiası uyuyan functions/gameLogic.js kopyasını hedefliyor; firebaseSync teste yalnızca readFileSync ile metin olarak giriyor. İki gövde birbirine SADECE bir yorum satırıyla bağlı. Projenin en güçlü güvenlik iddiası çalışmayan kod hakkında yapılıyor.
_`project`: ers · `tags`: ERS-09,critical,multiplayer,testing · `files`: functions/gameLogic.js,public/js/firebaseSync.js,test_gameLogic.mjs_

### #12 [gotcha] EventBus.off(event) callback'siz çağrıldığında O OLAYIN TÜM dinleyicilerini siler
**Why:** ui.js bu formu 25 kez kullanıyor. Bugün zararsız çünkü UIManager.init idempotent ve ilk çalışıyor — ama on/emit sayan bir dedektör olayı 'bağlı' görür. Sayma tabanlı dedektörler çalışma-zamanı kaydını göremez.
_`project`: ers · `tags`: ERS-09,detector,eventbus · `files`: public/js/eventbus.js,public/js/ui.js_

### #13 [pattern] Render oluyor ama çalışmıyor — bu projenin en pahalı hata sınıfı, altı tekrar
**Why:** 1) window.UI olmayan tanımlayıcı 2) gizlilik linki pointer-events:none içinde 3) politika HTML'de 'Account text' 4) davet modalı opacity:0 5) iki buton aynı absolute köşede 6) #notifications, display:none bir .screen içinde. Hiçbiri birim testiyle görülemedi. Kaynak şeklini okuyan test, ekranı gören testin yerine geçmez.
_`project`: ers · `tags`: critical,pattern,ui · `files`: public/index.html,public/style.css_

### #14 [gotcha] Görünürlük ölçütü offsetParent DEĞİL, getClientRects().length
**Why:** position:fixed bir eleman ekranda olsun olmasın tanım gereği null offsetParent döndürür. offsetParent ile yazılmış bir görünürlük testi, doğru render olan toast'ı görünmez diye raporladı — yakalamak için yazıldığı hatanın aynısı, bir kat yukarıda.
_`project`: ers · `tags`: testing,ui · `files`: tools/smoke.mjs_

### #15 [pattern] Dedektör yazma kuralı: elle bir kez çalıştırıp temiz görünene kadar ayarlanan dedektör yazarına katılmak üzere ayarlanmıştır
**Why:** ERS-09'da yazdığım dört dedektörün dördünde de kör nokta vardı, ikisi gerçek pozitif gizliyordu: birleştirilmiş id'ler, template literal içindeki id'ler, module.default.emit biçimi, çok argümanlı classList.remove (sadece ilk argüman yakalanıyordu).
_`project`: ers · `tags`: detector,pattern,testing_

### #16 [pattern] Test iddiasında mesafe penceresi değil dilim kullan
**Why:** 600 ve 3000 karakterlik pencereler kırdığım yeri değil BAŞKA bir yeri eşleştirdi (bir çağrı noktasını tanım sanmak; 4600 karakterlik bir dinleyici gövdesini kaçırmak). Fonksiyona dilimle ya da occurrence say. Aynı hataya ERS-08 ve ERS-09'da ikişer kez düştüm.
_`project`: ers · `tags`: pattern,testing · `files`: test_gameLogic.mjs_

### #17 [decision] ERS-09 konsey kararı: diriliş özelliği ürün kararına havale edildi, sonra kullanıcı kuralı belirledi
**Why:** resurrected olayının 3 dinleyicisi 0 yayıcısı var; kural sayfası dört dilde vaat ediyor. Ölü olmasının sebebi benim gösterdiğim game.js:489 DEĞİL: tek oyunculuda :291-305 maçı anında bitiriyor, çok oyunculuda elenme kalıcı (repoda eliminated=false hiç yok), ve victoryScreen.js:63 masayı pointerEvents:none yapıyor. Kullanıcı kararı: çok oyunculuda masadaki gerçek insan oyuncu sayısı 0 olduğunda elenme kalıcılaşsın.
_`project`: ers · `tags`: ERS-09,council,product,resurrection · `files`: public/js/firebaseSync.js,public/js/game.js,public/js/victoryScreen.js_

### #18 [decision] v3.7.4 ürün kararı: çok oyunculuda canlı insan sayısı 0 olunca maç biter, elenme kalıcılaşır
**Why:** Kullanıcının kararı. convertToBot ayrılan oyuncunun uid'ini bot_ yapıyor; insanlar gidince masa tamamen bota dönüyordu ve resolveEndOfMatch hiçbir bitiş koşuluna ulaşamıyordu (ne tek ayakta kalan, ne 52 kart) — oda RTDB'de süresiz açık kalıyordu. Kural zaten canlı transaction'da 'End if 1 left OR no HUMANS left' yorumuyla yazılıydı ve humansLeft değişkeni hesaplanıp hiç okunmuyordu: yazılmış ama uygulanmamış bir kural.
resolveEndOfMatch üç koşuldan biriyle bitirir: bir el 52 kart; tek ayakta kalan; canlı insan yok. Üçüncüsü v3.7.4.

Kasıtlı daraltmalar (her biri testle sabitlendi):
- Tek insan kalmışsa TETİKLENMEZ.
- Gerçek bir kazananı EZMEZ (52 kartı alan insan yine kazanan).
- Kimseyi taçlandırmaz: winnerId = -1, bot şampiyon ilan edilmez.
- 'bot mu' tek yüklem: uid'in bot_ ile BAŞLAMASI (includes değil).
- uid'i olmayan koltuk bot SAYILMAZ (insan sayılır) — muhafazakâr taraf.

Kapsam sınırı, dürüstçe: kural bir sonraki şaplak sonucunda devreye girer. Şaplak akışı olmadan terk edilen oda süpürülmez (insan istemci kalmayınca botları da kimse sürmez); o oda 'atıl', 'bitmiş' değil. Odayı temizlemek convertToBot'un veya sunucu tarafı bir süpürücünün işi.

Yarıçap: yalnızca çok oyunculu. slapOutcome.js'i sadece firebaseSync.js import ediyor; tek oyunculu game.js kendi bitiş koşullarını kullanıyor. Bu yapısal garanti testle sabitlendi (Section 46), çünkü tek oyuncuda maçın anında bitmesi kurallar sayfasının '0 kartla da şaplak atıp geri dönebilirsin' vaadini bozardı.
_`project`: ers · `tags`: cok-oyunculu,eleme,kural,slapOutcome,v3.7.4 · `files`: functions/slapOutcome.js,public/js/slapOutcome.js,test_gameLogic.mjs_

### #19 [decision] Şaplak sonucu slapOutcome.js'e çıkarıldı: test edilen kod ARTIK canlı kodun ta kendisi
**Why:** USE_SERVER_VALIDATION false olduğu için canlı her şaplak firebaseSync.js'in kendi transaction gövdesinden geçiyordu; suite'teki her şaplak iddiası ise functions/gameLogic.js'i, yani ÇALIŞMAYAN kopyayı hedefliyordu. firebaseSync.js suite'e yalnızca regex taranacak kaynak metin olarak giriyordu — tek satırı bile çalıştırılmıyordu. İki gövdeyi bir yorum cümlesi hizada tutuyordu ('Faithful port of...'). Bu, window.UI ve window.AuthSystem ile aynı kusur şekli: güvencenin canlı olmayan bir isme bağlanması — ama burada güvence 1200 geçen testti.
Artık iki çağıran da tek modüle devrediyor; kayma tespit edilecek bir şey değil, olamayacak bir şey. functions/slapOutcome.js sync-rules.mjs ile üretilen bayt-aynası (Firebase functions/ dizinini izole deploy ettiği için dışarıdan import edemiyor); ayna bayatlarsa suite kırılıyor.

ÖLÇÜLDÜ: çıkarımdan sonra applySlapWin/applySlapBurn'e atılan 12 mutasyonun 12'si yakalandı. Çıkarımdan önce bu mutasyonların hiçbiri yakalanamazdı.

YARIM KALAN: play-card hâlâ iki elle yazılmış kopya (firebaseSync.pushPlayCard vs functions/gameLogic.applyPlayCard) — aynı sınıf, bu işin diğer yarısı. Section 45 bunu iddia olarak kayda geçiriyor ki unutulmasın.

USE_SERVER_VALIDATION hâlâ false ve öyle KALMALI (Cloud Function yolunda contest mantığı yok).
_`project`: ers · `tags`: cift-kopya,mimari,slapOutcome,test,v3.7.4 · `files`: functions/gameLogic.js,public/js/firebaseSync.js,public/js/slapOutcome.js_

### #20 [gotcha] Esdeger mutant: resolveEndOfMatch'te nonEliminated.length === 1 yerine <= 1 yazmak hicbir testi kirmaz
**Why:** Iki yazimin ayrildigi tek durum nonEliminated.length === 0. Orada findIndex(p => !p.eliminated) zaten -1 doner ve else dali da -1 uretir; tookWholeDeck o durumda true olamaz cunku hicbir yol desteyi alan koltugu elemez. Davranis farki yok: kapsam boslugu degil, esdegerlik.
v3.7.4 mutasyon turunda 11 mutasyondan tek hayatta kalan buydu.
_`project`: ers · `tags`: esdeger-mutant,mutasyon,slapOutcome,test · `files`: public/js/slapOutcome.js,test_gameLogic.mjs_

### #21 [pattern] Hicbir koruma kanitlanmadan gemiye binmez: mutasyon -> olc -> geri al
**Why:** v3.7.4 turunda 11 mutasyonun 10'u yakalandi, 1'i esdeger cikti. Degerli olan sayi degil: her hayatta kalan mutant ya gercek bir kapsam boslugu ya da yaziya dokulmesi gereken bir esdegerlik. Onceki turlarda hayatta kalan 9 mutantin tamami, iddianin kirilan yerden BASKA bir yeri eslemesinden kaynaklaniyordu (kardes fonksiyon, cagri yerine tanim, armLost(0) vs armLost()).
Kural: iddiayi fonksiyona dilimle, mesafe penceresi kullanma; tarama oncesi yorumlari sil; rakami degil IDDIAYI test et; bir kapinin kendi kor noktasi kapisizliktan kotudur.
_`project`: ers · `tags`: mutasyon,test-disiplini,yontem_

### #22 [gotcha] memory_store.py add, --body verilmediginde stdin'de sonsuza kadar bloke oluyordu
**Why:** Kosul 'args.body == "-" or (not body and not sys.stdin.isatty())' idi. isatty(), veri tasiyan bir pipe ile herhangi bir etkilesimsiz stdin'i (ajan kabugu, CI adimi, && zincirinin sag tarafi) birbirinden ayiramaz; --body atlanınca komut ciktisiz ve hatasiz sonsuza kadar asili kaldi. Duzeltme: stdin yalnizca acikca --body - verildiginde okunur. Bu, arsivin hatirlamak icin var oldugu hata siniflarinin ta kendisi: bir seyi tespit ediyormus gibi okunan, aslinda cok daha genis bir kumeyi eslesen kosul.
_`project`: ers · `tags`: arac,isatty,memory-store,stdin · `files`: tools/memory_store.py_


## 2026-09-06

### #24 [bugfix] Boot safety net v3.7.0-v3.7.4 arasi CSP tarafindan bloke edildi: hata ekrani hic acilamadi
**Why:** firebase.json'daki CSP'de script-src icin 'unsafe-inline' yok, yani <head>'deki satir ici boot net HER uretim yuklemesinde reddedildi. 'Uygulama baslatilamadi' ekrani tam da gerektigi anda yoktu, bes surum boyunca. Iki kapi yesil yakti: check-error-modal script'in KONUMUNU denetliyordu (sorun konum degildi) ve smoke.mjs kendi sunucusundan hicbir baslik gondermiyordu, yani ihlal edilecek politika yoktu. Uretimden daha musamahakar bir test ortami uretimi test etmez.
Duzeltme: hash ELLE degil uretiliyor (tools/csp-hash.mjs), npm run verify + deploy.bat 6/7 bayat hash'te duruyor. Ayrica onclick= satir ici handler da oluymus -- script-src onu da bloke ediyor ve hash bunu ACMAZ ('unsafe-hashes' gerekir); addEventListener'a cevrildi. 7 mutasyonun 7'si yakalandi.
_`project`: ers · `tags`: boot,csp,guvenlik,test-ortami,v3.7.5 · `files`: firebase.json,public/index.html,tools/csp-hash.mjs,tools/smoke.mjs_

### #25 [gotcha] Kaynak taramasi kendi yorumuna takilir: tek oturumda ayni tuzaga UC kez dusuldu
**Why:** Yorum tam da tarananin ne oldugunu anlatir, bu yuzden taranan kelimeyi neredeyse her zaman icerir. Ve cikplak regex, kirdigin yeri degil ayni ismi tasiyan baska bir yeri eslestirir. Bu iki kural zaten ers-testing-rules.md'de yaziliydi; yazili olmasi yetmedi, kapinin kendisi bunlari uygulamali.
1) csp-hash'in ilk regex'i #boot-error yorumundaki <script> kelimesini gercek etiketle eslestirip 5KB markup'i script sandi. 2) 'inline handler yok' iddiasi ayni yorumdaki onclick= kelimesini gordu. 3) smoke iddialari HOSTING_HEADERS ve NEVER_IGNORABLE'in TANIMINI eslestirdi, kullanim yerini degil -- 7 mutasyondan 2'si bu yuzden hayatta kaldi. Cozumler sirasiyla: dokumani yuruyerek tara (yorumu atla, ama script govdesindeki <!-- bozulmasin), taramadan once yorumlari sil, iddiayi cagri yerine dilimle.
_`project`: ers · `tags`: dedektor,tarama,test-disiplini,yorum_

### #26 [gotcha] Deploy konsolu yalan soyluyordu: cmd'de kacak < karakteri satiri yutar, Windows yolunda indexOf -1 doner
**Why:** Iki hata da 1346 testin kosmadigi yerde yasiyordu: cmd.exe ve Windows yol ayraclari. 1) 18 numarali surum notunda duz metin olarak <head> vardi; cmd icin < GIRDI YONLENDIRMESI, 'head' dosyasini aradi, bulamadi, SATIRI ATLADI -- CSP hatasini anlatan not, gorevi tam o anda operatore ne degistigini soylemek olan dosyada bir yonlendirme karakteri tarafindan yutuldu. 2) sync-rules adi sv.slice(sv.indexOf('functions/')) ile turetiyordu; Windows'ta path.join ters bolu uretir, indexOf -1 doner, slice(-1) son karakteri verir -> 's already in sync'. Suite bu sekli kendisi icin coktan yasaklamisti (anchorAt/sliceBetween) ama tools/ hic kapsanmamisti, ve Linux'ta ikisi de dogru calisiyor.
Kapi: deploy.bat'in hicbir echo/REM satirinda kacak < > olamaz; tools/ altinda hicbir dosya denetlenmemis bir indexOf'tan dogrudan slice alamaz; deploy.bat'in calistirdigi her kapi gorunur bir onay birakmak zorunda (sessiz kapi, calismamis kapidan ayirt edilemez). 6 mutasyonun 6'si yakalandi.
_`project`: ers · `tags`: -1,cmd,deploy,slice,v3.7.6,windows · `files`: deploy.bat,test_gameLogic.mjs,tools/sync-rules.mjs_

### #27 [bugfix] CSP kapisi Windows'ta HIC calismamis: import.meta.url === 'file://'+argv[1] orada her zaman false
**Why:** Windows'ta import.meta.url 'file:///D:/neww/...' iken sablon 'file://D:\neww\...' uretir -- uc bolu vs iki, duz bolu vs ters bolu. Her zaman false, main() hic cagrilmaz, surec 0 doner, npm run verify hicbir sey yapmayan kapiyi GECMIS sayar. Kapi iki surum boyunca kimseyi korumadi. Ipucu: v3.7.6'da eklenen 'check-csp-hash: OK' echo'su gorundu ama aracin KENDI ciktisi hala yoktu -- sessiz kapi ile calismayan kapiyi ayirt eden sey tam olarak buydu. Bulut suite'i Linux'ta kostugu icin her zaman yesildi.
Duzeltme pathToFileURL(argv1).href. Yeni kapi: tools/ altinda 'file://'+argv yazimi yasak VE her kapi alt surec olarak calistirilip konusmaya zorlanir (hicbir sey basmayan bir kapinin basarisi hicbir sey ifade etmez). 4 mutasyonun 4'u yakalandi. DURUST SINIR: Windows davranisi Linux'tan taklit edilemez, pathToFileURL platforma bagli; o ayak deploy.bat'in insan kontrol listesine yazildi.
_`project`: ers · `tags`: esm,giris-noktasi,kapi,pathToFileURL,v3.7.7,windows · `files`: deploy.bat,test_gameLogic.mjs,tools/csp-hash.mjs_


## 2026-09-08

### #28 [decision] v3.9.0: v3.8.0 lobisi TAMAMEN geri alindi; konseyin 'izgarayi tut, sadece deriyi degistir' onerisi kullanici tarafindan reddedildi
**Why:** Konsey 'kod olarak savunulabilir mi' sorusunu cevapladi; kullanicinin sordugu soru 'oyun gibi hissettiriyor mu' idi. Bir lobi izgarasi olcumle savunulabilir ve yine de yanlis olabilir -- estetik yargi konseyin yetki alani DISINDA, ve konsey bunu kendisi soylemedi. Gelecekte gorsel/his kararlarinda konseyin cikti tipi 'oneri' degil 'risk listesi' olmali.
v3.8.0 (GPT-6 Astra) lobiyi yeniden kurdu: public/lobby.css (5KB), gorunur baslik, iki buyuk oynat butonu, duyarli izgara. Konsey (analist/muhalefet/savunma/5 yargic) yapiyi savunulabilir buldu ve YALNIZCA gorsel katmanin degismesini onerdi. Kullanici ikisini de reddetti: 'eski dizayn bile daha iyiydi' + 'bence eski ekranimiz daha iyiydi 3.7 teki falan'. lobby.css silindi (_to_delete_lobby.css.bak), index.html v3.7 markup'ina dondu. v3.8.0'in GERCEK kazanimlari (kisa telefonda ulasilamayan Ayarlar butonu, focus halkalari, reduced-motion, 800ms->320ms gecis) style.css'e tasindi.
_`project`: ers · `tags`: council,lobby,revert,ui · `files`: public/index.html,public/style.css_

### #29 [pattern] Yeni bir DOSYA TIPI projeye girdiginde hicbir kapi onu okumuyorsa, o dosya insaat geregi korumasizdir
**Why:** Bu projenin imza hatasi 'render oluyor ama calismiyor' (#13). CSS onun en sessiz bicimi. Kapi dosya ADINA baglanirsa bir sonraki dosyada yine sifirdan baslanir; KURALA baglanirsa kendini korur.
lobby.css 5KB yeni CSS olarak girdi ve UC olu secici gonderdi: .lobby-edition (index.html'de 0 kez), #main-menu .lobby-suit (0 kez), #main-menu h1 > span:first-child (h1'in span'i yoktu). Yazildi, incelendi, deploy edildi, bir kez bile cizilmedi. CSS'te eslesmeyen bir secici hata FIRLATMAZ, log BASMAZ ve kaynakta sonsuza kadar dogru gorunur. Cozum: tools/check-lobby.mjs artik index.html'in LINKLEDIGI her stylesheet'i okuyor -- dosya adina degil kurala bagli, yani bir sonraki yeni stylesheet gorundugu anda kendini kuruyor.
_`project`: ers · `tags`: coverage,css,gates · `files`: tools/check-lobby.mjs_

### #30 [gotcha] z-index sandvici: #parallax-scene z:1, .screen z:5 -- arasindaki her opak katman SADECE resmi karartabilir
v3.8.0'in body.menu-screen::after kurali z-index 2'de rgba(5,10,19,.94) tam ekran perde koydu ve BES temanin arka planini tek bir mavi-siyaha duzlestirdi. Okunabilirlik perdesi ISTENIYORSA icerik sutununun ICINE konur (#main-menu kendi yiginda, z:5'te), body seviyesine degil. check-lobby kural 2 bunu artik bildirim blogu uzerinden yakaliyor, dosya uzerinden degil -- yani #main-menu icindeki bir perde yasal kaliyor.
_`project`: ers · `tags`: css,theme,z-index · `files`: public/style.css_

### #31 [gotcha] !important RENK kurali satir ici stili yener -- yani zorlanmis gri asla kaza degildir, kasittir
.sleek-sub butonlarinin renkleri index.html'de satir ici veriliyor (Shop altin, Daily mavi, Slap IQ nane, Practice mor). Satir ici bir stili yalnizca !important yenebilir. v3.8.0 hepsini #d8e2ef'e zorladi. Teshis degeri: bir rengin neden gitmedigini ararken, !important gordugunde 'birisi bunu bilerek yapti' diye oku, 'ozgullik kazasi' diye degil.
_`project`: ers · `tags`: css,debugging_

### #32 [gotcha] Bir kapi, yazildigi GERCEK suclu dosyaya karsi tekrar oynatilmadan kanitlanmis sayilmaz
**Why:** #15 ile ayni aile: elle bir kez calistirilip temiz gorunene kadar ayarlanan dedektor, yazarina katilmak uzere ayarlanmistir. Farki: burada dedektor sentetik girdide dogru, sadece gercek girdide yanlisti -- bu yuzden kapinin kabul testi HER ZAMAN suclu dosyanin kendisi olmali.
check-lobby'nin alfa regex'i once /rgba?\([^)]*,\s*(\.?[0-9]+)/ seklindeydi: '\.?' yakalama grubunun DISINDA kaldi, yani '.94' -> '94' okundu, 'alfa degil' diye elendi ve v3.8.0 perdesi KENDI icin yazilmis testten sorunsuz gecti. Sentetik ornekle yesil, gercek dosyayla kor. Mutasyon turu gercek dosyayi tekrar oynattigi icin yakalandi.
_`project`: ers · `tags`: gates,regex,testing · `files`: tools/check-lobby.mjs_

### #33 [constraint] Bu konteyner fonts.googleapis.com'a ULASAMIYOR -- yani buradan alinan hicbir ekran goruntusu tipografiyi dogrulamaz
**Why:** Gorsel dogrulama disiplininin (render et ve BAK) tek bilinen kor noktasi. Bunu bilmeyen bir oturum, gordugu yedek fontu gercek font sanip 'duzeldi' der.
curl https://fonts.googleapis.com -> 000. Konteynerdeki her render Outfit yerine YEDEK fontu cizer. Sonuc: 'yazi tipini gorsel olarak dogruladim' cumlesi bu ortamdan KURULAMAZ; tipografi degisikliklerini yalnizca kullanici canlida gorebilir. v3.9.0'da bu acikca soylendi ve deploy sonrasi kontrol listesine yazildi.
_`project`: ers · `tags`: fonts,limits,verification_

### #34 [bugfix] Tipografi 'duzeltmesi' hayaleti kovaliyordu: 3.7 ile 3.8 arasinda yazi tipi HIC degismemisti, ikisi de Outfit
**Why:** Bir sikayeti duyar duymaz en olasi nedeni degistirmek, once o nedenin GERCEKTEN degismis olup olmadigini dogrulamaktan daha hizli gorunur ama degildir: yanlis degisiklik ikinci bir geri alma turu dogurur. Kural: geri almadan once o seyin gercekten degistigini kanitla.
Kullanici 'karakter tipi hos degil' dedi; ben Philosopher'i goruntu yuzu olarak ekledim. Kullanici 'eski versiyonlarda iyiydi yazi tipimiz 3.7 de falan' deyince kaynagi karsilastirdim: her iki surumde de Outfit yuklu. Degisen font DEGIL, onu kullanan AYAR idi. Philosopher geri alindi.
_`project`: ers · `tags`: fonts,process_

### #35 [pattern] Gorsel is akil yurutmeyle degil, RENDER EDIP BAKARAK dogrulanir -- v3.9.0'da her gorsel kusuru bulan buydu
**Why:** CSS'in cikti alani insan gozune gore tanimli; kaynagi okumak niyeti verir, sonucu vermez. Iki ozel tuzak: (a) overflow-y:auto bir kutunun ICINDEKI perde kutunun disina tasamaz, yani her iki uc da KUTUNUN ICINDE sifira inmeli ve aci duz 90deg olmali -- egik bir gradyanin son duragi uzun kutuyu caprazlama keser ve alt satirlarda dikis birakir; (b) background-size:cover portre bir ekranda yatay bir gorseli YUKSEKLIGE gore olceklendirir, dolayisiyla dikey background-position'in kaydiracak yeri yoktur, kirpma yataydir.
v3.9.0 turunda bulunan gorsel kusurlarin TAMAMI ekran goruntusuyle bulundu, CSS okuyarak degil: sutun kenarlarindaki dikey dikisler (gradyan 0%'da .82), Ayarlar butonunun altbilgiyle cakismasi, kirpilmis altin logo, gomulmus arka plan sanati. Hicbiri kaynaga bakarak gorulebilecek seyler degildi.
_`project`: ers · `tags`: screenshots,ui,verification_

### #36 [gotcha] Cihaza BINARY dosya yazmak sessizce basarisiz olabilir: arac 'written' der, dosya 0 bayt olur
**Why:** Bu projenin imza hata sinifinin ('render oluyor ama calismiyor') teslimat katmanindaki hali: basarili raporlayan ve hicbir sey yapmayan bir cagri. Arac ciktisina degil, HEDEFTEKI dosyaya bakarak dogrula -- ve boyuta degil icerige bak.
memory.db (122880 bayt) cihaza gonderildi; arac {written:[...], rejected:[]} dondu. Cihazdaki 'ls -l' 122880 gosterdi ama dosyanin ICERIGI bostu: md5 d41d8cd9... (bos dize hash'i), sqlite 'disk I/O error', kopyalanan dosya 0 bayt. Ayni cagri BIR KEZ daha yapildiginda dogru yazdi (md5 eslesti, 34 kayit okundu). Ayni commit'teki UC metin dosyasi ilk seferde kusursuz gitti. Korunma: (a) her binary commit'ten sonra cihazda md5 al ve kaynakla KARSILASTIR -- 'ls -l' yalan soyluyor, boyutu dizin girdisinden okuyor; (b) arsivin yaninda .jsonl metin ihracati tut (memory_store.py export --format jsonl / import), metin yolu bu hatayi hic gostermedi.
_`project`: ers · `tags`: delivery,tooling,verification_

### #37 [pattern] check-lobby'nin TERSI: markup'ta adi gecen ama hicbir stylesheet'te kurali olmayan sinif -- ve pahali yon buymus
**Why:** Bir kapi ne kadar iyi olursa olsun yalnizca BAKTIGI yonu korur. check-lobby 'CSS var, markup yok'u kapatti ve ayni gun 'markup var, CSS yok' acik kaldi. Bir korumanin tersini yazmadan is bitmis sayilmaz.
v3.8.0 hesap panelinin giris yapilmis gorunumunu HIC stylesheet kurali olmadan gonderdi: yedi sinif index.html'de adlandi, hicbir yerde tanimlanmadi. Tarayici denileni cizdi -- ciplak metin. Amblem 12px karakter, her istatistik etiketini degerine yapistiriyor ('Skor1'), kazanma orani alttaki kartin altinda kaliyor. v3.8.0 ve v3.9.0 boyunca gitti. HICBIR kapi goremezdi: birim testler mantik okur layout degil; check-locales bu etiketlerin dort dilde de dogru cevrildigini kanitladi -- OKUNAMAYAN bir panelde; check-lobby stil sayfalarinda olu secici arar, yani hic stil sayfasinda OLMAYAN bir sinifi insaat geregi goremez. Cozum tools/check-orphan-classes.mjs, kapi 8/9. Iki mesru istisna, ikisi de KAYNAKTAN cikariliyor (elle izin listesi yok): (a) sinifi tasiyan her element satir ici stilliyse -- .spinner, .boot-error-tech bilerek oyle, boot hata ekrani stylesheet yuklenmeden cizilmek ZORUNDA; (b) bir modul onu querySelector ile ariyorsa -- .ers-error-retry gibi, o sinifin isi stil degil erisim.
_`project`: ers · `tags`: coverage,css,gates · `files`: tools/check-orphan-classes.mjs_

### #38 [gotcha] Esdeger mutant tuzagi: bir sinifin TEK kural blogunu silmek onu tanimsiz birakmaz
**Why:** DECISIONS #20 ile ayni aile. Hayatta kalan mutant iki sey demek olabilir: kapi kor, ya da mutasyon kusuru yaratmadi. Ikisini ayirmadan 'kapi zayif' demek de 'kapi saglam' demek de yanlis.
check-orphan-classes'in mutasyon turunda M2 (.profile-stat blogunu sil) ve M7 (.profile-emblem blogunu sil) HAYATTA KALDI. Kapi haksiz degildi: .profile-stat span, .profile-stat strong ve @media icindeki kural hala sinifi ANIYOR, yani sinif hala tanimli. Mutasyon hedefledigi kusuru yaratmamisti. M2'/M7' ile degistirildi: seciciyi anan HER kural silindi -- ikisi de yakalandi. Ayrica M9 eklendi: sinifi yalnizca bir CSS YORUMUNDA birak, kapi yine yakalamali (stripCss'in isi).
_`project`: ers · `tags`: mutation,testing · `files`: tools/check-orphan-classes.mjs_

### #39 [gotcha] Tasan bir flex SUTUNUNDA justify-content: center icerigi IKI uctan disari iter ve ust uc geri kaydirilamaz
**Why:** Ortalamak tasmayi 'gizlemez', ERISILEMEZ yapar -- ve overflow:auto bunu duzeltmez cunku kaybolan taraf negatif tarafta. Kisa ekranda hicbir sey ortalanmamali.
#account-panel hem .scrollable-screen hem de justify-content: center idi (id secici class'i yener). Icerik viewport'tan uzun oldugunda ortalama tasmayi ustten de disari itiyor ve scrollTop ZATEN 0 oldugu icin oraya kaydirmak mumkun degil. Olculdu: panelin kendi <h2> basligi 1920x914'te top:-21, 390x844'te top:-138 -- yani telefonda baslik dahil 138px erisilemez. Cozum iki bildirim: once justify-content: flex-start (anlamayan tarayicilar burada kalir, guvenli yon), sonra justify-content: safe center (anlayan tarayici sigdiginda ortalar, tastiginda flex-start gibi davranir). Projedeki sekiz .scrollable-screen icinde ortalayan TEK panel buydu.
_`project`: ers · `tags`: css,flexbox,scroll · `files`: public/style.css_

### #40 [gotcha] flex-shrink'i engelleyen sey min-height'tir: 4 piksellik tasma kalici bir kaydirma cubugu satin aliyordu
**Why:** Bir kutunun kucule bilmesini min-height engeller, height engellemez. Esnek bir yerlesimde 'en az su kadar olsun' niyeti min-height ile yazilirsa niyet degil KISIT olur.
v3.9.0 kisa telefonlarda Ayarlar butonu erisilebilsin diye #main-menu'ye overflow-y:auto ekledi -- dogru bir duzeltme. Ama .lobby-spacer-top'un min-height'i sutunu kucultulemez yapiyordu, yani 1920x914'te icerik 918px'e ciktu: dort piksel fazla, ve karsiliginda arka plan gorselinin ortasindan gecen kalici bir kaydirma cubugu. (1440x900'de 9px, 1366x768'de 58px, 390x844'te 43px.) Floor min-height'tan HEIGHT'a tasindi ve min-height 0 yapildi: bosluk varken hala BUYUYOR (wordmark'in altini acik tutuyor), yokken kaydirma cubugu satin almak yerine yerini veriyor. Bes kuralin BESI DE yerinde duzeltildi -- 600 satir asagidan ezmek, orijinal kurallarin hepsini yanlis birakirdi.
_`project`: ers · `tags`: css,flexbox,layout · `files`: public/style.css_

### #41 [reference] Reklami acmak icin gereken tek sey iki alan: adsConfig.js'te PUBLISHER_ID ve AD_SLOTS
**Why:** Auto ads AdSense PANELINDEN kapali tutulmali. Acikken Google birimi istedigi yere -- mac sirasinda destenin uzerine bile -- koyabilir ve adsConfig.js'teki her koruma tek bir panel ayariyla iptal olur. Bu KOD ayari degil, PANEL ayari; koddan engellenemez. Olculdu: saplak sirasindaki 50ms jank puanlama fonksiyonunda 72 puan eder, cok oyunculuda ise fairSlap.js iki oyuncunun tepki suresini karsilastirdigi icin jank puan degil PASTAYI alir.
Iskele v3.10.0 itibariyle EKSIKSIZ duruyor: ads.js (130 satir), adsConfig.js, yedi ekranda <div class='ad-slot'>, ve index.html'de <meta name='google-adsense-account' content='ca-pub-...'>. PUBLISHER_ID = '' oldugu surece ads.js HICBIR sey yuklemiyor: script etiketi yok, istek yok, cerez yok -- yani yapilandirilmamis bir build calisma zamaninda bayt bayt reklamsiz. Acmak icin PUBLISHER_ID'yi meta etiketindeki ayni kimlige esitle ve AD_SLOTS'taki yedi slot id'sini doldur. Korumalar: on ekran kalici red listesinde (game-container, daily-panel, victory-screen, tutorial-screen, lobby-panel, waiting-room-panel, settings-panel, confirm-modal, privacy-panel, invite-modal), mac sirasinda slot doldurulmuyor, her slot sayfa basina BIR KEZ doluyor.
_`project`: ers · `tags`: ads,adsense,config · `files`: public/js/ads.js,public/js/adsConfig.js_

### #42 [gotcha] Bir kaydirma konteynerinde position:absolute bir eleman, tasan akistan KOPAR: icerik sonundaki dolgu onu ayiramaz
**Why:** Kirilma noktasini tasmanin gercekten basladigi yerin (~677px icerik) USTUNDE secmek zorunlu: altinda secilirse iki kural bazi yuksekliklerde celisir ve hata yalnizca o dar aralikta gorunur. Ayrica dersin genel bicimi: 'X ile Y arasina bosluk koydum' cumlesi ancak X ve Y AYNI yerlesim akisindaysa dogrudur.
v3.10.0 #main-menu'ye 44px alt dolgu koydu ki son buton sirasi #game-version'a degmesin. 1920x914 ve 1366x768'te tuttu (canlida olculdu: 37px acik; tarayicinin elementFromPoint'i Ayarlar butonunun merkezinde btn-settings dondurdu). ~660px'in altinda tutmadi. Sebep derece degil YAPI: #game-version position:absolute + bottom:10px, yani konteynerin DOLGU KUTUSUNA sabitli -- sabit yukseklikte bir kutu. Butonlar normal akista ve icerik o kutuyu asinca tasma alanina gecip devam ediyor. Icerigin sonuna eklenen dolgu, ikisinden yalnizca biri icerikte olan iki seyi ayiramaz. Olculdu 1366x640: Ayarlar 574-615, altbilgi 613-630 (2px), 1366x560'ta 40px. Cozum: menunun gercekten kaydigi yuksekliklerde (@media max-height:760px) altbilgi position:static olup AKISA katiliyor; son butonun ve kendi marjinin ardina dusuyor. Dokuz yukseklikte olculdu: 914/768/844 degismedi, 700/660/640/600/560/390x667'de aciklik sabit 38px.
_`project`: ers · `tags`: css,layout,scroll · `files`: public/style.css_

### #43 [decision] v3.11.0: Saplayarak Geri Donme uygulandi -- DORT kilit vardi, ucu #17'de kayitliydi, dorduncusu YIGIN KILIDI
**Why:** #17 bu ozelligi urun kararina havale etmisti ve kullanici SADECE bitis kuralini belirledi (bkz #18), ozelligin kendisini reddetmedi. Kural sayfasi dort dilde vaat ediyor, uc modul dinleyici tasiyor, zafer ekrani istatistik gosteriyor: kaldirmak degil uygulamak dogru cevapti. Ders: bir ozelligin 'olu' oldugunu tespit ederken kilitleri SAYMAK gerekir -- bir tanesini duzeltip is bitti sanmak, gorunmez bir dorduncu kilidin arkasinda calismayan bir ozellik gondermektir.
resurrected olayinin 2 dinleyicisi 0 yayicisi vardi. Kilitler: (1) game.js checkGameOver insan kartsiz kalinca offline maci aninda bitiriyordu; (2) game.js slap() elenmis koltugu reddediyordu; (3) firebaseSync _settleContest elenmis koltugun KAZANAN saplagini cope atiyordu (if (!p || p.eliminated) return false) -- yani refleks yarisini kazansa bile; (4) YENI BULGU: victoryScreen izleyici kilidi pile.style.pointerEvents='none' yapiyordu ve saplak #center-pile uzerine pointerdown, yani motor tamamen calissa bile parmakla ulasilamiyordu. Cozum slapOutcome.js'te TEK satir: players[winnerId].eliminated = false -- alti satir asagidaki 'eli bos kalan elenir' kuralinin tam tersi, ve paylasilan modul oldugu icin iki modu birden duzeltiyor. Oda lastResurrectedId ile damgalaniyor; her istemci dirilmeyi olayin kendisinden ogreniyor, bayrak farkindan tahmin ederek degil. DESTE kilitli kaliyor (eli bos koltugun oynayacak karti yok, sirasini getNextPlayer atliyor); acilan sey YIGIN.
_`project`: ers · `tags`: ERS-09,gate,product,resurrection · `files`: public/js/firebaseSync.js,public/js/game.js,public/js/slapOutcome.js,public/js/victoryScreen.js_

### #44 [constraint] v3.7.4 kullanici kurali v3.11.0'da KORUNDU: countLiveHumans ve resolveEndOfMatch'e dokunulmadi
**Why:** Bir ozelligi uygularken onun yolundaki bir KULLANICI KARARINI kaldirmak, teknik bir sadelestirme gibi gorunur ama urun kararini geri almaktir. Arsivdeki #17/#18 kayitlari olmasa bu tur sessizce yapilirdi; kaydin degeri tam olarak buydu.
Saplayarak donme eklenirken en buyuk cazibe countLiveHumans'tan !p.eliminated'i kaldirmakti -- boylece elenmis insan da 'canli' sayilir ve her durumda geri donebilirdi. Bu, #18'de kayitli kullanici kararini (canli insan 0 olunca mac biter, elenme kalicilasir) sessizce iptal ederdi. Yapilmadi. Saplayarak donme yalnizca o kuralin KAPSAMADIGI durumu buluyor: masada baska bir insan hala oyundayken. Olculdu -- tek insan elenince countLiveHumans 0, mac biter, winnerId -1; iki insandan biri elenince countLiveHumans 1, mac surer, donus mumkun. Kurali kasitli bozan mutasyon 13 testi kirdi.
_`project`: ers · `tags`: cok-oyunculu,kural,v3.7.4 · `files`: public/js/slapOutcome.js_

### #45 [pattern] Kapilarin ucuncu yonu: 'soz verdigin sey oluyor mu' -- .on() olan her olayin .emit()'i olmali
**Why:** check-lobby 'CSS var markup yok'u, check-orphan-classes 'markup var CSS yok'u kapatti. Ikisi de KODUN kendi ic tutarliligi. Ucuncu yon koddan disari bakar: kullaniciya verilen soz. Bir projede ilk ikisi mukemmel olabilir ve ucuncusu tamamen acik kalabilir -- ERS'te tam olarak bu oldu.
Dokuz kapi vardi ve dokuzu da ya kaynak metnine ya yerlesime bakiyordu. Hicbiri oyuncunun umursadigi soruyu sormuyordu. Bedeli: check-locales, var olmayan bir ozelligi anlatan dort metnin dort dilde DOGRU cevrildigini onayladi. Kural: .on(...) ile beklenen her olay en az bir .emit(...) bulmali. Tersi (dinleyicisiz olay) yalnizca bildirilir, kapiyi dusurmez -- asimetri bilincli: dinleyicisiz olay gelecege birakilmis bir kanca, gondericisiz dinleyici oyuncuya GOSTERILMIS bir sozdur. Hesaplanan olay adi (emit(`x-${y}`)) kapiyi dusurur cunku kurali yanlis degil KANITLANAMAZ yapar. 7 mutasyon: iki gondericiyi birden sil (yakalandi), birini sil (yanlis alarm YOK), yeni oksuz dinleyici (yakalandi), duyulmayan yayici (gecti), hesaplanan ad (yakalandi), fazladan .off() (gecti -- .off dinleyici sayilmaz, yoksa abonelikten cikarak kural saglanirdi).
_`project`: ers · `tags`: gates,promises · `files`: tools/check-promises.mjs_

### #46 [constraint] Cok oyunculu ISTEMCI YETKILI: RTDB gameRooms odadaki her oyuncuya odanin TAMAMINI yazdiriyor, ve functions/ hic deploy edilmemis
**Why:** ASIMETRI ONEMLI: firestore.rules bu sinifta bir zayifligi 12 satirlik bir blokla ACIKCA ilan ediyor ('iyi bicimlendirilmis bir yalan her kurali gecer', 'bu tabloyu hicbir yerde dogrulanmis diye anlatma') ve VERIFIED_BOARD false ile kullaniciya soyluyor. database.rules.json'da esdegeri YOK, Hakkinda sayfasinin 'Adil' paragrafinda da yok. Yani proje bir zayifligi belgeleyip otekini belgelememis -- eksik olan koruma degil, BEYAN. Bu kayit iki konsey turunda bulundu ve iki turda da dosyalanmadi; arsivin en buyuk kapsam bosluguydu.
Olculdu (v3.11.0 agaci): database.rules.json'da gameRooms/$roomId icin .write = auth != null && data.child('playerIds').child(auth.uid).exists(). Yani odadaki herhangi bir oyuncu odanin HERHANGI bir alanini yazabilir: kendi eli, rakibin eli, winnerId, gameOver. Dosyanin tamaminda TEK bir .validate var, o da lobbyRooms/players icin hasChildren(). USE_SERVER_VALIDATION false ve FairSlap.resolveContest firebaseSync.js:599'da, yani TARAYICIDA calisiyor -- 3000 yarislik ozellik testiyle kanitlanmis hakemlik, hile yapan bir istemcinin varliginda tavsiye niteliginde. Ayrica firebase.json'in anahtarlari yalnizca hosting/database/firestore: functions ANAHTARI YOK, yani functions/ altindaki 836 satir (attemptSlap ve attemptPlayCard onCall olarak yazilmis) hic deploy edilmemis ve cagrilamaz. sync-rules kapisi (2/10) calismayan kodun tutarliligini garanti ediyor. Sinirlayici etkenler: cok oyunculu giris gerektiriyor ve 6 karakterlik masa koduyla korunuyor; liderlik tablosu Gunluk Meydan Okuma'ya bagli, cok oyunculuya degil, yani ciftlenecek bir siralama yok.
_`project`: ers · `tags`: cok-oyunculu,functions,guvenlik,konsey,rtdb · `files`: database.rules.json,firebase.json,functions/index.js,public/js/firebaseSync.js_

### #47 [gotcha] memory_store'da update/edit/unsupersede YOK: tek duzeltme yolu supersede, ve supersede GIZLER
**Why:** Bir arsivin duzeltme yolu yoksa, her duzeltme ya bir kaybetme (supersede ile gizleme) ya da bir delme (elle yazma) olur. Kurali onceden yazmak, o anin baskisinda yanlis olani secmeyi engeller.
Olculdu: alt komutlar init/add/search/timeline/get/digest/stats/export/import/forget. 'superseded' bir tamsayi sutunu ve 287. satir varsayilan aramadan dusuruyor -- olculdu: #11 supersede'liyken search 'USE_SERVER_VALIDATION' SIFIR sonuc donduruyordu, geri alindiktan sonra bulunuyor. Cikan kural: eski kayit YANLIS ise supersede dogru (gizlensin); eski kayit HALA DOGRU ise supersede yanlis; eski kayit dogru ama BAYAT/EKSIK ise ikisi de yanlis, dogru olan eski kaydi adiyla anan EK bir kayittir -- gizlemek yerine baglamak. TEK SEFERLIK istisna: #11'in yanlis supersede'i aletin disinda, dogrudan SQL ile (superseded=19 -> 0) geri alindi; oncesinde db+jsonl+md yedegi alindi, sonrasinda toplam/aktif sayimi ve FTS aramasi dogrulandi. Bu emsal degildir: aletin yazma yolu varken elle yazmak alisknalik olursa arsivin tek girisi delinir.
_`project`: ers · `tags`: alet,arsiv,memoryskill_

### #48 [pattern] #13'u gunceller: 'render oluyor ama calismiyor' sayisi alti degil, en az on iki -- ve sinif bir OZELLIGE kadar buyudu
**Why:** #13 supersede EDILMEDI cunku yanlis degil, eksik: dersi hala gecerli, yalnizca sayisi bayat. Supersede etmek onu varsayilan aramadan dusururdu ve projenin imza hata sinifini anlatan kayit gorunmez olurdu (bkz #47). Sayi tasiyan her kayit sessizce bayatlar; tarihi olmayan bir sayi bugunku sayi sanilir.
#13 gunu itibariyle dogruydu ve alti tekrar sayiyordu. v3.11.0 agacinda sayim en az on iki: window.UI, pointer-events:none icindeki gizlilik baglantisi, politika taslaklari, opacity:0 davet modali, ust uste binen .btn-small, display:none bir .screen icindeki #notifications, window.AuthSystem, CSP'nin blokladigi boot net, olu onclick, Windows'ta olu csp-hash kapisi, lobby.css'te uc olu CSS secici, hesap panelinde stilsiz yedi sinif. VE sinifin en buyuk ornegi bir sinif ya da eleman degil, bir OZELLIK oldu: 'Saplayarak Geri Donme' dort dilde vaat ediliyordu, uc modulde dinleyicisi vardi, zafer ekraninda istatistigi vardi ve DORT ayri kilit yuzunden hic gerceklesemiyordu (bkz #43). #13'un dersi degismedi, olcegi degisti.
_`project`: ers · `tags`: arsiv,duzeltme · `files`: DECISIONS.md_

### #49 [constraint] #33'u daraltir: konteyner Google Fonts'a hala ulasamiyor, AMA tipografi kullanicinin tarayicisiyla dogrulanabilir
**Why:** #33 supersede EDILMEDI cunku olgusal cekirdegi hala dogru ve gelecekte bir oturumun 'benim render'im Outfit gostermiyor, panik yok' diyebilmesi icin bulunabilir kalmali. Duzeltilen sey olgu degil, ondan cikarilan imkansizlik iddiasi: bir kisitin KAPSAMI, kisitin kendisinden daha hizli bayatlar.
Yeniden olculdu: curl fonts.googleapis.com -> 000, yani #33'un olgusal kismi hala DOGRU ve bu konteynerden alinan her ekran goruntusu yedek fontu cizer. Ama #33'un cikarimi ('tipografi dogrulanamaz') fazla genisti: v3.10.0/v3.10.1 turunda tipografi Claude_Browser uzerinden KULLANICININ tarayicisinda dogrulandi -- canli siteye gidildi, Outfit yuklendi ve oyuncu kartinin dizgisi goruldu. Dogru ifade: bu konteynerde render edilen hicbir goruntu tipografiyi dogrulamaz; kullanicinin cihazindaki tarayici uzerinden dogrulanabilir ve bir kez dogrulandi.
_`project`: ers · `tags`: dogrulama,sinir,tipografi_

### #50 [gotcha] #22'yi duzeltir: teshis dogru ama DUZELTME HIC UYGULANMAMIS -- canli betikte isatty kosulu duruyor
**Why:** #22 supersede EDILMEDI cunku teshisi ('isatty, veri tasiyan bir pipe ile etkilesimsiz stdin'i ayiramaz') hala dogru ve degerli; yanlis olan yalnizca uygulandi iddiasi ve dosya yolu. Daha genel ders: bir kaydin 'duzeltildi' cumlesi, duzeltmenin YASADIGI YER kaydin sahip oldugu agacin disindaysa dogrulanabilir degildir -- salt-okunur bir onbellege yapilan duzeltme, kayit dogru yazilsa bile bir sonraki senkronda kaybolur.
Arsiv denetiminde yeniden oynatildi. #22 'Duzeltme: stdin yalnizca acikca --body - verildiginde okunur' diyor. Canli betigin 210. satiri: if args.body == '-' or (not body and not sys.stdin.isatty()). Yani kaldirildigi soylenen isatty kosulu YERINDE. Hata gizli kaldi cunku her cagriya --body geciliyor; gecmeyen bir oturum ciktisiz asili kalir. Ikinci hata: #22'nin files alani tools/memory_store.py diyor, boyle bir dosya bu depoda YOK -- betik /root/.claude/skills/synced/<id>/memoryskill/scripts/ altinda, yani beceri senkronunun SALT-OKUNUR onbelleginde. Duzeltme orada kalici olarak yapilamaz: bir sonraki senkron ezer. PRATIK KURAL: memory_store.py add cagrilarina HER ZAMAN --body ver.
_`project`: ers · `tags`: arac,arsiv-denetimi,memory-store,stdin_

### #51 [gotcha] #22 DOGRUYMUS: duzeltme tools/memory_store.py'de VAR -- ama oturum boyunca CALISTIRILAN kopya beceri onbellegindeki DUZELTILMEMIS olan
**Why:** Bir arsiv denetiminde, bir kaydin YANLIS oldugunu ilan etmeden once kaydin ISARET ETTIGI dosyaya bakmak gerekir -- ben baska bir kopyaya bakip #22'yi haksiz yere yanlis ilan ettim (#50). Bu, #32'nin ('bir kapi gercek suclu dosyaya karsi oynatilmadan kanitlanmis sayilmaz') denetim katmanindaki tekrari: bir KAYDI da gercek dosyasina karsi oynatmadan curutemezsin. Genel ders: ayni aracin iki kopyasi varsa, dogru soru 'duzeltme yapilmis mi' degil, 'CALISTIRILAN kopyada yapilmis mi'.
#50 yanlisti ve supersede edildi: yanlis kopyaya baktim. Iki kopya var ve ayni degiller (md5 farkli). DEPO kopyasi tools/memory_store.py: satir 219 'if args.body == "-":' -- duzeltme uygulanmis, ustunde 212-213. satirlarda kaldirilan isatty kosulunun aciklamasi duruyor. Yani #22 hem iddiasinda hem files alaninda DOGRU. BECERI ONBELLEGI kopyasi /root/.claude/skills/synced/<id>/memoryskill/scripts/memory_store.py: satir 210 hala 'if args.body == "-" or (not body and not sys.stdin.isatty())' -- duzeltilmemis. Bu oturumda calistirilan kopya bu ikincisiydi. Sonuc: hata gizli ama CANLI, cunku ajan onbellek kopyasini calistiriyor; --body atlanirsa yine asili kalir. Pratik kural degismedi: her add cagrisina --body ver.
_`project`: ers · `tags`: arac,arsiv-denetimi,memory-store,stdin · `files`: tools/memory_store.py_
