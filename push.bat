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

REM v3.22.5: commit edilmemis degisiklik varsa commit.bat unutulmustur.
set "ERS_DIRTY="
for /f "delims=" %%L in ('git status --porcelain') do set "ERS_DIRTY=1"
if defined ERS_DIRTY (
    echo.
    echo !!! Commit edilmemis degisiklik var:
    git status --short
    echo.
    echo     Once commit.bat calistir, sonra bu dosyayi. Hicbir sey gonderilmedi.
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

for /f %%N in ('git rev-list --count origin/main..HEAD') do set "ERS_AHEAD=%%N"
if "%ERS_AHEAD%"=="0" (
    echo.
    echo Gonderilecek yeni commit yok -- GitHub zaten guncel.
    pause
    exit /b 0
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

REM v3.22.5: gecmis yalnizca Berk Elmali'nin; imza satiri ve yabanci yazar yok.
git log origin/main..HEAD --format=%%B > "%TEMP%\ers_push_msgs.txt"
findstr /i /c:"Co-Authored-By" /c:"noreply@anthropic.com" /c:"Generated with" /c:"claude.com" "%TEMP%\ers_push_msgs.txt" >nul
if not errorlevel 1 (
    echo.
    echo !!! DUR: gidecek bir commit mesajinda imza satiri var:
    findstr /i /c:"Co-Authored-By" /c:"noreply@anthropic.com" /c:"Generated with" /c:"claude.com" "%TEMP%\ers_push_msgs.txt"
    del "%TEMP%\ers_push_msgs.txt" >nul 2>&1
    echo     Hicbir sey gonderilmedi. Bana getir.
    pause
    exit /b 1
)
del "%TEMP%\ers_push_msgs.txt" >nul 2>&1
REM Exact comparison per commit. (findstr /x cannot be used here: git ends
REM lines with LF only, and findstr's whole-line match needs CR -- it refused
REM a correct commit on the first run.)
set "ERS_BAD_AUTHOR="
for /f "delims=" %%A in ('git log origin/main..HEAD "--format=%%ae"') do (
    if /i not "%%A"=="berk9elmali9@gmail.com" set "ERS_BAD_AUTHOR=%%A"
)
if defined ERS_BAD_AUTHOR (
    echo.
    echo !!! DUR: yazari Berk Elmali olmayan commit var ^(%ERS_BAD_AUTHOR%^):
    git log origin/main..HEAD --format="%%h %%an <%%ae> %%s"
    echo     Hicbir sey gonderilmedi.
    pause
    exit /b 1
)
echo   Imza satiri yok, yazar Berk Elmali -- tamam.

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
