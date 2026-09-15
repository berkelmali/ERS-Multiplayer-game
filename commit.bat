@echo off
REM ============================================================
REM  commit.bat -- v3.16.4, v3.16.5, v3.16.6 ve v3.16.7'yi kayda gecirir.
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat commit ATMAZ (bilerek --
REM  yayina almak ile kayda gecirmek ayri kararlardir), ve
REM  Claude'un bu makinede git calistirma yolu 8 Eylul Windows
REM  guncellemesinden beri kapali.
REM
REM  BU COMMIT'TE KONSEY TUTANAGI DA VAR: COUNCIL-v3.16.5.md.
REM  v3.16.5'in ILK hali konseyde oldu -- link tarihi tasiyordu
REM  ama uygulama yine BUGUNUN tahtasini aciyordu. Puansiz tekrar
REM  o itirazin cevabidir; tutanak neden boyle oldugunu tasir.
REM
REM  v3.16.7 site baytlarina DOKUNMAZ: sadece deploy.bat'in kendi
REM  notlarinin sirasini ve girintisini onarir. Surum bumplanmadi.
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

REM ------------------------------------------------------------
REM  GIZLI DOSYA KAPISI. .gitignore firebaseConfig.js'i disarida
REM  tutuyor, AMA gitignore yalnizca IZLENMEYEN dosyalari susturur.
REM  Bir dosya bir kere commit'e girdiyse sonradan gitignore'a
REM  yazmak onu geri cikarmaz. Bu yuzden burada inanmak yerine
REM  SORULUYOR.
REM ------------------------------------------------------------
echo.
echo === Gizli dosya kapisi ===
git ls-files --error-unmatch public/js/firebaseConfig.js >nul 2>&1
if not errorlevel 1 (
    echo.
    echo !!! DUR: public/js/firebaseConfig.js git tarafindan IZLENIYOR.
    echo     Bu dosya canli Firebase kimlik bilgilerini tasiyor.
    echo     Cikar, sonra tekrar calistir:
    echo         git rm --cached public/js/firebaseConfig.js
    pause
    exit /b 1
)
echo   firebaseConfig.js izlenmiyor -- tamam.

git add -A

git diff --cached --name-only > "%TEMP%\ers_staged.txt"
findstr /i /c:"firebaseConfig" /c:"serviceAccount" /c:"service-account" /c:"credential" /c:".env" "%TEMP%\ers_staged.txt" >nul
if not errorlevel 1 (
    echo.
    echo !!! DUR: sahnelenen dosyalar arasinda kimlik bilgisi tasiyabilecek
    echo     bir dosya var. Liste:
    findstr /i /c:"firebaseConfig" /c:"serviceAccount" /c:"service-account" /c:"credential" /c:".env" "%TEMP%\ers_staged.txt"
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

git commit ^
 -m "feat: v3.16.4-v3.16.7 -- rails to the window edge, a share button that actually shares a board, and the repair of the file that reports all of it" ^
 -m "v3.16.4: the ad rails sat 24px off a 600px column, which put them in the middle of a wide window instead of at its edge. They are now anchored to the viewport (left: 24px / right: 24px). The gate that covers this does not hold a typed number: it reads RAIL_MIN_WIDTH, the column width, the inset and the rail width out of style.css and DERIVES the clearance, so a future change to any one of them moves the assertion with it. v3.16.2 shipped a gate carrying its own hardcoded copy of the thing it checked and the one mutation it existed to catch went straight through; that is the mistake this shape exists to not repeat." ^
 -m "v3.16.5: 'Challenge a friend' sent a brag plus a link to the homepage. The brag is a number of cards taken, and a number of cards taken is only a comparable claim on the Daily Challenge, where every player is dealt the same position from the same seed. The link now carries that day: /?daily=YYYY-MM-DD, read at boot from location.search." ^
 -m "THE COUNCIL'S FATAL OBJECTION, and it killed the proposal as submitted: the link carried the date but the code opened TODAY'S board regardless. People open messages hours later -- usually the next day -- so the late click is not the edge case, it is the product, and the version submitted would have handed those players a different deal from the one the message described. A link that does not lead to your game, dressed up as a challenge. So a past date now arms an UNSCORED REPLAY of that exact board, offered beside today's." ^
 -m "The dangerous edge is precise: a replayed board recorded under today's key costs the player their real daily attempt, and cannot be undone that day -- worse than the defect being fixed. Two properties carry it and both are pinned statically in gate 67 rather than read by eye: this.scored = board ? false : ... and if (!board) this.refreshDate(); -- refreshDate is what moves dateKey, so skipping it for a replay is the whole guard. COUNCIL-v3.16.5.md: PARTIALLY DEFENSIBLE (Strong, 4-1), five conditions. Condition 4 says the two share buttons were NOT merged: canShare({files}) is false on most desktop browsers, so the merged control's normal desktop behaviour would have been a fallback doing two different things from one press. Condition 5 says claim coherence, not conversion -- there is no analytics in this project, so no outcome claim survives." ^
 -m "v3.16.6: the v3.16.5 deploy went green and then printed '---' is not recognized as an internal or external command, seven times, at the operator. Nothing on the site broke, which is exactly the point -- the file whose ONE job is to say what changed was garbling that job while the other eleven gates stayed green. Cause: I anchored an insertion on the TEXT of a line instead of the WHOLE line, so the insert landed mid-line and orphaned the second half; cmd read the orphan as a command. Gate 68 now classifies every line in deploy.bat: each one is blank or begins with a command. The list is a whitelist on purpose -- it will fail the day someone uses a cmd verb it does not name, and the alternative, guessing which indented text is obviously prose, is how the defect got in." ^
 -m "v3.16.7: THE REPAIR ITSELF WAS INCOMPLETE, and the gate could not see it. Prefixing echo to each orphan made every line executable and gate 68 went green -- but the split had also MOVED blocks, so the file still printed its notes in the wrong order: notes 124-126 sat under the AdSense checklist, and the tail of the v3.16.0 checklist (language picker, /de/about, 404, sitemap, robots) had fallen below v3.16.5's block with three lines of lost indentation. Executability and order are two properties; the gate measured one. The new measurement is the property that was actually violated: note numbers must INCREASE down the file -- 137, 138, 124, 125, 126 is not a sequence, it is a moved block -- plus every header at the same indent. The blocks were put back in numeric order." ^
 -m "AND THE FIRST RULE I WROTE FOR THAT GATE WAS FALSE. It said: notes first, then the checklist. The file refused it immediately -- the old DEPLOY SONRASI KONTROL list has sat in the middle of the numbered notes for many releases and belongs there. So the gate was fitted to the file; the file was not bent to fit the gate. A gate that would force a correct document to move is not a gate, it is a second defect waiting for an author with less patience." ^
 -m "NOT YET CONFIRMED BY THE OPERATOR, and it is the one that matters: the replay must be played end to end on a past date and the panel's stored result for today must be UNCHANGED afterwards. Gate 67 pins the two source properties, not the composed behaviour -- the ERS-14 council asked for a smoke-level test of the whole path and it is not written yet. The ad-blocker/font check from v3.16.3 and the rails-at-1199px check are also still unreported." ^
 -m "2428 tests, 12 source gates, smoke green; v3.16.4-v3.16.6 live, v3.16.7 is operator-file only." ^
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
