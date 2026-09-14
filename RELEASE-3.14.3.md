# v3.14.3 — Responsive ad containment

- Responsive menu units request the documented `horizontal` format and disable mobile full-width expansion, keeping them inside the padded menu column.
- Ad hosts no longer shrink inside flex layouts or clip the creative. Natural height survives AdSense's `height:auto!important; min-height:0!important` host writes.
- Fixed 160×600 desktop rails and once-per-screen requests are unchanged. No additional ad requests or new placements were added.
- Browser regression coverage simulates Google's host style changes with both 100px and 375px creatives, checking height, horizontal containment, footer separation and page overflow.
- Package and client cache versions are aligned at 3.14.3.

Validation: `npm run verify` passed (2,065 unit checks plus all structural gates); `npm run smoke` passed 57 browser steps with zero unexpected console errors. The regression test caught a footer overlap on tall phones; the footer now follows a requested banner in normal flow. The general lobby layout and gameplay are unchanged.

Before release, live v3.14.1 returned `data-ad-status="unfilled"` for desktop rails and the mobile banner, with no observed CSP errors. The owner confirmed AdSense site status "Getting ready" and ads.txt status "Not found" on 2026-09-10. The live ads.txt endpoint returned HTTP 200, text/plain and the matching publisher ID; the dashboard status reflects the crawler's last observation. Serving remains subject to Google's site review.

References:
- https://support.google.com/adsense/answer/9183460
- https://support.google.com/adsense/answer/10762946
