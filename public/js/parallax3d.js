/**
 * parallax3d.js — CSS 3D + JS Mouse Parallax Ana Menü Animasyonları
 * 
 * Spline Runtime yerine saf CSS/JS ile premium menü hissiyatı:
 *   • Mouse parallax (arka plan ±15px, ön plan ±5px ters yön)
 *   • Yüzen ışık parçacıkları (CSS keyframe)
 *   • Buton hover 3D tilt + neon glow
 *   • Arka plan brightness pulse (hover'da)
 *   • 1sn exit animasyonu (oyuna geçişte)
 * 
 * Mobilde (<769px) tamamen devre dışı — statik arka plan korunur.
 * Reduced Motion ayarı açıksa da devre dışı (bkz. settings.js).
 * 
 * API: init(), dispose(), resume(), onHoverStart(), onHoverEnd(),
 *       onPlayClicked(), setThemeLight()
 */
import { Settings } from './settings.js';

// Parallax yoğunluk ayarları
const BG_SHIFT  = 15;   // Arka plan kayma miktarı (px)
const UI_SHIFT  = 5;    // UI katmanı kayma miktarı (px, ters yön)
const TILT_MAX  = 8;    // Buton 3D eğilme açısı (derece)
const EXIT_MS   = 1000; // Exit animasyonu süresi (ms)

function motionReduced() {
    return !!(Settings.config && Settings.config.reducedMotion);
}

