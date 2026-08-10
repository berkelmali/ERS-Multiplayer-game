import { Localization } from './localization.js?v=3';

// --- SHAREABLE HIGHLIGHT CARD (v2.9.0) ---
// Renders a single 1080x1080 canvas "highlight card" summarizing a match result
// (win/loss, winner name, best reflex, cards won, and an active win-streak if any),
// then hands it to the OS share sheet via the Web Share API. Falls back to a plain
// image download when navigator.share isn't available (older browsers/desktop).
// No network calls, no new assets — pure canvas drawing, consistent with how
// audioManager.js synthesizes all its SFX instead of shipping audio files.
export const ResultCard = {
    async shareResult({ won, winnerName, bestReflexMs, cardsWon, streak }) {
        if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch (e) { /* non-fatal, canvas falls back to sans-serif */ }
        }

        const canvas = this._render({ won, winnerName, bestReflexMs, cardsWon, streak });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return false;

        const fileName = 'egyptian-rat-screw-result.png';
        const captionKey = won ? 'shareCaptionWin' : 'shareCaptionLose';
        const msLabel = (bestReflexMs != null && bestReflexMs !== 9999) ? bestReflexMs : '---';
        const caption = Localization.get(captionKey).replace('{ms}', msLabel);

        const canShareFiles = typeof File !== 'undefined' && navigator.canShare;
        if (canShareFiles) {
            const file = new File([blob], fileName, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], text: caption });
                    return true;
                } catch (e) {
                    if (e && e.name === 'AbortError') return false; // user cancelled — not an error
                    // Any other failure falls through to the download fallback below.
                }
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    },

    _render({ won, winnerName, bestReflexMs, cardsWon, streak }) {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        const FONT = 'Outfit, sans-serif';

        const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (won) {
            bg.addColorStop(0, '#1a1300');
            bg.addColorStop(1, '#3d2e00');
        } else {
            bg.addColorStop(0, '#150707');
            bg.addColorStop(1, '#2b0f0f');
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const glow = ctx.createRadialGradient(canvas.width / 2, 340, 50, canvas.width / 2, 340, 420);
        glow.addColorStop(0, won ? 'rgba(255,215,0,0.35)' : 'rgba(248,81,73,0.22)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.textAlign = 'center';

        ctx.font = '160px sans-serif';
        ctx.fillText(won ? '🏆' : '💀', canvas.width / 2, 380);

        ctx.fillStyle = won ? '#FFD700' : '#f85149';
        ctx.font = `900 72px ${FONT}`;
        ctx.fillText(Localization.get(won ? 'shareCardWin' : 'shareCardLose'), canvas.width / 2, 500);

        ctx.fillStyle = '#e6edf3';
        ctx.font = `700 46px ${FONT}`;
        ctx.fillText(winnerName || '', canvas.width / 2, 568);

        const stats = [
            { label: Localization.get('shareCardReflex'), value: (bestReflexMs != null && bestReflexMs !== 9999) ? `${bestReflexMs}ms` : '---' },
            { label: Localization.get('shareCardCards'), value: `${cardsWon ?? 0}` }
        ];
        if (streak && streak >= 2) {
            stats.push({ label: Localization.get('shareCardStreak'), value: `${streak}` });
        }

        const boxWidth = 300;
        const totalWidth = stats.length * boxWidth;
        const startX = (canvas.width - totalWidth) / 2 + boxWidth / 2;
        const boxY = 740;

        stats.forEach((s, i) => {
            const x = startX + i * boxWidth;
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x - 130, boxY - 70, 260, 140);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 130, boxY - 70, 260, 140);

            ctx.fillStyle = won ? '#FFD700' : '#58a6ff';
            ctx.font = `900 44px ${FONT}`;
            ctx.fillText(s.value, x, boxY);

            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = `600 20px ${FONT}`;
            ctx.fillText(s.label, x, boxY + 38);
        });

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = `600 26px ${FONT}`;
        ctx.fillText('EGYPTIAN RAT SCREW', canvas.width / 2, canvas.height - 60);

        return canvas;
    }
};
