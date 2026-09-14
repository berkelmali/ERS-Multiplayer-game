@echo off
REM ============================================================
REM  commit.bat -- v3.14.3 + v3.14.4 calismasini kayda gecirir.
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat commit ATMAZ (bilerek --
REM  yayina almak ile kayda gecirmek ayri kararlardir), ve
REM  Claude'un bu makinede git calistirma yolu 8 Eylul Windows
REM  guncellemesinden beri kapali. Yani bu iki surum diske
REM  yazildi, yayina gitti, ama git agacinda hala "degismis
REM  dosya" olarak duruyor.
REM
REM  NOT: cmd.exe heredoc DESTEKLEMEZ, o yuzden mesaj coklu -m
REM  ile veriliyor. Her -m bir paragraf olur.
REM ============================================================
setlocal
cd /d "%~dp0"

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

git add -A

git commit ^
 -m "fix: v3.14.3 + v3.14.4 -- a clipped ad, and a button that left the panel" ^
 -m "v3.14.3: the in-column banner asked for the wrong shape. Measured live at 375px, the host box was 343 x 53 with overflow hidden while the unit AdSense built was 375 x 375 starting at x=0 -- the ad would have lost 326px off the bottom and 16px off each side the moment Google returned a real creative. The tag writes height:auto and min-height:0 as inline important onto our own container when a responsive unit goes full width, so min-height was never the guarantee it looked like. The banner now asks for a horizontal shape with full-width-responsive false, and the box carries flex 0 0 auto plus overflow visible, so a column cannot squash it and nothing gets hidden." ^
 -m "v3.14.4: and that fix broke a row. .slapiq-actions is a flex ROW, and the ad box had been sitting BETWEEN its two buttons since v3.0.0. In a row the box width of 100 percent is a WIDTH: 190 + 558 + 111 against 558px of space. It never showed because the box could still shrink -- until v3.14.3 told it not to, and the Back button landed 294px outside the panel, 305px on a phone, i.e. off screen entirely. The fix is in the markup, not the CSS: the ad box is now a child of the panel column, between the content and the button row, like every other panel." ^
 -m "Two new checks: test section 63 walks the markup and asserts no ad box has a flex-row parent (4 mutants, 4 caught); smoke opens all eight panels and asserts nothing hangs outside its own box, intersecting with clipping ancestors first so the shop shimmer is not a false alarm. 2079 tests, 9 source gates, smoke green." ^
 -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" ^
 -m "Claude-Session: https://claude.ai/code/session_017harRa9aGfvK83QPxoAVxt"

if errorlevel 1 (
    echo.
    echo !!! Commit BASARISIZ. Yukaridaki hatayi bana getir.
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
