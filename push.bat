@echo off
REM ============================================================
REM  push.bat -- yerel commit'leri GitHub'a (main) gonderir.
REM
REM  DEPO HERKESE ACIK: push edilen her sey yayinlanir ve gecmisten
REM  silinmez. O yuzden once gonderilecek TUM araligi tarar
REM  (tools\check-outgoing.mjs): kimlik dosyasi ya da anahtara
REM  benzeyen bir satir varsa HICBIR SEY gitmez.
REM
REM  main'e push GitHub Actions'i tetikler: CI testleri kosar, Deploy
REM  is akisi siteyi yeniden yayinlar (FIREBASE_SERVICE_ACCOUNT ve
REM  FIREBASE_WEB_CONFIG sirlari tanimli degilse o adim kirmizi olur;
REM  canli site ETKILENMEZ).
REM ============================================================
setlocal
cd /d "%~dp0"

if exist ".git\index.lock" (
    echo !!! .git\index.lock var. Acik bir git islemi varsa kapat, yoksa dosyayi sil.
    pause
    exit /b 1
)

echo.
echo === GitHub'daki son durum aliniyor ===
git fetch origin
if errorlevel 1 (
    echo !!! fetch BASARISIZ. Internet ya da GitHub girisi. Hicbir sey gonderilmedi.
    pause
    exit /b 1
)

git merge-base --is-ancestor origin/main HEAD
if errorlevel 1 (
    echo.
    echo !!! GitHub'daki main, yereldeki gecmiste YOK: biri main'e yazmis.
    echo     Zorla ^(force^) gondermiyoruz. Bu ciktiyi bana getir.
    pause
    exit /b 1
)

echo.
echo === Gonderilecek commit'ler ===
git log --oneline origin/main..HEAD
echo.

call node tools\check-outgoing.mjs origin/main HEAD
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Yukaridaki commit'ler GitHub'da main'e gidecek ^(herkese acik^).
echo Devam icin bir tusa bas; vazgecmek icin pencereyi kapat.
echo ============================================================
pause >nul

git push origin HEAD:main
if errorlevel 1 (
    echo.
    echo !!! Push BASARISIZ. Yukaridaki hatayi bana getir.
    pause
    exit /b 1
)

echo.
echo Gonderildi. Actions sekmesinde CI ve CodeQL calismaya basladi:
echo   https://github.com/berkelmali/ERS-Multiplayer-game/actions
echo.
pause
