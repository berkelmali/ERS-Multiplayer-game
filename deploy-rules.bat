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
REM "type" ciktisi bozuk gorunur (ÔÇö gibi). Sadece EKRANI etkiler, gonderilen
REM dosyayi degil -- ama okunamayan bir onay ekrani onay ekrani sayilmaz.
chcp 65001 >nul

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
REM  Sürüm sabit ve --non-interactive — gerekçesi deploy.bat ile aynı:
REM  "@latest" her seferinde registry'ye gidiyor, yeni sürümde sessizce
REM  ~40 MB indiriyor ve donmuş gibi görünüyor; etkileşimli mod ise
REM  görünmeyen bir soruda sonsuza kadar bekleyebiliyor.
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
