// Role 'sanctuary' is the default for index.html.
// This ensures all TVs opening the root URL are in the sanctuary room.
const socket = io({ query: { role: 'sanctuary' } });

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM REFS ---
    const statePre    = document.getElementById('state-pre');
    const stateActive = document.getElementById('state-active');
    const stateLive   = document.getElementById('state-live');
    const container   = document.getElementById('container');

    const hEl = document.getElementById('hours');
    const mEl = document.getElementById('minutes');
    const sEl = document.getElementById('seconds');

    const churchNameEl       = document.getElementById('church-name-el');
    const serviceNameEl      = document.getElementById('service-name-el');
    const ytIcon             = document.getElementById('yt-icon');
    const preMsg1            = document.getElementById('pre-msg-1');
    const preMsg2            = document.getElementById('pre-msg-2');
    const liveMsg1           = document.getElementById('live-msg-1');
    const liveMsg2           = document.getElementById('live-msg-2');
    const footerSection      = document.getElementById('footer-section');
    const footerMsg          = document.getElementById('footer-msg');
    const noticeBoardSection = document.getElementById('notice-board-section');
    const noticeEl           = document.getElementById('notice');
    const audioToast         = document.getElementById('audio-toast');

    // --- OUTRO DOM REFS ---
    const outroAudio      = document.getElementById('outro-audio');
    const outroScreen     = document.getElementById('outro-screen');
    const outroTextBlock  = document.getElementById('outro-text-block');
    const outroLine1      = document.getElementById('outro-line-1');
    const outroLine2      = document.getElementById('outro-line-2');
    const outroAudioToast = document.getElementById('outro-audio-toast');

    // --- STATE ---
    let serverState    = null;
    let currentPhase   = null;
    let currentNotices = [];
    let noticeIdx      = 0;
    let noticeInterval = null;

    // Outro state
    let outroActive          = false;
    let outroSchedulerHandle = null;
    let outroFallbackTimer   = null;
    let currentOverlayIdx    = -1;

    // =========================================================================
    // MUSIC
    // =========================================================================
    const bgMusic        = document.getElementById('bg-music');
    let lastRestartPulse = null;
    let musicWanted      = false;

    fetch('/api/audio')
        .then(r => r.json())
        .then(d => {
            if (d.url && bgMusic) {
                bgMusic.src = d.url;
                bgMusic.load();
            }
        })
        .catch(() => {});

    function tryPlay() {
        if (!bgMusic || !musicWanted) return;
        bgMusic.play().then(() => {
            if (audioToast) audioToast.style.display = 'none';
        }).catch(() => {
            if (audioToast) audioToast.style.display = 'flex';
            document.addEventListener('click', () => {
                if (audioToast) audioToast.style.display = 'none';
                if (musicWanted) bgMusic.play().catch(() => {});
            }, { once: true });
        });
    }

    function applyMusic(state) {
        if (!bgMusic || !state || !state.music) { bgMusic && bgMusic.pause(); return; }
        const m = state.music;
        bgMusic.loop   = (m.loop !== false);
        bgMusic.volume = typeof m.volume === 'number' ? m.volume : 0.6;
        if (m.restartPulse && m.restartPulse !== lastRestartPulse) {
            lastRestartPulse    = m.restartPulse;
            bgMusic.currentTime = 0;
        }
        musicWanted = !!m.playing;
        if (m.playing) { tryPlay(); } else { bgMusic.pause(); if (audioToast) audioToast.style.display = 'none'; }
    }

    // =========================================================================
    // OUTRO PLAYBACK
    // =========================================================================

    /**
     * Start (or re-sync) the outro.
     * Called on sanctuaryOverride event and on reconnect if override is still active.
     */
    function startOutroPlayback(payload) {
        outroActive = true;

        // Show outro screen, hide normal display content
        outroScreen.style.display  = 'flex';
        container.style.visibility = 'hidden';

        const durationSec = payload.durationMs / 1000;
        const offsetSec   = Math.max(0, Math.min((Date.now() - payload.startedAt) / 1000, durationSec));

        outroAudio.currentTime = offsetSec;

        // Start audio playback
        const playPromise = outroAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                outroAudioToast.style.display = 'none';
            }).catch(err => {
                if (err.name === 'NotAllowedError') {
                    outroAudioToast.style.display = 'flex';
                    socket.emit('audioBlocked', { reason: 'NotAllowedError' });
                    outroAudioToast.addEventListener('click', () => {
                        outroAudioToast.style.display = 'none';
                        outroAudio.play().catch(() => {});
                    }, { once: true });
                }
            });
        }

        // Wire the ended event
        outroAudio.onended = null;
        outroAudio.addEventListener('ended', onOutroEnded, { once: true });

        // Safety fallback at endsAt + 1s
        if (outroFallbackTimer) clearTimeout(outroFallbackTimer);
        const msLeft = payload.endsAt - Date.now();
        outroFallbackTimer = setTimeout(() => onOutroEnded('fallback'), Math.max(0, msLeft + 1000));

        // Start overlay text scheduler
        startOverlayScheduler(payload.overlays, payload.startedAt);
    }

    function onOutroEnded(source) {
        if (!outroActive) return;
        console.log('Outro ended, source:', source);
        socket.emit('sanctuaryOutroEnded');
        stopOutro();
    }

    function stopOutro() {
        outroActive = false;

        // Stop audio
        outroAudio.pause();
        outroAudio.currentTime = 0;

        // Hide outro screen
        outroScreen.style.display = 'none';
        outroLine1.textContent    = '';
        outroLine2.textContent    = '';
        outroAudioToast.style.display = 'none';

        // Restore normal display
        container.style.visibility = 'visible';

        // Clear schedulers
        if (outroSchedulerHandle) { clearInterval(outroSchedulerHandle); outroSchedulerHandle = null; }
        if (outroFallbackTimer)   { clearTimeout(outroFallbackTimer);    outroFallbackTimer   = null; }

        currentOverlayIdx = -1;
    }

    // =========================================================================
    // OVERLAY TEXT SCHEDULER
    // =========================================================================
    function startOverlayScheduler(overlays, startedAt) {
        if (outroSchedulerHandle) clearInterval(outroSchedulerHandle);

        function applyCurrentOverlay() {
            const elapsed = Date.now() - startedAt;
            // Find the overlay whose window contains elapsed
            let newIdx = -1;
            for (let i = 0; i < overlays.length; i++) {
                if (elapsed >= overlays[i].startMs && elapsed < overlays[i].endMs) {
                    newIdx = i;
                    break;
                }
            }
            if (newIdx === currentOverlayIdx) return; // no change
            currentOverlayIdx = newIdx;

            if (newIdx === -1) {
                // Between overlays — fade out
                fadeOutOverlayText();
            } else {
                // Transition to new overlay
                showOverlayText(overlays[newIdx].line1, overlays[newIdx].line2);
            }
        }

        applyCurrentOverlay(); // run immediately
        outroSchedulerHandle = setInterval(applyCurrentOverlay, 500); // check every 500ms
    }

    function showOverlayText(line1, line2) {
        outroTextBlock.classList.remove('outro-fade-out');
        outroTextBlock.classList.add('outro-fade-in');
        outroLine1.textContent    = line1 || '';
        outroLine2.textContent    = line2 || '';
        // Hide the second line entirely when empty so no blank gap appears
        outroLine2.style.display  = line2 ? '' : 'none';
    }

    function fadeOutOverlayText() {
        outroTextBlock.classList.remove('outro-fade-in');
        outroTextBlock.classList.add('outro-fade-out');
    }

    // =========================================================================
    // PHASE SWITCHER
    // =========================================================================
    function applyPhase(phase) {
        if (outroActive) return; // outro has full priority — block normal state changes
        if (phase === currentPhase) return;
        currentPhase = phase;

        [statePre, stateActive, stateLive].forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('active');
        });

        if (phase === 'pre' || phase === 'delayed') {
            statePre.classList.remove('hidden');
            statePre.classList.add('active');
        } else if (phase === 'countdown') {
            stateActive.classList.remove('hidden');
            stateActive.classList.add('active');
            scheduleNotices();
        } else if (phase === 'live') {
            stateLive.classList.remove('hidden');
            stateLive.classList.add('active');
        }
    }

    // =========================================================================
    // NOTICES
    // =========================================================================
    function scheduleNotices() {
        if (noticeInterval) clearInterval(noticeInterval);
        if (!currentNotices.length) { noticeBoardSection.style.display = 'none'; return; }
        noticeBoardSection.style.display = 'block';
        noticeEl.textContent = currentNotices[0];
        noticeIdx = 0;
        noticeInterval = setInterval(() => {
            noticeEl.classList.add('fade-out');
            setTimeout(() => {
                noticeIdx = (noticeIdx + 1) % currentNotices.length;
                noticeEl.textContent = currentNotices[noticeIdx];
                noticeEl.classList.remove('fade-out');
                noticeEl.classList.add('fade-in');
                setTimeout(() => noticeEl.classList.remove('fade-in'), 600);
            }, 600);
        }, 10000);
    }

    // =========================================================================
    // EVENT CONTENT BINDER
    // =========================================================================
    function applyEventContent(state) {
        if (!state || !state.activeEvent) {
            churchNameEl.textContent   = '';
            serviceNameEl.textContent  = '';
            ytIcon.style.display       = 'none';
            preMsg1.textContent        = '';
            preMsg2.textContent        = '';
            liveMsg1.textContent       = '';
            liveMsg2.textContent       = '';
            footerSection.style.display = 'none';
            footerMsg.textContent      = '';
            noticeBoardSection.style.display = 'none';
            currentNotices = [];
            if (noticeInterval) { clearInterval(noticeInterval); noticeInterval = null; }
            applyPhase('blank');
            return;
        }

        const ev     = state.activeEvent;
        const forced = state.forcedState;

        churchNameEl.textContent  = (ev.name    || '').trim();
        serviceNameEl.textContent = (ev.subtitle || '').trim();
        ytIcon.style.display = (ev.hasStreamLabel && state.isLive) ? 'inline-block' : 'none';

        const preMsgs     = Array.isArray(ev.preMessages)     ? ev.preMessages     : [];
        const delayedMsgs = Array.isArray(ev.delayedMessages) ? ev.delayedMessages : [];

        if (forced === 'delayed') {
            preMsg1.textContent = (delayedMsgs[0] || '').trim();
            preMsg2.textContent = (delayedMsgs[1] || '').trim();
        } else {
            preMsg1.textContent = (preMsgs[0] || '').trim();
            preMsg2.textContent = (preMsgs[1] || '').trim();
        }

        liveMsg1.textContent = (ev.liveMessage    || '').trim();
        liveMsg2.textContent = (ev.liveSubmessage || '').trim();

        const ft = (ev.footerText || '').trim();
        footerMsg.textContent       = ft;
        footerSection.style.display = ft ? 'block' : 'none';

        const newNotices = Array.isArray(ev.notices)
            ? ev.notices.map(n => (n || '').trim()).filter(Boolean) : [];
        if (JSON.stringify(newNotices) !== JSON.stringify(currentNotices)) {
            currentNotices = newNotices;
            if (noticeInterval) { clearInterval(noticeInterval); noticeInterval = null; }
        }
    }

    // =========================================================================
    // PHASE RESOLVER
    // =========================================================================
    function resolvePhase(state) {
        if (!state || !state.activeEvent) return 'blank';
        const f = state.forcedState;
        if (f === 'idle' || f === 'ended') return 'blank';
        if (f === 'delayed')   return 'delayed';
        if (f === 'live')      return 'live';
        if (f === 'countdown') return 'countdown';
        if (f === 'pre' && state.startTime)
            return Date.now() < new Date(state.startTime).getTime() ? 'countdown' : 'pre';
        return 'pre';
    }

    // =========================================================================
    // TICK LOOP
    // =========================================================================
    function tick() {
        if (!outroActive && serverState && serverState.activeEvent && serverState.startTime) {
            applyPhase(resolvePhase(serverState));
            if (currentPhase === 'countdown') {
                const diff = new Date(serverState.startTime).getTime() - Date.now();
                if (diff > 0) {
                    hEl.textContent = String(Math.floor(diff / 3600000)).padStart(2, '0');
                    mEl.textContent = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                    sEl.textContent = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
                } else {
                    hEl.textContent = mEl.textContent = sEl.textContent = '00';
                }
            }
        }
        requestAnimationFrame(tick);
    }

    // =========================================================================
    // SOCKET EVENTS
    // =========================================================================
    socket.on('stateSync', (state) => {
        serverState = state;
        applyEventContent(state);
        applyPhase(resolvePhase(state));
        applyMusic(state);
    });

    /** Start (or re-sync) the sanctuary outro */
    socket.on('sanctuaryOverride', (payload) => {
        if (!payload || payload.type !== 'OUTRO') return;
        // Guard: don't restart if already playing the same instance
        if (outroActive) return;
        startOutroPlayback(payload);
    });

    /** Server cleared the override (timer elapsed, admin cancelled, or client ack) */
    socket.on('sanctuaryOverrideClear', () => {
        stopOutro();
        // Force a phase render refresh after stopping outro
        if (serverState) {
            applyEventContent(serverState);
            applyPhase(resolvePhase(serverState));
        }
        currentPhase = null; // reset so applyPhase re-renders
    });

    /** On reconnect — re-request current outro state in case server has an active one */
    socket.on('connect', () => {
        fetch('/api/runtime')
            .then(r => r.json())
            .then(data => {
                if (data.sanctuaryOverride && data.sanctuaryOverride.type === 'OUTRO') {
                    const payload = data.sanctuaryOverride;
                    if (Date.now() < payload.endsAt && !outroActive) {
                        startOutroPlayback(payload);
                    }
                }
            })
            .catch(() => {});
    });

    requestAnimationFrame(tick);

    // =========================================================================
    // KIOSK / UX
    // =========================================================================
    document.addEventListener('contextmenu', e => e.preventDefault());

    let mouseTimer;
    function hideCursor() { document.body.classList.add('hide-cursor'); }
    function showCursor()  {
        document.body.classList.remove('hide-cursor');
        clearTimeout(mouseTimer);
        mouseTimer = setTimeout(hideCursor, 3000);
    }
    document.addEventListener('mousemove', showCursor);
    document.addEventListener('click',     showCursor);
    mouseTimer = setTimeout(hideCursor, 3000);

    // Wake Lock
    let wakeLock = null;
    async function requestWakeLock() {
        try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
        catch (_) {}
    }
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') await requestWakeLock();
    });

    // Fullscreen
    const fsOverlay = document.getElementById('fs-prompt-overlay');
    const fsBtn     = document.getElementById('fs-toggle-btn');

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            requestWakeLock();
        } else {
            document.exitFullscreen();
        }
    }

    fsBtn.addEventListener('click', toggleFullscreen);

    if (new URLSearchParams(window.location.search).get('startFullscreen') === 'true') {
        if (!document.fullscreenElement) fsOverlay.classList.remove('hidden');
    }

    fsOverlay.addEventListener('click', () => {
        toggleFullscreen();
        fsOverlay.classList.add('hidden');
    });

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) fsOverlay.classList.add('hidden');
    });
});
