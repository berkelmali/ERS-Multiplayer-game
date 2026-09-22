@echo off
REM ============================================================
REM  commit.bat -- v3.16.8 .. v3.18.0 ve depo guvenligini kayda gecirir.
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat commit ATMAZ (bilerek --
REM  yayina almak ile kayda gecirmek ayri kararlardir).
REM
REM  MESAJ .commit-msg.txt DOSYASINDA. Eskiden coklu -m ile veriliyordu;
REM  mesaj 9770 karaktere ulasti ve cmd.exe bir komutu 8191'de keser.
REM  Ilk calistirmanin "pathspec '^'" hatasi buydu.
REM
REM  DEPO HERKESE ACIK. Bu yuzden iki kapi var:
REM   1. .githooks\pre-commit -- her commit'te, hangi aractan olursa
REM      olsun, kimlik dosyasini ve anahtara benzeyen satiri reddeder.
REM   2. Asagidaki dosya adi kapisi -- ayni seyi burada da sorar.
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist ".commit-msg.txt" (
    echo !!! .commit-msg.txt yok. Commit mesaji olmadan devam edilmez.
    pause
    exit /b 1
)

if exist ".git\index.lock" (
    echo.
    echo !!! .git\index.lock var: baska bir git islemi acik ya da yarida kalmis.
    echo     VS Code / GitHub Desktop aciksa kapat. Hicbiri acik degilse
    echo     .git\index.lock dosyasini sil ve tekrar calistir.
    pause
    exit /b 1
)

echo.
echo === Su anki durum ===
git status --short
echo.
echo === Son 3 kayit ===
git log --oneline -3
echo.
echo ============================================================
echo Yukaridaki dosyalar TEK bir commit'e girecek.
echo Devam icin bir tusa bas; vazgecmek icin pencereyi kapat.
echo ============================================================
pause >nul

REM ------------------------------------------------------------
REM  HOOK KAPISI. core.hooksPath .githooks'u gostermiyorsa
REM  pre-commit hic calismaz ve bunu kimse fark etmez.
REM ------------------------------------------------------------
git config core.hooksPath .githooks
for /f "delims=" %%H in ('git config core.hooksPath') do set "ERS_HOOKS=%%H"
if /i not "%ERS_HOOKS%"==".githooks" (
    echo !!! core.hooksPath ayarlanamadi. Commit ATILMADI.
    pause
    exit /b 1
)
echo   pre-commit kapisi devrede -- tamam.

REM ------------------------------------------------------------
REM  GIZLI DOSYA KAPISI. .gitignore yalnizca IZLENMEYEN dosyalari
REM  susturur; bir kez commit'e giren dosya sonradan cikmaz.
REM ------------------------------------------------------------
echo.
echo === Gizli dosya kapisi ===
git ls-files --error-unmatch public/js/firebaseConfig.js >nul 2>&1
if not errorlevel 1 (
    echo.
    echo !!! DUR: public/js/firebaseConfig.js git tarafindan IZLENIYOR.
    echo     Cikar, sonra tekrar calistir:
    echo         git rm --cached public/js/firebaseConfig.js
    pause
    exit /b 1
)
echo   firebaseConfig.js izlenmiyor -- tamam.

git add -A
if errorlevel 1 (
    echo.
    echo !!! git add BASARISIZ. Sahne bos; kapilar bos bir sahneyi
    echo     "temiz" sayardi, o yuzden burada duruluyor.
    pause
    exit /b 1
)

git diff --cached --name-only > "%TEMP%\ers_staged.txt"
findstr /i /c:"firebaseConfig.js" /c:"serviceAccount" /c:"service-account" /c:"adminsdk" /c:"credential" /c:".env" "%TEMP%\ers_staged.txt" >nul
if not errorlevel 1 (
    echo.
    echo !!! DUR: sahnelenen dosyalar arasinda kimlik bilgisi tasiyabilecek
    echo     bir dosya var. Liste:
    findstr /i /c:"firebaseConfig.js" /c:"serviceAccount" /c:"service-account" /c:"adminsdk" /c:"credential" /c:".env" "%TEMP%\ers_staged.txt"
    echo.
    echo     Sahne temizlendi, commit ATILMADI.
    git reset >nul
    del "%TEMP%\ers_staged.txt" >nul 2>&1
    pause
    exit /b 1
)
del "%TEMP%\ers_staged.txt" >nul 2>&1
echo   Sahnede kimlik dosyasi yok -- tamam.
echo.

git commit -F .commit-msg.txt
if errorlevel 1 (
    echo.
    echo !!! Commit BASARISIZ. Yukaridaki hatayi bana getir.
    echo     pre-commit REFUSED dediyse: o dosya depoya GIRMEMELI.
    git reset >nul 2>&1
    pause
    exit /b 1
)

echo.
echo === Yeni durum ===
git log --oneline -3
echo.
echo Kayit atildi. Bu commit SADECE yerelde -- push edilmedi.
echo Uzak sunucuya gondermek istersen ayri komut:  git push
echo.
pause
