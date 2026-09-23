@echo off
REM ===================================================================
REM  ERS - Firestore guvenlik kurallari deploy
REM
REM  Cift tikla ya da bu klasorde calistir:  deploy-rules.bat
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat SADECE hosting atar. Guvenlik
REM  kurallari canli veri erisimini degistirir; yanlis dosya gonderilirse
REM  tablo kilitlenir ya da acilir. O yuzden bilincli, ayri bir komut.
REM
REM  "cd /d" onemli: "cd D:\..." komutu C: surucusundeyken SURUCU
REM  DEGISTIRMEZ, sadece D:'nin gecerli klasorunu ayarlar. %~dp0 bu
REM  dosyanin bulundugu klasor, /d de surucuyle birlikte gecmeyi saglar.
REM ===================================================================
setlocal
cd /d "%~dp0"

REM Konsolu UTF-8'e al. firestore.rules UTF-8; varsayilan kod sayfasinda
REM "type" ciktisi bozuk gorunur (- gibi). Sadece EKRANI etkiler, gonderilen
REM dosyayi degil -- ama okunamayan bir onay ekrani onay ekrani sayilmaz.
chcp 65001 >nul

REM  KURAL TESTI (guvenlik incelemesi, v3.18.1). Kurallar gonderilmeden once
REM  GERCEK Firestore emulatorunde calistirilir: senaryolar + kasten bozulmus
REM  kopyalar (mutantlar). Bir senaryo ya da mutant duserse HICBIR SEY gitmez.
echo.
echo === Kural testi (Firestore emulatoru) ===
REM  Firestore emulatoru Java 21+ ister. Yoksa hata mesaji yerine bunu soyle.
where java >nul 2>&1
if errorlevel 1 (
    echo.
    echo JAVA BULUNAMADI. Firestore kural testi Java 21 veya ustunu ister.
    echo Kur: https://adoptium.net  ^(Temurin 21, Windows x64 .msi^)
    echo Kurduktan sonra YENI bir pencerede tekrar calistir.
    echo Hicbir sey gonderilmedi.
    pause
    exit /b 1
)
java -version
echo Ilk calistirmada emulator ~60 MB indirir ve bir sure ciktisiz bekleyebilir.

call npx --yes firebase-tools@15.28.2 emulators:exec --only firestore --project ers-card-game "node tools/firestore-rules-test.mjs"
if errorlevel 1 (
    echo.
    echo KURAL TESTI DUSTU. Hicbir sey gonderilmedi.
    echo Ciktiyi oldugu gibi bana getir -- tahmin etmiyoruz.
    pause
    exit /b 1
)

echo.
echo === Gonderilecek kurallar: %CD%\firestore.rules ===
echo.
type firestore.rules
echo.
echo -------------------------------------------------------------------
echo  Yukaridaki kurallar Firebase konsolundaki MEVCUT kurallarin YERINE
echo  gecer. Konsolda elle yapilmis ve bu dosyaya islenmemis bir duzenleme
echo  varsa KAYBOLUR.
echo.
echo  Konsol:
echo  https://console.firebase.google.com/project/ers-card-game/firestore/rules
echo -------------------------------------------------------------------
echo.

set /p ONAY="Devam etmek icin DEPLOY yazin (baska bir sey iptal eder): "
if /i not "%ONAY%"=="DEPLOY" (
    echo.
    echo Iptal edildi. Hicbir sey gonderilmedi.
    pause
    exit /b 0
)

echo.
echo === Skor sinirlari kod ile ayni mi ===
call node tools\check-score-bounds.mjs
if errorlevel 1 (
    echo.
    echo Sinirlar ayristi. Deploy iptal edildi -- once bunu duzeltin.
    pause
    exit /b 1
)

echo.
echo === Firestore kurallari gonderiliyor ===
REM  Surum sabit ve --non-interactive -- gerekcesi deploy.bat ile ayni:
REM  "@latest" her seferinde registry'ye gidiyor, yeni surumde sessizce
REM  ~40 MB indiriyor ve donmus gibi gorunuyor; etkilesimli mod ise
REM  gorunmeyen bir soruda sonsuza kadar bekleyebiliyor.
call npx --yes firebase-tools@15.28.2 deploy --only firestore:rules --project ers-card-game --non-interactive
if errorlevel 1 (
    echo.
    echo DEPLOY BASARISIZ.
    echo Giris yapmadiysaniz once:  npx firebase-tools login
    pause
    exit /b 1
)

echo.
echo Bitti. Kontrol: Gunluk Meydan Okuma'yi bir kez oynayin, panele donun.
echo Tabloda kendi adinizi goruyorsaniz zincir uctan uca calisiyor.
echo.
pause
