@echo off
REM ===================================================================
REM  ERS v3.6.0 - Firebase Hosting deploy
REM
REM  Cift tikla ya da bu klasorde calistir:  deploy.bat
REM
REM  SADECE HOSTING deploy eder. Firestore ve Realtime Database
REM  kurallari bilerek disarida birakildi -- onlar canlidaki veri
REM  erisimini degistirir ve ayri, bilincli bir komutla gitmeli
REM  (asagida aciklandi, ayrica DEPLOY.md).
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo === 1/10  Birim testleri ===
call node test_gameLogic.mjs
if errorlevel 1 (
    echo.
    echo TESTLER BASARISIZ. Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 2/10  Sunucu kural kopyasi senkron mu ===
call node tools\sync-rules.mjs
if errorlevel 1 (
    echo Kural senkronu basarisiz. Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 3/10  Skor sinirlari firestore.rules ile ayni mi ===
call node tools\check-score-bounds.mjs
if errorlevel 1 (
    echo Skor sinirlari ayristi. Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 4/10  Dort dilde de metin eksik mi ===
call node tools\check-locales.mjs
if errorlevel 1 (
    echo Ceviri anahtari eksik ya da cift tanimli. Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 5/10  Hata ekrani yapisal kontrolu ===
REM  #error-modal .screen ya da .modal-overlay sinifini ALMAMALI.
REM  .modal-overlay tek basina display ve position vermiyor (onlar .screen'den
REM  geliyor), .screen ise dort ayri dosyada toplu temizleniyor. Ikisi de hata
REM  ekranini gorunmez ya da kendi kendini kapatan bir sey haline getirir ve
REM  bunu 1143 birim testin hicbiri goremez.
call node tools\check-error-modal.mjs
if errorlevel 1 (
    echo Hata ekrani yapisi bozulmus. Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 6/10  Satir ici script CSP tarafindan calistirilabiliyor mu ===
REM  v3.7.0-v3.7.4 arasi head etiketindeki boot safety net HER yuklemede
REM  tarafindan bloke edildi: "Uygulama baslatilamadi" ekrani tam da
REM  gerektigi anda yoktu. Cozum hash, ama hash script'in TAM BAYTLARI
REM  uzerinden alinir -- elle kopyalanan bir hash sessizce bayatlar ve
REM  bunu yalnizca canlida ogrenirsin. Bu yuzden uretiliyor ve burada
REM  denetleniyor. Bayatsa: node tools\csp-hash.mjs --write
call node tools\csp-hash.mjs
if errorlevel 1 (
    echo CSP hash'i bayat. Hata ekrani canlida ACILAMAZ. Deploy iptal edildi.
    pause
    exit /b 1
)
REM  Kapinin kendi ciktisi kaybolursa operator bunu goremez. Bu satir
REM  deploy.bat'in KENDI onayi: gorunmuyorsa kapi calismamis demektir.
echo check-csp-hash: OK

echo.
echo === 7/10  Lobi stili yasayan seyleri mi bicimlendiriyor ===
REM  v3.8.0'da lobby.css projeye SIFIR kapsamla girdi ve hicbir seyle
REM  eslesmeyen uc kural tasidi: .lobby-edition, .lobby-suit ve
REM  h1 icindeki span. Bir "edition" satiri, dev maca simgesi ve
REM  baslik yazildi, incelendi, deploy edildi ve bir kez bile cizilmedi.
REM  CSS'te bu hata JS'tekinden beter: eslesmeyen secici hata vermez,
REM  log basmaz, kaynakta sonsuza kadar dogru gorunur.
call node tools\check-lobby.mjs
if errorlevel 1 (
    echo Lobi stili bozuk: olu secici, gorseli gomen perde ya da zorla gri.
    echo Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 8/10  Markup, var olmayan bir sinifi mi cagiriyor ===
REM  check-lobby'nin TERSI. O, hicbir seyle eslesmeyen CSS'i yakalar.
REM  Bu, hicbir CSS'i olmayan markup'i yakalar -- ve pahali olan buymus.
REM  v3.8.0 hesap paneline bir "oyuncu karti" ekledi ve markup'i HIC
REM  STYLESHEET KURALI OLMADAN gonderdi: yedi sinif index.html'de adlandi,
REM  hicbir yerde tanimlanmadi. Tarayici denileni cizdi -- ciplak metin.
REM  Amblem 12px bir karakterdi, her istatistik etiketini degerine
REM  yapistiriyordu ("Skor1"), kazanma orani alttaki kartin altinda kaldi.
REM  v3.8.0 ve v3.9.0 boyunca gitti; ekrana bakan bir kullanici buldu.
REM  Birim testler mantik okur, layout degil. check-locales bu etiketlerin
REM  DORT DILDE de dogru cevrildigini kanitladi -- okunamayan bir panelde.
call node tools\check-orphan-classes.mjs
if errorlevel 1 (
    echo Markup'ta stilsiz sinif var: yazildi, hicbir zaman cizilmedi.
    echo Deploy iptal edildi.
    pause
    exit /b 1
)
REM  Bir kapinin sessizce HIC calismamasi, kirmizi vermesinden beterdir --
REM  CSP kapisi Windows'ta tam bunu yapti, iki surum boyunca (DECISIONS #27).
REM  Bu kapinin kendi ciktisi ("check-orphan-classes: OK" ve ondan onceki
REM  "N classes in markup" satiri) YUKARIDA GORUNMUYORSA kapi calismamistir;
REM  errorlevel 0 gormek yeterli DEGILDIR.

echo.
echo === 9/10  Vaat edilen olay gercekten gonderiliyor mu ===
REM  Dokuz kapinin dokuzu da ya kaynak metnine ya yerlesime bakiyordu.
REM  Hicbiri oyuncunun umursadigi soruyu sormuyordu: SOZ VERDIGIN SEY
REM  OLUYOR MU? Bunun bedeli 'resurrected' oldu. Kural sayfasi dort
REM  dilde "0 kartla da saplak atabilirsin, basarili bir saplak seni
REM  yigini alarak oyuna dondurur" diyordu. Etrafina ui.js'te bildirim,
REM  victoryScreen.js'te ekran kaldirma, multiplayerMode.js'te sayac,
REM  zafer ekraninda "Dirilme Sayisi" istatistigi ve mvpComeback rozeti
REM  yazilmisti -- ve olayi HICBIR YER gondermiyordu. Dort ayri kilit
REM  vardi. Butun kapilar bu sure boyunca yesildi; check-locales daha da
REM  ileri gidip o dort metnin dort dilde DOGRU cevrildigini onayladi.
REM  Kural: .on(...) ile beklenen her olay en az bir yerde .emit(...)
REM  edilmeli. Tersi (dinleyicisi olmayan olay) yalnizca BILDIRILIR,
REM  kapiyi dusurmez: dinleyicisiz bir olay gelecek bir ozellige birakilmis
REM  bir kanca, gondericisi olmayan bir dinleyici ise oyuncuya gosterilmis
REM  bir soz. 7 mutasyon, 7'si de dogru davrandi.
call node tools\check-promises.mjs
if errorlevel 1 (
    echo Dinleyicisi olan ama hic gonderilmeyen bir olay var.
    echo Deploy iptal edildi.
    pause
    exit /b 1
)

echo.
echo === 10/10  Firebase Hosting deploy ===
REM  SURUM SABIT, --non-interactive ZORUNLU.
REM
REM  "@latest" her calistirmada npm registry'ye gidip surumu yeniden cozuyordu.
REM  Yeni bir firebase-tools yayinlandiginda npx ~40 MB indiriyor ve bunu bir
REM  .bat penceresinde HIC ILERLEME GOSTERMEDEN yapiyor -- ekranda donmus gibi
REM  duruyor. 29 Agustos 2026'da tam olarak bu oldu: 4 adim gecti, 5. adim
REM  bekledi, deploy hic calismadi.
REM
REM  --non-interactive: CLI bir soru sorarsa (yeniden giris, surum uyarisi)
REM  sonsuza kadar beklemek yerine HATA verip cikar. Bekleyen bir soru,
REM  gorunmeyen bir sorudur.
echo Ilk calistirmada firebase-tools indirilebilir (~40 MB). Birkac dakika
echo surebilir ve ekranda ciktisiz bekleyebilir -- bu normal.
echo.
call npx --yes firebase-tools@15.28.2 deploy --only hosting --project ers-card-game --non-interactive
if errorlevel 1 (
    echo.
    echo DEPLOY BASARISIZ.
    echo Giris yapmadiysaniz once sunu calistirin:  npx firebase-tools login
    pause
    exit /b 1
)

echo.
echo Bitti.  https://ers-card-game.web.app
echo.
echo Firestore kurallari BU SURUMDE DEGISMEDI (sikilastirilmis hali v3.1.1'de
echo gonderildi). Yeniden gondermeniz gerekmiyor. Kurallara dokunursaniz
echo ayri komut:  deploy-rules.bat
echo.
echo v3.7.0 -- Hata ekrani ve sebep bildirimi (konsey ERS-08):
echo   1) Basarisiz bir islem artik NE oldugunu ve NEDEN oldugunu ayri ayri
echo      soyluyor: "Odaya katilinamadi" + "Bu koda sahip bir masa yok" ya da
echo      "Internet baglantin koptu". Onceden alti farkli sebep tek bir
echo      sabit cumleye cokuyordu ve altida besi yanlis bilgiydi.
echo   2) Bildirim kutusu (#notifications) artik body seviyesinde. Onceden
echo      #game-container icindeydi, yani lobiden/menuden yukseltilen HER
echo      mesaj display:none bir alt agaca yaziliyordu. "Baslat" butonunun
echo      olu gorunmesinin sebebi buydu.
echo   3) Ag cagrilarinda artik zaman asimi var. Firestore tasima hatasinda
echo      reddetmiyor, kuyruga aliyor -- yani spinner sonsuza kadar
echo      donebiliyordu. 10 sn cagri siniri + 15 sn spinner gozcusu.
echo   4) Mac sirasinda modal ACILMAZ. Bunun yerine bloklamayan bir baglanti
echo      bandi cikiyor ve baglanti donunce kendini temizliyor.
echo   5) Modul grafigi hic yuklenmezse ^<head^> icindeki satir ici ag iki
echo      dilde "Uygulama baslatilamadi" ekrani gosteriyor.
echo.
echo v3.7.1 -- Yanma Kalkani sayaci:
echo   6) Kalkanin IKI ayri 30 saniyelik saati vardi ve sadece biri
echo      yenileniyordu. Yenileyen saplak streak'i 3'te tuttugu icin
echo      'shieldEarned' olayi tetiklenmiyor, destedeki sayac sifira
echo      inip kayboluyor, kalkan ise 30 saniye daha korumaya devam
echo      ediyordu. Artik sayaci ve gercek sureyi AYNI kosul basliyor.
echo   7) Almanca ve Rusca kural metinleri kalkanin 30 saniyelik
echo      oldugundan hic bahsetmiyordu -- eklendi.
echo.
echo v3.7.2 -- Kalkan incelemesinden cikanlar:
echo   8) expireDbShield bot kalkanini silmek icin `window.AuthSystem` okuyordu
echo      -- bu degisken uygulamada HICBIR YERDE atanmiyor. Yani kontrol
echo      kalici olarak false'ti ve cok oyunculuda 3 saplak yakalayan bir
echo      BOT kalkanini mac boyunca kaybetmiyordu. Artik gercek import.
echo   9) Zamanlayici tetiklendiginde yuvasi bosaltilmiyordu; bir kez
echo      basarisiz olan sure asla yeniden kurulamiyordu.
echo  10) Sayac ile gercek sure ayni kosula bagliydi: yetkin olmadigin bir
echo      koltuk (rakip ya da host degilken bot) hicbirini almiyor, kalkan
echo      yine rakamsiz ikon olarak ciziliyordu. Ikisi ayrildi.
echo.
echo v3.7.3 -- Konsey ERS-09 (UI + veritabani kaynakli tarama):
echo  11) localization.js'te 39 anahtar CIFT tanimliydi; 20'si farkli bir
echo      metni sessizce eziyordu. En kotusu: botReplacedMsg. ui.js
echo      {old}/{new} yerlestiriyor ama kazanan tanimda placeholder yoktu --
echo      oyuncu OZNESIZ bir cumle goruyordu, dort dilde birden.
echo  12) check-locales'in kendi cift-anahtar dedektoru bunu goremiyordu:
echo      tam 8 bosluk girintili satirlari ariyordu, uzun tek satira
echo      paketlenmis anahtarlar gorunmezdi. Kapi yesil tik basiyordu.
echo  13) Yeni kontrol: bir {placeholder} her dilde korunmali ve JS'te
echo      yerlestirilen her {token} icin gercekten bir yer olmali.
echo  14) check-error-modal.mjs SADECE deploy.bat'tan calisiyordu; CI
echo      yolunda (npm run verify) hic calismamis. Artik verify'de.
echo  15) Kalan iki hata geri cagrisiz dinleyici baglandi (presence ve
echo      baglanti sondasi). matchmaking.js silindi (hic cagrilmiyordu).
echo      Olu DOM baglantisi ve CSS'siz uc body sinifi kaldirildi.
echo.
echo v3.7.4 -- Saplak sonucu tek yerde + cok oyunculu bitis kurali:
echo  16) USE_SERVER_VALIDATION false oldugu icin canli her saplak
echo      firebaseSync.js'in KENDI islem govdesinden geciyordu; suitedeki
echo      her saplak iddiasi ise uyuyan functions/gameLogic.js kopyasini
echo      test ediyordu. 1200 gecen test, calismayan kod hakkindaydi.
echo      Sonuc artik slapOutcome.js'te; iki cagiran da ona devrediyor.
echo      Olculdu: cikarimdan sonra 12 mutasyonun 12'si yakalandi.
echo  17) YENI KURAL (cok oyunculu): masadaki canli GERCEK oyuncu sayisi
echo      sifira dustugunde mac orada biter, elenme kalicilasir. Kimse
echo      taclandirilmaz (winnerId -1); bot sampiyon ilan edilmez.
echo      convertToBot ayrilan oyuncunun uid'ini bot_ yaptigi icin masa
echo      tamamen bota donuyor ve hicbir bitis kosuluna ulasamiyordu.
echo      Kural zaten canli islemde yorum olarak yaziliydi, uygulanmiyordu.
echo      Tek oyunculu ETKILENMEZ: slapOutcome.js'i sadece firebaseSync
echo      import ediyor ^(testle sabitlendi^).
echo.
echo v3.7.5 -- Acilamayan hata ekrani (CSP) ve testin kor noktasi:
echo  18) v3.7.0'dan v3.7.4'e kadar, head etiketi icindeki satir ici
echo      net" HER sayfa yuklemesinde CSP tarafindan BLOKE edildi. Yani
echo      "Uygulama baslatilamadi" ekrani, tam da gerektigi anda yoktu.
echo      Bes surum boyunca iki kapi bunu yesil gecirdi.
echo  19) Neden goremediler: check-error-modal script'in KONUMUNU kontrol
echo      ediyordu, sorun konum degildi. smoke.mjs ise kendi sunucusundan
echo      HICBIR baslik gondermiyordu -- ihlal edilecek politika yoktu.
echo      Uretimden daha musamahakar bir test ortami, uretimi test etmez.
echo      Artik smoke firebase.json'daki "**" basliklarini aynen servis
echo      ediyor ve CSP ihlali "beklenen gurultu" olarak filtrelenemiyor.
echo  20) Cozum hash, ama ELLE DEGIL: tools/csp-hash.mjs hash'i
echo      index.html'den uretiyor, npm run verify bayat hash'te duruyor.
echo      Tarayici hatasindan kopyalanan sabit bir hash, v3.7.4'un temizledigi
echo      sapma sinifinin aynisi olurdu -- iki yerde tutulan, hicbir seyin
echo      senkron tutmadigi, sapmasi yalnizca canlida gorunen bir deger.
echo  21) "Yenile / Reload" butonu da oluymus: onclick= satir ici handler'i
echo      script-src ayni sekilde bloke ediyor ve hash bunu ACMAZ
echo      ^('unsafe-hashes' gerekir^). addEventListener'a cevrildi.
echo  22) Boot net artik bayrak okuyarak degil, modul grafigi kirilarak
echo      test ediliyor: main.js 503 dondurulup ekranin GERCEKTEN
echo      cikmasi bekleniyor. Kapinin 7 mutasyonun 7'sini yakaladigi olculdu.
echo.
echo v3.7.6 -- Deploy konsolunun kendisi yalan soyluyordu:
echo  23) v3.7.5 deploy'u temiz gecti ama LOG'u iki yerde yanlisti; ikisini de
echo      1346 test goremedi, cunku ikisi de suite'in kosmadigi yerde yasiyor:
echo      cmd.exe ve Windows yol ayraclari.
echo  24) 18 numarali surum notunun yerine "Sistem belirtilen dosyayi
echo      bulamiyor." yazildi. Satirda duz metin olarak head etiketi vardi ve
echo      cmd icin ^< karakteri GIRDI YONLENDIRMESI: "head" adli bir dosya
echo      aradi, bulamadi, satiri atladi. CSP hatasini anlatan not, bir
echo      yonlendirme karakteri tarafindan yutuldu -- hem de gorevi tam o anda
echo      operatore ne degistigini soylemek olan bir dosyada.
echo  25) sync-rules iki kez "s already in sync" yazdi. Adi soyle turetiyordu:
echo      sv.slice^(sv.indexOf^('functions/'^)^). Windows'ta path.join ters boluyle
echo      uretir, indexOf -1 doner, slice^(-1^) yolun SON KARAKTERINI verir.
echo      Sunucu aynasini garanti eden kapi, hangi aynayi kontrol ettigini
echo      soyleyemiyordu. Ad artik turetilmiyor, MIRRORS icinde yaziyor.
echo  26) Yeni kapi bu iki hatanin GENEL bicimini tutuyor: deploy.bat'in hicbir
echo      echo/REM satirinda kacak ^< ^> olamaz, tools/ altinda hicbir dosya
echo      denetlenmemis bir indexOf'tan dogrudan slice alamaz, ve deploy.bat'in
echo      calistirdigi her kapi gorunur bir onay birakmak zorunda. 6 mutasyonun
echo      6'si yakalandi.
echo.
echo v3.7.7 -- CSP kapisi senin makinende HIC calismamis:
echo  27) v3.7.6'da deploy.bat'a "check-csp-hash: OK" echo'su eklenmisti ki
echo      sessiz bir kapi gizlenemesin. Sonraki deploy o satiri bastir --
echo      ama csp-hash'in KENDI ciktisi yine yoktu. Kapi sessiz degildi;
echo      hic calismiyordu.
echo  28) Sebep: giris noktasi kontrolu soyle yazilmisti:
echo         if ^(import.meta.url === "file://" + process.argv[1]^) main^(^);
echo      Linux'ta dogru. Windows'ta import.meta.url "file:///D:/..." iken
echo      sablon "file://D:\..." uretiyor -- uc bolu vs iki, duz bolu vs
echo      ters bolu. Her zaman false. main^(^) hic cagrilmadi, surec 0
echo      donduru ve npm run verify hicbir sey yapmayan bir kapiyi GECMIS
echo      saydi. Yani CSP kapisi iki surum boyunca kimseyi korumadi --
echo      hem de tam bu hata sinifini durdurmak icin yazilan dosyada.
echo  29) Duzeltme pathToFileURL: Node'un import.meta.url'e verdigi yazimin
echo      aynisini her platformda uretir.
echo  30) Yeni kapi: tools/ altinda hicbir dosya "file://" + argv yazimini
echo      kullanamaz, VE her kapi alt surec olarak CALISTIRILIP konusmaya
echo      zorlanir -- hicbir sey basmayan bir kapinin basarisi hicbir sey
echo      ifade etmez. 4 mutasyonun 4'u yakalandi.
echo      DURUST SINIR: Windows davranisi Linux'tan taklit edilemez
echo      ^(pathToFileURL platforma bagli^). O yuzden asagidaki insan
echo      kontrolu bu kapinin Windows ayagidir.
echo.
echo v3.9.0 -- v3.8.0 lobisi geri alindi, kazanimlari korundu:
echo  31) v3.8.0 lobiyi yeniden kurarken tam ekran bir perde ekledi:
echo      body.menu-screen::after, z-index 2, rgba^(5,10,19,.94^). Katman
echo      sirasi zarari netlestiriyor: Misir gorseli ^(#parallax-scene^) z:1,
echo      arayuz ^(.screen^) z:5. Aradaki bir perde tek bir sey yapabilir --
echo      resmi karartmak. Bes temanin gorseli ayni mavi-siyaha coktu.
echo  32) Ayni dosya yedi ikincil butonu !important ile TEK griye zorladi.
echo      Renkleri index.html'de satir ici yazili ^(Shop altin, Daily mavi,
echo      Slap IQ nane, Practice mor^) ve satir ici stili ancak !important
echo      ezer -- yani duzlestirme kasitliydi. Ayrica oyna butonunun
echo      0 0 30px var^(--primary^) parilitisi duz golgeyle degistirildi.
echo  33) Ve hicbir seyle eslesmeyen uc kural tasidi: .lobby-edition,
echo      .lobby-suit ve h1 icindeki span. Bir "edition" satiri, dev maca
echo      simgesi ve iki renkli baslik yazildi, deploy edildi, bir kez bile
echo      cizilmedi. Yeni bir stil dosyasi projeye SIFIR kapsamla girmisti.
echo  34) v3.9.0 lobby.css'i tamamen kaldirdi: v3.7 lobisi geri geldi.
echo      Yazi tipi hic degismemisti -- ikisi de Outfit. Degisen dizgiydi:
echo      1.8rem / BUYUK HARF / 3px aralik / 900 agirlik / parilti, yerine
echo      1.2rem / normal / .01em / 800 / duz golge gelmisti. Dosya kalkinca
echo      eski dizgi kendiliginden dondu.
echo  35) v3.8.0'in GERCEK kazanimlari style.css'e tasindi, birlikte
echo      gitmesinler diye: azaltilmis-hareket korumasi, klavye odak
echo      halkalari, menunun kaydirilabilir olmasi ^(kisa telefonda Ayarlar
echo      butonu erisilemiyordu^), oyuna gecisin 1000ms yerine ~320ms
echo      olmasi ve ekran okuyucular icin gorsel olarak gizli h1.
echo  36) Isim alani artik altin logonun uzerine binmiyor -- her incelemenin
echo      hemfikir oldugu tek gorsel hata buydu. Mobilde ayrica okunabilir
echo      bir zemin ve alt surum satiriyla cakismama boslugu var.
echo  37) GPT'nin yarim biraktigi profil isi tamamlandi: markup bes ceviri
echo      anahtari istiyordu, hicbiri tanimli degildi. Localization.get
echo      bulamayinca ANAHTARIN KENDISINI dondurur, yani oyuncu ekranda
echo      "profileGames" yazisini goruyordu -- dort dilde birden.
echo  38) Kapi yeniden hedeflendi: artik lobby.css'e degil, index.html'in
echo      yukledigi TUM stil sayfalarina bakiyor. 5 mutasyonun 5'i
echo      yakalandi; sonuncusu onemli: yeni bir kucuk stil dosyasi eklenir
echo      eklenmez olu-secici denetimi kendini kuruyor.
echo.
echo v3.10.0 -- oyuncu karti, ve onu yakalayacak olan kapi:
echo  39) Hesap panelinin giris yapilmis gorunumu v3.8.0'da HIC STYLESHEET
echo      KURALI OLMADAN gonderildi. Yedi sinif index.html'de adlandi,
echo      hicbir yerde tanimlanmadi: .profile-identity, .profile-emblem,
echo      .profile-eyebrow, .profile-stats, .profile-stat, .profile-intro,
echo      .profile-history-note. Tarayici denileni cizdi -- ciplak metin.
echo      Amblem 12px bir karakterdi; her istatistik etiketini degerine
echo      yapistiriyordu ^("Skor1", "Oynanan mac0"^); kazanma orani alttaki
echo      kartin altinda kaliyordu. v3.8.0 ve v3.9.0 boyunca gitti.
echo  40) Bunu HICBIR kapi goremezdi ve iste asil mesele bu. Birim testler
echo      mantik okur, layout degil. check-locales bu etiketlerin DORT
echo      DILDE de dogru cevrildigini kanitladi -- okunamayan bir panelde.
echo      check-lobby stil sayfalarinda olu secici arar, yani insaat geregi
echo      hic stil sayfasinda OLMAYAN bir sinifi goremez.
echo  41) Yeni kapi 8/9: check-orphan-classes. check-lobby'nin tersi.
echo      Kural: markup'ta adi gecen her sinif ya bir stil sayfasinda
echo      tanimlidir, ya her tasiyicisi satir ici stillidir ^(.spinner,
echo      .boot-error-tech gibi -- bunlar bilerek oyle^), ya da JS onu
echo      querySelector ile arar ^(.ers-error-retry gibi^). Elle yazilmis
echo      izin listesi YOK; ikisi de kaynaktan cikariliyor.
echo      9 mutasyon: M1/M3 ciplak sinif ^(yakalandi^), M2'/M7'/M8 sinifin
echo      TUM kurallarini sil ^(yakalandi^), M9 sinifi yalnizca CSS yorumunda
echo      birak ^(yakalandi^), M4/M5/M6 mesru durumlar ^(gecti, yanlis alarm
echo      yok^). M2 ve M7 esdeger mutanttiykendi: tek bir kural blogunu
echo      silmek sinifi tanimsiz birakmiyor, diger kurallar duruyor.
echo  42) Kapi bes olu etiket daha buldu: .bot, .human, .glassmorphic-card,
echo      .table-action, .tutorial-card. Hicbiri stilli degildi, hicbiri
echo      sorgulanmiyordu. Markup'tan cikarildi.
echo  43) Panel artik TEMAYI takip ediyor. Iki alt kart elle satir ici
echo      rgba^(22,27,34,.45^) tasiyordu -- bes temada da ayni gri. Refleks
echo      egrisi de dort yerde #58a6ff'ti, altin bir kartin icinde mavi.
echo      Yuzeyler --panel-bg/--panel-border'dan geliyor, vurgu altin:
echo      --primary :root'ta BIR KEZ tanimli ve hicbir tema onu ezmiyor,
echo      yani var^(--primary^) bir vurgu her temada ayni mavi olurdu.
echo  44) Panel basligi kisa ekranlarda ULASILAMIYORDU. Tasan bir flex
echo      SUTUNUNDA justify-content: center tasmayi IKI uctan disari iter
echo      ve ust uca scrollTop 0 oldugu icin geri kaydirilamaz. Olculdu:
echo      h2, 1920x914'te top:-21; 390x844'te top:-138. safe center geldi,
echo      onunde de anlamayan tarayicilar icin flex-start.
echo  45) Lobide olculen uc kusur: ^(a^) 1.795 en-boy gorsel 2.10 pencerede
echo      genislige gore olcekleniyor, 156px dusuyor ve center bunu ustten
echo      de kesiyordu -- wordmark kirpiliyordu; kirpma %%15'e kaydi.
echo      ^(b^) #main-menu 4 piksel tasip kalici bir kaydirma cubugu
echo      aliyordu: floor min-height'tan height'a gecti, cunku
echo      flex-shrink'i engelleyen min-height'ti. 1920x914 ve 1366x768'de
echo      tasma artik SIFIR. ^(c^) 1366x768'de surum satiri Ayarlar
echo      butonunun ICINDE kaliyordu ^(buton 736-776, satir 743-758^) ve
echo      icindeki Hakkinda/Gizlilik baglantilari pointer-events: auto --
echo      yani Ayarlar'a nisan alan tiklama Hakkinda'yi acabiliyordu.
echo  46) CSP: www.gstatic.com script-src'deydi, connect-src'de degildi,
echo      bu yuzden Firebase SDK'nin .js.map kaynak haritalari engelleniyor
echo      ve konsola 5 kirmizi satir yaziyordu. Yalnizca DevTools acikken
echo      gorunur, gercek kullaniciyi etkilemez, ama artik yok.
echo.
echo v3.10.1 -- v3.10.0'in kendi duzeltmesinin kalan yarisi:
echo  47) 45c'deki altbilgi/Ayarlar cakismasi 1920x914 ve 1366x768'te
echo      gercekten bitti (canlida olculdu: 37px acik, ve tarayicinin
echo      kendi isabet testi Ayarlar butonunun merkezinde btn-settings
echo      dondu). Ama ~660px'in ALTINDA geri geliyordu ve sebebi derece
echo      degil yapiydi: #game-version position:absolute, yani
echo      #main-menu'nun DOLGU KUTUSUNA sabitli. Butonlar normal akista
echo      ve icerik o kutuyu asinca tasma alanina gecip devam ediyor.
echo      ICERIGIN sonundaki bir dolgu, ikisinden yalnizca biri icerikte
echo      olan iki seyi ayiramaz. Canlida 1366x640: Ayarlar 574-615,
echo      altbilgi 613-630 -- iki piksel; 560px'te 40 piksel.
echo  48) Menunun gercekten kaydigi yuksekliklerde altbilgi artik
echo      sabitlenmiyor, AKISA katiliyor: son butonun ve kendi
echo      marjininin ardina dusuyor, her sey gibi kaydirarak
echo      ulasiliyor. Kirilma noktasi zaten var olan max-height:760px
echo      ve tasmanin basladigi yerin (~677px icerik) rahatca ustunde,
echo      yani ikisi celisemez. Olculdu, dokuz yukseklikte: 914, 768,
echo      844 (telefon) DEGISMEDI; 700/660/640/600/560 ve 390x667'de
echo      aciklik sabit 38 piksel. 4 mutasyon, 4'u yakalandi.
echo.
echo v3.11.0 -- Saplayarak Geri Donme: kodun kilitli tuttugu vaat:
echo  49) Kural sayfasinda "Izleyici Modu ve Saplayarak Donme" baslikli bir
echo      bolum var ve dort dilde soyle diyor: "Elendiniz mi? Hemen
echo      ayrilmayin! Izleyici Modunda oyunu izleyebilir ve istediginiz an
echo      Saplayarak Geri Donme girisiminde bulunabilirsiniz. Basarili bir
echo      saplak, ortadaki yigini alarak sizi oyuna geri dondurur!"
echo      Bu vaadin etrafina ui.js'te bildirim ve log satiri,
echo      victoryScreen.js'te yenilgi ekranini kaldirma, multiplayerMode'da
echo      sayac, zafer ekraninda "Dirilme Sayisi" istatistigi, iki ve
echo      uzeri icin mvpComeback rozeti ve GameState.stats.resurrections
echo      sayaci yazilmisti. Olayi gonderen HICBIR YER yoktu.
echo  50) Dort ayri kilit vardi, tek bir hata degil:
echo      1. game.js insan kartsiz kalinca offline maci ANINDA bitirip en
echo         cok karti olan botu taclandiriyordu.
echo      2. game.js elenmis koltugun saplagini reddediyordu
echo         ^(playerId === 0 ^&^& humanEliminated -^> return^).
echo      3. firebaseSync elenmis koltugun KAZANAN saplagini cope atiyordu
echo         ^(if ^(!p ^|^| p.eliminated^) return false^) -- yani refleksle
echo         yarisi kazansa bile pay verilmiyordu.
echo      4. victoryScreen yigini pointer-events: none yapiyordu. Saplak
echo         #center-pile uzerine pointerdown, yani motor calissa bile
echo         parmakla ulasilamiyordu.
echo      Ucu de DECISIONS #17'de kayitliydi; dorduncusu ^(yigin kilidi^) bu
echo      turda bulundu. Deste kilitli KALIYOR: eli bos koltugun oynayacak
echo      karti yok, sirasini getNextPlayer zaten atliyor.
echo  51) slapOutcome.js'te tek satir: desteyi alan koltuk elenmisse
echo      eliminated temizlenir. Bu, alti satir asagidaki "eli bos kalan
echo      elenir" kuralinin TAM TERSI ve kuralin iki yarisi artik yan yana.
echo      Oda ayrica lastResurrectedId ile damgalaniyor, boylece her
echo      istemci dirilmeyi olayin kendisinden ogreniyor, bayrak farkindan
echo      tahmin ederek degil.
echo  52) KULLANICI KARARI KORUNDU. DECISIONS #17/#18: "cok oyunculuda
echo      canli gercek insan sayisi 0 olunca elenme kalicilasir." Bu
echo      dokunulmadi: countLiveHumans ve resolveEndOfMatch aynen duruyor.
echo      Saplayarak donme yalnizca o kuralin KAPSAMADIGI durumu buluyor --
echo      masada baska bir insan hala oyundayken. Tek insan elenirse mac
echo      yine orada biter, yine kimse taclandirilmaz. Bu kurali kasitli
echo      olarak bozan bir mutasyon calistirildi: 13 test kirildi.
echo  53) Yeni kapi 9/10: check-promises. Konseyin 2. maddesi. Dokuz
echo      kapinin dokuzu da kaynak metnine ya da yerlesime bakiyordu;
echo      hicbiri "soz verdigin sey oluyor mu" diye sormuyordu.
echo      Kural: .on^(...^) ile beklenen her olay en az bir yerde
echo      .emit^(...^) edilmeli. Tersi yalnizca BILDIRILIR, kapiyi
echo      dusurmez -- dinleyicisiz olay bir kanca, gondericisiz dinleyici
echo      oyuncuya gosterilmis bir sozdur. 7 mutasyon, 7'si dogru davrandi;
echo      en onemlisi iki gondericiyi birden silmek ^(ozgun hata^) yakalandi,
echo      birini silmek ise yanlis alarm URETMEDI.
echo.
echo v3.12.0 -- Hesap karti: gercek bir form, dort dilde bir ses:
echo  54) Kart bir ^<form^> DEGILDI. Sonuclari: Enter tusu hicbir sey
echo      yapmiyordu, sifre yoneticileri doldurmayi da kaydetmeyi de
echo      onermiyordu ^(form disindaki sifre alani icin tarayici zaten her
echo      yuklemede uyariyordu^) ve tek bir autocomplete niteligi yoktu.
echo      Artik ^<form id="auth-form" novalidate^>, tek bir type="submit"
echo      butonu, preventDefault ile baglanmis submit olayi ve dort
echo      autocomplete: username, email, current-password; kayit modunda
echo      new-password ^(yoneticiler KAYDETMEYI bu ikincisinde onerir^).
echo  55) IC ICE IKI KART vardi: .account-section ^(cam panel^) icinde
echo      .auth-card ^(ikinci cam panel^). Iki cerceve, iki bulanikilik ve
echo      ilk alana kadar ~70 piksel olu bosluk. .auth-card artik yalnizca
echo      yerlesim: arka plan, cerceve, golge ve dolgu yok. Iki tanim ust
echo      uste ve SIRA belirleyici oldugu icin testi de sirayi olcuyor.
echo  56) MOD ALTI YERDE tutuluyordu: isRegisterMode bayragi ve uc ayri
echo      fonksiyondan yazilan bes style.display. Iki mod birbirine
echo      dusebilirdi -- bu projenin imzasi olan hata. Artik TEK yerde:
echo      formun uzerindeki data-mode niteligi. Gorunumun tamami CSS'te
echo      ondan turuyor. JS hicbir auth ogesinin display'ini yazmiyor;
echo      kullanici adi alaninin ACILIRKEN animasyonlu gelmesi de tam
echo      olarak bunun sayesinde mumkun ^(reduced-motion'da kapali^).
echo  57) SEKIZ INGILIZCE CUMLE gomuluydu ^(ikisi profileUI, altisi
echo      auth.js^) ve default dali ham Firebase kodunu basiyordu:
echo      "Error [auth/network-request-failed]: ...". Yani Turk oyuncu
echo      bilinen alti yolda Ingilizce, geri kalan HER yolda SDK kimligi
echo      goruyordu -- ve o dal tam da baglanti koptugunda calisiyor.
echo      Yeni authErrorKey^(^) kodu bir ceviri ANAHTARINA ceviriyor;
echo      17 yeni anahtar x 4 dil eklendi. check-locales sabit anahtari
echo      goruyor ama Localization.get^(degisken^) goremez, o yuzden
echo      testler kartin uretebilecegi her anahtari kaynaktan toplayip
echo      dort dilde de var mi diye bakiyor.
echo  58) SIFRE SIFIRLAMA yoktu. Eklendi: "Sifreni mi unuttun?" bagi,
echo      sendPasswordResetEmail, ve ayni satirda altin renkli basari
echo      mesaji. Kayitli olmayan adres icin de BASARILI donuyor --
echo      bilerek: aksi halde form "bu e-posta kayitli mi" sorusuna
echo      cevap veren bir arac olurdu.
echo  59) GONDERIM KILIDI yoktu: yavas baglantida cift dokunus iki hesap
echo      acabilirdi. Artik data-busy niteligi buton ve baglari devre
echo      disi birakiyor, etiket "Gonderiliyor..." oluyor ve kilit
echo      finally icinde birakiliyor -- finally olmasa basarisiz tek bir
echo      istek karti sayfa yenilenene kadar kilitlerdi.
echo  60) OFFLINE STUB KAYMASI: sendPasswordResetEmail eklenince smoke
echo      20 saniye timeout ile, TEK BIR konsol satiri bile olmadan oldu.
echo      Eksik bir NAMED EXPORT ES modullerinde baglama hatasidir: graf
echo      hic degerlendirilmez, main.js hic calismaz, dolayisiyla durumu
echo      bildirecek hicbir sey ayakta degildir. Ornek tek satir; SINIF
echo      ise "test ikizinin taklit ettigi koddan geri kalmasi" ve artik
echo      mekanik olarak kapali: uygulamanin Firebase CDN'inden aldigi her
echo      isim tools/firebase-stub.mjs tarafindan export edilmeli.
echo  61) ILK DENEMEDE KART KENDINE BIR PALET UYDURDU: 0.68rem altin
echo      buyuk harf etiketler, altin ikonlar, altin odak halkasi ve altin
echo      baglar. Kendi icinde tutarliydi ve yanlisti -- ayarlar panelinden,
echo      lobiden ve etrafindaki her popuptan BASKA bir uygulama gibi
echo      duruyordu; hepsi .setting-group label ve var^(--primary^) neyse
echo      onu kullaniyor. Kullanici tek cumleyle soyledi ve hakliydi.
echo      Kart artik hicbir rengi kendi uydurmuyor: etiket oldugu gibi
echo      birakildi, ikonlar ve odak halkasi uygulamanin, baglar tema
echo      rengi, basari mesaji --accent. Test bunu OLUMSUZ bicimde
echo      olcuyor: v3.12.0 blogunda tek bir var^(--gold^) bile olmamali.
echo  62) EKRANDA KALAN KATMAN ^(canlidan bildirildi^): mac bitince menuye
echo      donuldugunde "KAOS KAZANDI!" yazisi 2.8rem altin harflerle
echo      butonlarin uzerinde duruyordu. gameOver bu yaziyi permanent=true
echo      ile basiyor; public/js icinde #notifications'i tekrar seffaf
echo      YAPAN tek satir, onu basan fonksiyonun kendi permanent-olmayan
echo      solma dali idi. Iki kalici cagri, sifir cikis yolu.
echo      NEDEN gozden kacti: #notifications eskiden #game-container
echo      icindeydi, oyun ekrani gizlenince o da gizleniyordu. v3.x onu
echo      BILEREK body seviyesine ve position:fixed'e tasidi -- lobi, menu
echo      ve yeniden baglanma mesajlari hic gorunmuyordu ^(bunu dogrulayan
echo      smoke adimi hala yesil^). Ama bu tasima onu resetOfflineUI'nin
echo      erisiminden cikardi. Toast'i her yerde GORUNUR yapan duzeltme,
echo      onu indirilemez yapan duzeltmeyle ayni duzeltmedir.
echo      Kapatma cagrisi GameManager.quitGame'e kondu: main.js
echo      resetOfflineUI'yi yalnizca activeMode==='bots' iken cagiriyor,
echo      yani cok oyuncuda o teardown hic calismiyor.
echo  63) AYNI SINIFTAN IKINCI HATA, KIMSE BILDIRMEDI. 62 icin yazilan
echo      smoke kapisi ILK calismasinda #victory-screen'i yakaladi:
echo      EventBus.on^('gameOver'^) zafer ekranini 1500ms sonra gostermek
echo      uzere HANDLE'SIZ bir setTimeout kuruyordu -- iptal edilemez. Ve
echo      #btn-quit o 1.5 saniye boyunca tiklanabilir. O aralikta cikan
echo      oyuncunun menusunun uzerine tam ekran z-index:1000 bir zafer
echo      ekrani biniyordu. Artik timer'in handle'i var ve quitGame iptal
echo      ediyor.
echo  64) KAPI ORNEGI DEGIL SINIFI kolluyor: menu aktifken body seviyesindeki
echo      z-index ^>= 1000 olan HICBIR oge cizilmis olamaz. Kume LISTE degil
echo      TURETME: .screen en fazla z-index 1000, dolayisiyla body'de bunun
echo      ustundeki her sey tanimi geregi bir katmandir -- JS'ten gosterilir
echo      ve ekran degisimlerinden sag cikar, cunku ekran degisimi yalnizca
echo      .screen'e dokunur. Gelecek yil yazilacak bir katman, yazildigi gun
echo      kapsama girer; guncellenecek bir liste yok. Adim ayrica once kendi
echo      katmanini kaldiriyor ^(onceki adimdan temiz durum devralmasin^) ve
echo      "hicbir sey yok" demeden once bir katmani GOREBILDIGINI kanitliyor.
echo      4 mutasyon: 62'nin iki kablosu, kapatma fonksiyonunun bosaltilmasi
echo      ve 63'un timer'i. Dorduncusu YALNIZCA genel kapiyi dusuruyor --
echo      sinifi kollamanin ornegi kollamaktan farki tam olarak budur.
echo.
echo 12 mutasyon calistirildi, 12'si de yakalandi; geri alindiginda
echo 1642 test yesil. Ayrica gercek tarayicida 18 davranis kontrolu:
echo Enter, kilit, hata mesaji, sifirlama, mod gidis-donusu ve dort
echo genislikte yatay tasma yok.
echo.
echo v3.13.0 -- Ra'nin Carki: ers-revamp'tan gelen ozellikler:
echo  65) ers-revamp bir FORK DEGIL: v3.11.0 oncesi bir anlik goruntu artan
echo      dort ekleme. Yani ortak dosyalarin hepsi IKI sebepten birden
echo      farkli -- eklenen ozellikler VE henuz olmayan ozellikler. Herhangi
echo      bir dosyayi oldugu gibi kopyalamak v3.11.0 ve v3.12.0'i TEK BIR
echo      TEST BILE KIRILMADAN geri alirdi, cunku onlari sabitleyen testler
echo      ayni kopyanin icinde. Yontem dosya-dosya degil, ozellik-ozellik
echo      oldu: ui.js yalnizca +20/-2 satir.
echo  66) RA'NIN CARKI geldi, ama uc duzeltmeyle:
echo      a. ALTINLAR CardSkins'ten geciyor. Ozgun kod
echo         localStorage['ers_coins']'e DOGRUDAN yaziyor ve bakiyeyi kendi
echo         boyuyordu. O anahtarin sahibi cardSkins.js ve her kayitta
echo         coinsUpdated gonderiyor -- shopUI.js zaten onu dinliyor.
echo         Arkasindan yazmak demek: olay hic gitmiyor, CardSkins'in kendi
echo         yazmasiyla yarisiyor, ve ekranda birbirini tutmayan iki bakiye
echo         oluyor. Tek bir CardSkins.addCoins^(^) ucunu birden kapatti.
echo      b. HICBIR SEYLE ESLESMEYEN SECICI: repaint
echo         `.user-coin-balance, #shop-coin-balance, #banner-coins`
echo         hedefliyordu. `.user-coin-balance` bu projede HICBIR YERDE yok.
echo         Repaint tamamen kaldirildi; #banner-coins artik diger her bakiye
echo         gibi coinsUpdated'i takip ediyor.
echo      c. DORT DIL. Modulun her metni Turkceydi -- canvas'a CIZILEN dilim
echo         etiketleri dahil, yani hicbir kapinin goremeyecegi bir yerde.
echo         Dosya Localization'i import edip hic cagirmiyordu. 22 anahtar x
echo         4 dil eklendi; dil degisince canvas yeniden ciziliyor.
echo         Ayrica sol yarideki etiketler bas asagi ciziliyordu; artik
echo         180 derece cevrilip diger uctan hizalaniyorlar.
echo  67) FOTO FINIS bandi ve UC SAPLAK ALEVI geldi -- ikisinin de geldigi
echo      yerde HICBIR CSS KURALI YOKTU. `.photo-finish-banner` icin
echo      ui.js display:block yaziyordu ve tek bir bildirim bile yoktu
echo      ^(check-orphan-classes bu yuzden build'i reddederdi^); `.on-fire`
echo      icin ise stil sayfasindaki TEK gecen yer, hic sahip olmadigi bir
echo      animasyonu KAPATAN bir reduced-motion blogu idi. Ikisi de duzgun
echo      yazildi. Band ayrica hardcoded Ingilizce "PHOTO FINISH" yerine
echo      dort dilde zaten var olan photoFinish anahtarini kullaniyor, ve
echo      v3.12.0'in dersi geregi mac bitince kendisi de iniyor.
echo  68) SERVICE WORKER GELMEDI. PWA yanlis oldugu icin degil: bu SW tam da
echo      var olma sebebi olan iste bozuk. `./style.css`'i onbellege aliyor,
echo      sayfa `style.css?v=N` istiyor -- FARKLI onbellek anahtari, yani
echo      cevrimdisi sayfa STILSIZ aciliyor. Ustune, `/` uzerindeki
echo      no-store'un secilme sebebi olan aninda dagitimi takas ediyor ve
echo      buradaki tek "kaldirildiktan sonra da cihazda yasayan" sey o.
echo      MANIFEST geldi ^(18 satir statik JSON, hicbir onbellek davranisi
echo      yok^), ama start_url "./index.html" DEGIL "./" -- cleanUrls
echo      yuzunden /index.html bir yonlendirme ve no-store basligi "/"'de.
echo  69) ARCADE BUTONLARI GELDI, DENENDI, GERI ALINDI. Kalin 3B golgeli,
echo      buyuk harf, genis aralikli menu butonlari. Uygulandi, ekran
echo      goruntusu alindi, bakildi -- ve cikarildi. Kullanicinin sozu:
echo      "yeni ozellikler getirirken bu elegant goruntuyu bozma".
echo      Hesap kartinda oldugu gibi burada da ayni kural: bir ozellik,
echo      indigi ekrana KENDI gorsel dilini getiremez. Lobi tam olarak
echo      eskisi; carkin butonu da uygulamanin standart .btn primary'si,
echo      modal yuzeyi --panel-bg/--panel-border, kose rozetleri de o
echo      kosede zaten duran iki cipin aynisi. Test bunu OLUMSUZ olcuyor:
echo      "arcade" kelimesi ne CSS'te, ne markup'ta, ne de carkta gecebilir.
echo  70) YENI GENEL KAPI: stil sayfasinin adini verdigi HER animasyonun
echo      keyframes'i olmali. Port iki kurali, keyframe'leri gelmeyen bir
echo      dosyadan getirmisti. Kapi calisirken KENDI yorumuma da takildi
echo      ^(DECISIONS #25, yedinci kez^) -- yorum striplendi ve korlesmedigi
echo      ayrica dogrulandi.
echo.
echo 9 mutasyon calistirildi, 9'u da yakalandi; geri alindiginda 1769 test
echo yesil. Ayrica gercek tarayicida 28 davranis kontrolu: cark ciziliyor,
echo altin CardSkins'e yaziliyor, coinsUpdated gidiyor, gunluk hak
echo tukeniyor, geri sayim basliyor, dort dil, foto finis geliyor ve
echo kendini kaldiriyor, ve dort genislikte yatay tasma yok.
echo.
echo Motor, kurallar, puanlama ve Firebase islemleri EL DEGMEDI.
echo Reklamlar hala kapali: yayinci kimligi bos oldugu surece hicbir istek yok.
echo.
echo DEPLOY SONRASI KONTROL (bunlar sadece tarayicida dogrulanabilir):
echo   - Ana menude surum yazisi v3.13.0 olmali
echo   - / yanitinda Cache-Control: no-store olmali
echo   - HESAP PANELI ^(bu surumun ana isi^): giris yap, sonra bak --
echo     amblem ALTIN HALKALI YUVARLAK olmali, 12px bir maca isareti degil
echo     dort istatistik 2x2 IZGARADA, etiket ustte deger altinda olmali
echo     "Skor1" gibi BITISIK bir sey KALMAMALI
echo     kartin yuzeyi TEMANIN rengi olmali: kirmizi temada kirmizi,
echo     yesil temada yesil ^(hepsi ayni griyse sinif yine kaybolmus^)
echo     refleks egrisi ALTIN olmali, mavi degil
echo   - Hesap panelini KISA bir pencerede ac: "Hesap" basligi GORUNMELI
echo     ^(yukari kaydirilamayan bir yere kacmamali^)
echo   - Lobide wordmark ^(EGYPTIAN RAT SCREW^) TAM gorunmeli, ustu
echo     kirpilmamali; ve menude kaydirma cubugu OLMAMALI
echo   - Pencereyi 1366x768'e getir: surum satiri Ayarlar butonunun
echo     UZERINDE olmamali; Ayarlar'a tikla, Ayarlar acilmali ^(Hakkinda
echo     ya da Gizlilik DEGIL^)
echo   - Pencereyi DAHA DA kisalt ^(600px civari^): menu kayiyor olmali,
echo     surum satiri artik en altta AKISTA -- butonlarin uzerine
echo     binmemeli, asagi kaydirinca gorunmeli
echo   - SAPLAYARAK GERI DONME ^(bu surumun ana isi^): botlarla oyna ve
echo     tum kartlarini kaybet. "ELENDIN" ekrani cikmali ama maci
echo     BITIRMEMELI: ekran kapaninca masayi izlemeye devam etmelisin.
echo     Destene tiklama CALISMAMALI ^(sonuk, kartin yok^) ama ORTADAKI
echo     YIGINA tiklama CALISMALI. Gecerli bir desende sapla: "DIRILTILDIN"
echo     bildirimi cikmali ve yigin senin olmali.
echo     Maci kazanirsan zafer ekranindaki "Dirilme Sayisi" 0 DEGIL olmali.
echo   - DevTools konsolu: .js.map icin CSP ihlali OLMAMALI
echo   - Konsol temiz olmali (kirmizi satir yok)
echo   - konsolda .lp icin CSP ihlali OLMAMALI (RTDB long-polling)
echo   - Cok oyunculu -^> gecersiz bir masa kodu gir (orn. ZZZZZZ):
echo     "Odaya katilinamadi / Bu koda sahip bir masa yok." cikmali
echo   - Wi-Fi'yi kapat, ayni kodu tekrar dene:
echo     ayni baslik ama "Internet baglantin koptu." cikmali
echo     ^(ayni butonun iki farkli sebep soylemesi bu surumun ozeti^)
echo   - Botlarla oyna, 3 saplak yakala: destede 30'dan geri sayan bir
echo     kalkan cikmali. 4. saplakta sayac 30'a GERI DONMELI.
echo   - Masa kur, "Kodu Kopyala" ve "Davet Et" yan yana ve ikisi de calismali
echo   - Network sekmesinde googlesyndication adresine tek istek olmamali
echo   - Cok oyunculu, 1 insan + 3 bot: insan elenince mac BITMELI
echo     ^(botlar oynamaya devam etmemeli, kazanan ilan edilmemeli^)
echo   - 2 insan + 2 bot: biri elenince mac DEVAM ETMELI
echo   - Tek oyunculu: elendikten sonra oyun ayni sekilde davranmali
echo   - F12 konsolu: KIRMIZI "Content Security Policy" satiri OLMAMALI
echo     ^(v3.7.4'e kadar her yuklemede vardi^)
echo   - Deploy loglarinda "Sistem belirtilen dosyayi bulamiyor." OLMAMALI
echo   - 2/10 kapisi dosya adlarini tam yazmali ^("s already in sync" DEGIL^)
echo   - 6/10 kapisi ciktisiz gecmemeli: "check-csp-hash: OK" gorunmeli
echo   - 6/10 kapisi ARTIK KENDI ciktisini basmali:
echo     "csp-hash: 1 inline script^(s^) in public/index.html" ve altinda
echo     sha256- ile baslayan satir. SADECE "check-csp-hash: OK" gorunuyorsa
echo     arac yine calismiyor demektir -- bunu bana bildir.
echo   - Lobi: altin logo TAM gorunmeli, isim kutusu uzerine BINMEMELI
echo   - Shop altin, Daily mavi, Slap IQ nane, Practice mor olmali
echo     ^(hepsi ayni gri ise lobby.css geri gelmis demektir^)
echo   - "START WITH BOTS" buyuk harf, genis aralikli ve parlayan olmali
echo   - Telefonda: Ayarlar butonu surum satirinin USTUNE binmemeli
echo   - Hesap panelinde "profileGames" gibi ham anahtar GORUNMEMELI
echo   - HESAP KARTI ^(bu surumun ana isi^): profil dugmesine bas, cikis
echo     yapmis haldeyken bak --
echo     TEK bir kart olmali, kart icinde kart DEGIL
echo     etiketler ^(E-posta, Sifre^) projedeki DIGER etiketlerle AYNI
echo     gorunmeli -- ayni punto, ayni renk; kendine ait turuncu/altin
echo     bir yazi tipi OLMAMALI
echo     baglar ^(Kayit Ol, Sifreni mi unuttun^) TEMA rengi olmali
echo     "Giris Yap" TEK buton, "Kayit Ol" ise BAG ^(link^) agirliginda
echo     "Sifreni mi unuttun?" gorunmeli
echo   - E-posta ve sifre yaz, ENTER'a bas: form gonderilmeli
echo     ^(sayfa YENILENMEMELI -- yenileniyorsa preventDefault dusmus^)
echo   - Yanlis sifreyle dene: mesaj TURKCE olmali. Ekranda
echo     "auth/" ile baslayan ham bir kod GORUNMEMELI
echo   - Gonderirken butona bir daha bas: buton DEVRE DISI olmali ve
echo     "Gonderiliyor..." yazmali; islem bitince geri donmeli
echo   - "Kayit Ol"a bas: kullanici adi alani ANIMASYONLA gelmeli,
echo     buton "Kayit Ol" olmali, "Sifreni mi unuttun?" KAYBOLMALI
echo   - "Giris Yap"a geri don: kullanici adi alani gitmeli, eski hata
echo     mesaji TEMIZLENMELI
echo   - Gecerli bir e-posta yazip "Sifreni mi unuttun?"a bas: ALTIN
echo     renkli onay mesaji cikmali ^(kirmizi degil^) ve posta gelmeli
echo   - Sifre yoneticisi ^(Chrome/1Password^): giris yapinca KAYDETMEYI
echo     onermeli; sonraki gelisinde DOLDURMAYI onermeli
echo   - Tab ile gez: her alanin ve her BAGIN odak halkasi olmali
echo     ^(baglarin halkasi v3.12.0'a kadar hic yoktu^)
echo   - Telefonda hesap karti: yatay kaydirma cubugu OLMAMALI
echo   - EKRANDA KALAN KATMAN ^(canlidaki hata^): botlarla oyna, maci BITIR,
echo     sonra menuye don. "... KAZANDI!" yazisi menude KALMAMALI
echo   - Ayni sekilde: mac biter bitmez, zafer ekrani gelmeden ONCE
echo     ^(1.5 saniyelik pencere^) Cikis'a bas. Menuye donmeli ve zafer
echo     ekrani menunun uzerine SONRADAN BINMEMELI
echo   - Yeni bir mac basla: onceki macin kazanan yazisi ekranda OLMAMALI
echo   - RA'NIN CARKI ^(bu surumun ana isi^): sol ustte alt para rozeti ve
echo     "Ra's Spin" dugmesi olmali; dugmede KIRMIZI bir nokta varsa bugun
echo     hakkin duruyor demektir. Profil avatari onlarin UZERINE BINMEMELI
echo   - Carka bas: cam panel acilmali ^(kahverengi/altin DEGIL, diger
echo     panellerle ayni yuzey^), cark cizilmis olmali ve TUM dilim
echo     etiketleri DUZ okunmali -- hicbiri bas asagi olmamali
echo   - Cevir. Kazandigin altin sol ustteki rozete ANINDA yansimali.
echo     Sonra Magaza'yi ac: oradaki bakiye AYNI sayiyi gostermeli
echo     ^(iki bakiye farkliysa CardSkins baglantisi kopmus demektir^)
echo   - Ayni gun tekrar ac: cevirme yerine GERI SAYIM cikmali
echo   - Dili degistir ^(EN/TR/DE/RU^): cark uzerindeki yazilar ve tum
echo     mesajlar o dile donmeli. "spinReady" gibi HAM ANAHTAR gorunmemeli
echo   - LOBI DEGISMEMIS OLMALI: "Start With Bots" MAVI, "Multiplayer
echo     Start" YESIL, alttaki yedi buton yumusak hapci. Kalin 3B golgeli
echo     turuncu arcade butonlar GORUNURSE geri alma calismamis demektir
echo   - Telefonda: cark ekrana sigmali, yatay kaydirma cubugu OLMAMALI;
echo     dar ekranda "Ra's Spin" yazisi gizlenip yalnizca gunes ikonu kalir
echo   - Botlarla oyna, cok yakin bir saplak yarisi kazan: ekranin ust
echo     ortasinda "FOTO FINIS" bandi cikmali ve 2.4 saniyede kendisi
echo     kaybolmali. Menuye donunce EKRANDA KALMAMALI
echo   - 3 saplak ust uste yakala: desten ALEVLI parlamali
echo   - Telefonda "Ana ekrana ekle": uygulama adi ve ikonu gelmeli,
echo     acilista adres cubuksuz tam ekran olmali
echo.
pause
