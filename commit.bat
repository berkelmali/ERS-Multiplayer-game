@echo off
REM ============================================================
REM  commit.bat -- v3.16.0 + v3.16.1 + v3.16.2 calismasini
REM  kayda gecirir.
REM
REM  NEDEN AYRI BIR DOSYA: deploy.bat commit ATMAZ (bilerek --
REM  yayina almak ile kayda gecirmek ayri kararlardir), ve
REM  Claude'un bu makinede git calistirma yolu 8 Eylul Windows
REM  guncellemesinden beri kapali. Yani bu uc surum diske
REM  yazildi, hosting yayina girdi, ama git agacinda hala
REM  "degismis dosya" olarak duruyor.
REM
REM  UC SURUM TEK COMMIT: v3.16.1 ve v3.16.2, v3.16.0'in canlida
REM  acilan iki yarasini kapatiyor. Ayri commit'ler tarihte
REM  menude ayni hedefi iki kere gosteren, ve 12 sayfayi
REM  onbellege birakan ara noktalar birakirdi; oyle noktalar
REM  olmasin diye birlikte giriyorlar.
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
REM  GIZLI DOSYA KAPISI.
REM  .gitignore firebaseConfig.js'i disarida tutuyor, AMA gitignore
REM  yalnizca IZLENMEYEN dosyalari susturur. Bir dosya bir kere
REM  commit'e girdiyse, sonradan gitignore'a yazmak onu geri
REM  cikarmaz -- git add -A onu yine sahneler. Bu yuzden burada
REM  inanmak yerine SORULUYOR.
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
 -m "seo: v3.16.0 -- the site had navigation for people and none for crawlers" ^
 -m "AdSense refused the site for 'insufficient content or content quality'. The stated bar is enough valuable content and good navigational elements, so before writing a word of new content I measured what a fetcher actually receives. index.html contained zero anchors. The rules, the about text and the privacy policy were all there, in localization.js, in four languages -- but they lived behind click handlers on buttons, inside panels toggled by a CSS class. A crawler runs no click handlers. It saw one page. Worse, firebase.json rewrote every unmatched path to /index.html, so a typo answered 200 OK with the whole game: an unlimited supply of duplicates of the single page it could already see." ^
 -m "The fix is generated, not written. tools/build-content-pages.mjs reads the panel structure out of index.html and the text out of localization.js and emits 12 pages -- rules, about and privacy in en, tr, de and ru. There is no second copy of the rules anywhere in this repo; change the dictionary and the pages change with it, or the drift gate fails the build. The generator parses with a balanced-tag scanner rather than a regex, because a bare regex takes the FIRST close tag and silently truncates a nested section. Each page carries a complete self-referencing hreflang set, a canonical, and the site's own type scale." ^
 -m "Two findings the generator made about itself on its first run, both kept as permanent checks. (1) The dictionary was being read lazily, and Localization.get reads a mutable module-level currentLang -- it answers in whatever language was set LAST, so all four languages came out identical. Values are now snapshotted per language, and a probe throws if rWinTitle is not different in all four. (2) The CLI wrote files at import time; the test suite imports this module, so running the tests would have regenerated the 12 files and the drift gate could never have gone red. It is now behind a pathToFileURL run-directly guard -- comparing import.meta.url against argv[1] directly is always false on Windows." ^
 -m "Around them: public/404.html, so an unmatched path is a real 404 with links back to somewhere real instead of a 200 that looks like a duplicate; sitemap.xml generated from the same list as the pages; robots.txt pointing at it; and the catch-all rewrite deleted. Nothing depended on that rewrite -- the invite link is /?join=CODE, a query on the root, not a path." ^
 -m "v3.16.1 -- the menu offered the same three destinations twice, and that was mine. v3.16.0 added a three-link footer nav to a menu that already had About and Privacy controls, so the live page read About, Privacy, Game Rules, About, Privacy. Reported from a screenshot with the duplicates underlined. The nav is deleted; instead the two controls that were already there became real anchors pointing at the generated pages, with preventDefault in the handlers so a normal click still opens the in-app panel and a middle click opens the page. Those two are now the only anchors in the document. The gate written for this catches the class, not the instance: no two controls in the menu may carry the same label." ^
 -m "Same release, second report: /tr/rules looked far worse than the rules tab inside the game. True -- I had dressed the generated pages in a generic dark stylesheet of my own. They are now built from style.css's own tokens: the same Outfit weights from the same Google Fonts URL, the same panel background and hairline border, the same section fill and radius, the Egyptian artwork behind them. A gate compares the generated design tokens against style.css, so changing the site theme fails the build until the pages follow. One bug found while doing it: the artwork was fetching 200 and was never visible -- body carried an opaque background, which paints over a negative-z-index ::before. The ground moved to html and body went transparent." ^
 -m "v3.16.2 -- a cache rule that reads correctly and matches nothing. firebase.json sent no-store to the HTML glob, and that is the header Hosting matches against the REQUEST path. cleanUrls is on, so these pages are requested extensionless, as /tr/rules: a glob ending in .html could not match them. Twelve pages generated from a dictionary that will keep changing were the only pages on the site a CDN was free to hold. A rule keyed on the language and slug lists now covers them, and section 65 fails if the generator's lists ever grow past what that rule spells out." ^
 -m "The gates. deploy.bat is 12 now: 10/12 regenerates the pages and fails if the tree differs from a fresh generation, 11/12 runs tools/check-links.mjs, 12/12 deploys. check-links.mjs had been sitting in this repo since August and deploy.bat had NEVER called it -- on its first-ever execution it found that all 12 generated pages were requesting /assets/favicon.png, a file that does not exist. It now understands cleanUrls, so /en/rules resolves to en/rules.html rather than reading as a broken link. Test section 65 covers the rest: pages exist per language and carry that language's text, hreflang complete and self-referencing, sitemap matches disk, no catch-all rewrite, hosting keys inside firebase-tools' own schema allow-list, design tokens match style.css, both handlers preventDefault." ^
 -m "One correction inside section 65 is worth naming, because it is this project's recurring defect in its purest form. The cache-header gate held its own hardcoded list of languages eight lines above the thing it was checking, so adding a fifth language would have passed a gate whose entire job is to notice a fifth language. A gate whose expectation is a copy of the thing it checks is not a gate. The lists are now imported from the generator; the same mutation breaks 12 tests." ^
 -m "Two measurement failures from this stretch, recorded because the conclusions were only as good as the instrument. I read firebase-tools' hosting schema truncated to the first 12 of 15 keys and briefly called a valid key a violation. And after shipping v3.16.2 I fetched the site root, was told v3.15.1, and diagnosed a stale CDN -- but that path has carried no-store for months and cannot be cached, so the stale thing was my own fetch. That diagnosis was retracted. The v3.16.2 fix itself stands because it was read out of firebase.json, not out of the fetch." ^
 -m "HONEST LIMIT. The adversarial council returned PARTIALLY DEFENSIBLE (Strong, 3-2) on this work, and the objection it accepted no answer to is the one Google actually wrote: they said content, and what I built is navigation. 8 of the 12 pages are under 350 words and four of them are translations of the other four. Crawlability was a real defect and it is fixed -- but a crawler that can now reach twelve thin pages has been given access, not substance. The content round is the answer and it is not in this commit. The generator is in place precisely so that round is a dictionary edit." ^
 -m "2344 tests, 12 source gates, smoke green; all three releases live." ^
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
