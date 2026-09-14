@echo off
REM ============================================================
REM  commit.bat -- v3.15.0 + v3.15.1 calismasini kayda gecirir.
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat commit ATMAZ (bilerek --
REM  yayina almak ile kayda gecirmek ayri kararlardir), ve
REM  Claude'un bu makinede git calistirma yolu 8 Eylul Windows
REM  guncellemesinden beri kapali. Yani bu iki surum diske
REM  yazildi, kurallar canliya gitti, hosting yayina girdi, ama
REM  git agacinda hala "degismis dosya" olarak duruyor.
REM
REM  IKI SURUM TEK COMMIT: v3.15.1, v3.15.0'in canlida acilan
REM  tek yarasini kapatiyor. Ayri commit'ler tarihte "kurali
REM  siktiran ama uygulamasi kirik" bir ara nokta birakirdi;
REM  oyle bir nokta olmasin diye birlikte giriyorlar.
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
 -m "security: v3.15.0 -- a lobby write was allowed to decide that it was allowed" ^
 -m "The shipped rule for lobbyRooms ended with two clauses reading newData -- the data being WRITTEN. A write that put your uid in hostId, or in playerIds, satisfied the check whose job is to decide whether you may write at all. Any signed-in user could overwrite any table: one they had never joined, one in the middle of a match, and gameState.roomId with it, which is the field every other client follows into the game room. The table code travels in an invite link, so it is not a secret." ^
 -m "The rule is now three branches, because a lobby write is three different acts. CREATE (no data): only a table you host. DELETE (no newData): the host, or anyone seated. UPDATE: host, or seated, or a genuine join while the table is still waiting -- and the table id must survive it, and whoever the write names as host must be seated. Authority is read from data; newData only answers whether this is a join. gameRooms and presence are deliberately untouched." ^
 -m "New gate, the first in this project that RUNS the rules instead of reading them: tools/rules-test.mjs, against the real Database emulator, over REST, with no new dependencies. It proves itself before it judges anything -- if the forged token stopped being accepted, every assertion below would pass vacuously, so that is checked first and named. 17 scenarios written as sentences about the game, not about booleans. 6 mutants: 5 caught, 1 declared EQUIVALENT with its reason, and a declared equivalence that turns out to be catchable fails the gate instead of hiding. tools/lobby-rule.mjs is the single source of the expression, so the JSON, the emulator harness and the always-run suite cannot drift. deploy-db-rules.bat runs the gate first and refuses to deploy if it is red." ^
 -m "Three runs, three findings, none of them churn. (1) The emulator has two authority channels: ?auth= is the data plane, the endpoints that change rules want an Authorization header. The harness now PROBES the channel and prints which one won, rather than inheriting a guess. (2) An unknown namespace is created on demand with OPEN rules, so a typo there would not fail, it would silently test nothing -- the namespace is now the project default. (3) The surviving mutant was equivalent, not escaped: every authorising clause already reads auth.uid, so the leading auth != null decides nothing on its own. That reason is now a checked property in test section 64, not a sentence in a comment." ^
 -m "v3.15.1 -- the rule was right; the app asked twice. Leaving the table as host raised PERMISSION_DENIED on the first press and worked on the second. leaveTable made two writes for one transition: handlePlayerDisconnect had already migrated the host and, in the waiting room, already removed us from players -- and then the old code wrote the table AGAIN, from a client the table no longer contained. The new rule refused that second write, correctly. Both branches now re-read the table and return if we are no longer seated, so one press does one write." ^
 -m "That bug is also the honest boundary of the new gate, written down rather than glossed: the emulator gate tests the RULE against hand-written writes, not the APP's sequence of writes. It could not have caught this, and it did not. Three mutations of the two guards were run and all three caught, and section 64 pins the guards statically -- but closing the class properly means wiring smoke to the emulator, which is its own piece of work and is not in this commit." ^
 -m "HONEST LIMIT, pinned by a test so this is not read as more than it is: gameRooms is UNCHANGED. Every seated player can still write the whole room -- another player's hand, the pile, winnerId. Making that host-authoritative introduces a single point of failure that does not exist today (a backgrounded host tab stalls the match) and a host-migration deadlock, so it deserves its own round. What closed here is lobby takeover. What remains: someone who knows the six-character code can still scramble a waiting room." ^
 -m "Also in the tree, from the same stretch: the Slap IQ ad box moved out of the button row -- flex: 0 0 auto is correct in a column and fatal in a row, my own v3.14.3 fix caused that regression, and section 63 now fails if an ad box is ever put back into a flex row -- plus .gitattributes pinning * -text so git cannot rewrite line endings under the md5-verified file sync, and a firebase.json emulators block (CSP untouched)." ^
 -m "2141 tests, 9 source gates, smoke green; rules gate 24/24 on the emulator; both releases live." ^
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