export const Parallax3D = {
    // DOM referansları
    scene: null,
    bgLayer: null,
    uiLayer: null,

    // Durum
    isActive: false,
    isMobile: false,

    // Event listener referansları (cleanup için)
    _boundMouseMove: null,
    _tiltButtons: [],

    // ─── INIT ───────────────────────────────────
    init() {
        // Mobil koruma
        this.isMobile = window.innerWidth < 769;
        if (this.isMobile || motionReduced()) {
            console.log('[Parallax3D] Devre dışı (mobil veya azaltılmış hareket ayarı).');
            return;
        }

        this.scene   = document.getElementById('parallax-scene');
        this.bgLayer = document.getElementById('parallax-bg');
        this.uiLayer = document.getElementById('main-menu');

        if (!this.scene || !this.bgLayer) {
            console.warn('[Parallax3D] Parallax elementleri bulunamadı.');
            return;
        }

        // Sahneyi göster
        this.scene.classList.remove('parallax-hidden');
        document.body.classList.add('parallax-active');
        this.isActive = true;

        // Mouse parallax dinleyicisi
        this._boundMouseMove = this._onMouseMove.bind(this);
        window.addEventListener('mousemove', this._boundMouseMove);

        // Buton 3D tilt binding
        this._bindButtonTilt();

        console.log('[Parallax3D] Parallax sahne aktif.');
    },

    // ─── MOUSE PARALLAX ─────────────────────────
    _onMouseMove(e) {
        if (!this.isActive) return;

        // Normalize mouse: -1 → +1
        const cx = (e.clientX / window.innerWidth  - 0.5) * 2;
        const cy = (e.clientY / window.innerHeight - 0.5) * 2;

        // Arka plan: mouse yönünde ±15px (CSS transition ile yumuşatılır)
        if (this.bgLayer) {
            this.bgLayer.style.transform =
                `translate3d(${cx * BG_SHIFT}px, ${cy * BG_SHIFT}px, 0)`;
        }

        // UI katmanı: ters yönde ±5px (derinlik illüzyonu)
        if (this.uiLayer && this.uiLayer.classList.contains('active')) {
            this.uiLayer.style.transform =
                `translate3d(${cx * -UI_SHIFT}px, ${cy * -UI_SHIFT}px, 0)`;
        }
    },

    // ─── BUTON 3D TILT ──────────────────────────
    _bindButtonTilt() {
        const btnIds = ['btn-play-bots', 'btn-play-multi'];

        btnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;

            const onMove = (e) => {
                const rect = btn.getBoundingClientRect();
                const cx = (e.clientX - rect.left) / rect.width  - 0.5; // -0.5 → +0.5
                const cy = (e.clientY - rect.top)  / rect.height - 0.5;

                btn.style.transform =
                    `perspective(800px) rotateY(${cx * TILT_MAX}deg) rotateX(${-cy * TILT_MAX}deg) scale(1.03)`;
            };

            const onLeave = () => {
                btn.style.transform = '';
            };

            btn.addEventListener('mousemove', onMove);
            btn.addEventListener('mouseleave', onLeave);

            // Temizlik için referans tut
            this._tiltButtons.push({ btn, onMove, onLeave });
        });
    },

    _unbindButtonTilt() {
        this._tiltButtons.forEach(({ btn, onMove, onLeave }) => {
            btn.removeEventListener('mousemove', onMove);
            btn.removeEventListener('mouseleave', onLeave);
            btn.style.transform = '';
        });
        this._tiltButtons = [];
    },

    // ─── HOVER EFEKTLER ─────────────────────────
    onHoverStart() {
        if (!this.isActive) return;
        document.body.classList.add('parallax-hover-pulse');
    },

    onHoverEnd() {
        if (!this.isActive) return;
        document.body.classList.remove('parallax-hover-pulse');
    },

    // ─── EXIT ANİMASYONU (1sn) ──────────────────
    onPlayClicked() {
        if (!this.isActive) return Promise.resolve();

        return new Promise(resolve => {
            // Arka plan: zoom-in + blur + karart
            if (this.bgLayer) {
                this.bgLayer.classList.add('parallax-exit');
            }
            // UI: fade out + yukarı kayma
            if (this.uiLayer) {
                this.uiLayer.classList.add('parallax-exit-ui');
            }

            setTimeout(resolve, EXIT_MS);
        });
    },

    // ─── TEMA SENKRONİZASYONU ───────────────────
    setThemeLight(_themeName) {
        // No-op: CSS var(--primary) temayla otomatik güncellenir.
        // Glow parçacıkları ve buton hover'ları CSS variables üzerinden
        // yeni tema renklerini anında yansıtır.
    },

    // ─── YAŞAM DÖNGÜSÜ: DISPOSE ─────────────────
    dispose() {
        if (this.isMobile || !this.isActive) return;

        // Mouse listener kaldır
        if (this._boundMouseMove) {
            window.removeEventListener('mousemove', this._boundMouseMove);
            this._boundMouseMove = null;
        }

        // Buton tilt kaldır
        this._unbindButtonTilt();

        // Sahneyi gizle
        if (this.scene) {
            this.scene.classList.add('parallax-hidden');
        }
        document.body.classList.remove('parallax-active', 'parallax-hover-pulse');

        // Transform ve class'ları resetle
        if (this.bgLayer) {
            this.bgLayer.classList.remove('parallax-exit');
            this.bgLayer.style.transform = '';
            this.bgLayer.style.filter = '';
        }
        if (this.uiLayer) {
            this.uiLayer.classList.remove('parallax-exit-ui');
            this.uiLayer.style.transform = '';
            this.uiLayer.style.opacity = '';
        }

        this.isActive = false;
        console.log('[Parallax3D] Dispose edildi.');
    },

    // ─── YAŞAM DÖNGÜSÜ: RESUME ──────────────────
    async resume() {
        if (this.isMobile || motionReduced()) return;
        if (this.isActive) return; // Zaten çalışıyor

        // Exit animasyon kalıntılarını temizle
        if (this.bgLayer) {
            this.bgLayer.classList.remove('parallax-exit');
            this.bgLayer.style.transform = '';
            this.bgLayer.style.filter = '';
        }
        if (this.uiLayer) {
            this.uiLayer.classList.remove('parallax-exit-ui');
            this.uiLayer.style.transform = '';
            this.uiLayer.style.opacity = '';
        }

        // Sahneyi yeniden aç
        if (this.scene) {
            this.scene.classList.remove('parallax-hidden');
        }
        document.body.classList.add('parallax-active');
        this.isActive = true;

        // Mouse listener yeniden bağla
        this._boundMouseMove = this._onMouseMove.bind(this);
        window.addEventListener('mousemove', this._boundMouseMove);

        // Buton tilt yeniden bağla
        this._bindButtonTilt();

        console.log('[Parallax3D] Resume — parallax yeniden aktif.');
    }
};
