@echo off
REM ===================================================================
REM  ERS - Realtime Database guvenlik kurallari deploy
REM
REM  Cift tikla ya da bu klasorde calistir:  deploy-db-rules.bat
REM
REM  NEDEN AYRI BIR DOSYA. Bu projede uc ayri deploy var ve ucu de
REM  bilincli olarak ayri:
REM      deploy.bat        ..  SADECE hosting
REM      deploy-rules.bat  ..  SADECE firestore kurallari
REM      deploy-db-rules   ..  SADECE realtime database kurallari  (bu dosya)
REM  Kural deploy'u canli veri erisimini degistirir. Yanlis dosya giderse
REM  ya masa kilitlenir (kimse yazamaz, cok oyunculu tamamen olur) ya da
REM  acilir. Hosting ile ayni komuta binmemesinin sebebi bu.
REM
REM  VE BU DOSYA TESTSIZ DEPLOY ETMEZ. Asagidaki kapi, kurallari GERCEK
REM  Firebase emulator'unde calistirir; ayrica kurallarin kasten bozulmus
REM  kopyalarini da calistirip testin onlari YAKALADIGINI olcer. Kapi
REM  dusekse deploy hic baslamaz.
REM
REM  ILK CALISTIRMA: emulator ~30 MB'lik bir Java jar indirebilir ve
REM  ekranda ciktisiz bekleyebilir. Java gerekir (java -version).
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo ===================================================================
echo  1/3  KURAL TESTI (gercek emulator)
echo ===================================================================
echo.
call npx --yes firebase-tools@15.28.2 emulators:exec --only database --project ers-card-game "node tools/rules-test.mjs"
if errorlevel 1 (
    echo.
    echo KURAL TESTI DUSTU. Hicbir sey gonderilmedi.
    echo Ciktiyi oldugu gibi bana getir -- tahmin etmiyoruz.
    pause
    exit /b 1
)

echo.
echo ===================================================================
echo  2/3  GONDERILECEK DOSYA
echo ===================================================================
echo.
type database.rules.json
echo.
echo -------------------------------------------------------------------
echo  Bu dosya Firebase konsolundaki MEVCUT realtime database
echo  kurallarinin YERINE gecer. Konsolda elle yapilmis ve bu dosyaya
echo  islenmemis bir duzenleme varsa KAYBOLUR.
echo.
echo  Once konsolu ac ve karsilastir:
echo  https://console.firebase.google.com/project/ers-card-game/database/ers-card-game-default-rtdb/rules
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
echo ===================================================================
echo  3/3  GONDERILIYOR
echo ===================================================================
call npx --yes firebase-tools@15.28.2 deploy --only database --project ers-card-game --non-interactive
if errorlevel 1 (
    echo.
    echo DEPLOY BASARISIZ.
    echo Giris yapmadiysaniz once:  npx firebase-tools login
    pause
    exit /b 1
)

echo.
echo Bitti.
echo.
echo DEPLOY SONRASI KONTROL -- bunlar sadece canlida dogrulanabilir:
echo   - Masa kur. Kurulmali.
echo   - Ikinci bir hesapla kodla katil. Katilabilmeli.
echo   - Host cikinca masa ikinci oyuncuya gecmeli (host devri).
echo   - Maci baslat. Baslamali.
echo   - Masadan cik. Cikabilmeli.
echo  Bunlardan BIRI bile "permission denied" derse kurali geri al:
echo  konsolda onceki surumu geri yukle, sonra ciktiyi bana getir.
echo.
pause
