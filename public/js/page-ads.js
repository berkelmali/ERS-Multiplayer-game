/**
 * page-ads.js — the ad loader for the generated rules and about pages (v3.24.1,
 * council ERS-38).
 *
 * Those pages run no inline script: the Content-Security-Policy refuses it, and
 * that policy has broken this site three times. So the one line AdSense asks a
 * page to run — `(adsbygoogle = window.adsbygoogle || []).push({})` — lives here,
 * in a file the policy admits as 'self'.
 *
 * A box is shown only once Google's tag has actually loaded, and only then is
 * its unit requested. Until then — and for good if an ad blocker refuses the
 * tag, or scripts are off — the page is exactly the reading page it was, with
 * no labelled empty box on it. A unit Google answers with nothing is hidden by
 * the page's own stylesheet (data-ad-status="unfilled").
 *
 * The publisher id is read from the unit the page carries, which the generator
 * wrote from public/js/adsConfig.js; this file holds no id of its own.
 */
(function () {
    'use strict';
    var boxes = document.querySelectorAll('.ad-box');
    if (!boxes.length) return;
    var first = boxes[0].querySelector('ins.adsbygoogle');
    var client = first ? first.getAttribute('data-ad-client') : '';
    if (!/^ca-pub-\d{10,}$/.test(client || '')) return;

    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    s.addEventListener('load', function () {
        for (var i = 0; i < boxes.length; i++) {
            // Shown BEFORE the push: a unit in a display:none box has no width,
            // and AdSense refuses a zero-width slot for good.
            boxes[i].classList.add('on');
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
                // A refused or failed unit is never worth breaking a page over.
            }
        }
    });
    document.head.appendChild(s);
})();
