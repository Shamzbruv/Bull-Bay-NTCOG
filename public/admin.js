// Role 'admin' → joins the admin Socket.IO room.
// Admin receives both stateSync (all clients) AND sanctuaryOverride / clear events.
const socket = io({ query: { role: 'admin' } });

// --- DOM REFS ---
const templateSelect       = document.getElementById('template-select');
const startTimeInput       = document.getElementById('start-time-input');
const isLiveToggle         = document.getElementById('is-live-toggle');
const setEventBtn          = document.getElementById('set-event-btn');
const btnCreateOneTime     = document.getElementById('create-one-time-btn');
const btnEditTemplate      = document.getElementById('edit-template-btn');
const modal                = document.getElementById('template-modal');
const modalTitle           = document.getElementById('modal-title');
const btnModalSave         = document.getElementById('modal-save-btn');
const btnModalOneTime      = document.getElementById('modal-start-onetime-btn');
const btnModalCancel       = document.getElementById('modal-cancel-btn');
const modalOnetimeControls = document.getElementById('modal-onetime-controls');

// Active controls display
const dispEventName = document.getElementById('display-event-name');
const dispEventTime = document.getElementById('display-event-time');
const dispIsLive    = document.getElementById('display-is-live');
const dispState     = document.getElementById('display-state');
const dispCountdown = document.getElementById('display-countdown');

// Music controls
const musicToggleBtn    = document.getElementById('music-toggle-btn');
const musicRestartBtn   = document.getElementById('music-restart-btn');
const musicLoopToggle   = document.getElementById('music-loop-toggle');
const musicVolumeSlider = document.getElementById('music-volume');
const musicVolumeLabel  = document.getElementById('music-volume-label');

// Outro controls
const endOfServiceBtn    = document.getElementById('end-of-service-btn');
const outroModal         = document.getElementById('outro-modal');
const outroConfirmBtn    = document.getElementById('outro-confirm-btn');
const outroCancelBtn     = document.getElementById('outro-cancel-btn');
const outroStateBadge    = document.getElementById('outro-state-badge');
const outroCountdownDisp = document.getElementById('outro-countdown-display');
const outroSanctuaryCount= document.getElementById('outro-sanctuary-count');
const outroAudioWarning  = document.getElementById('outro-audio-warning');
const outroMediaWarning  = document.getElementById('outro-media-warning');
const outroStopBtn       = document.getElementById('outro-stop-btn');

// Connection indicator
const connectionDot  = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const logoutBtn      = document.getElementById('logout-btn');

// Media library
const bgCurrentName    = document.getElementById('bg-current-name');
const bgLibraryGrid    = document.getElementById('bg-library-grid');
const bgUploadInput    = document.getElementById('bg-upload-input');
const bgUploadStatus   = document.getElementById('bg-upload-status');
const musicCurrentName = document.getElementById('music-current-name');
const musicLibraryGrid = document.getElementById('music-library-grid');
const musicUploadInput = document.getElementById('music-upload-input');
const musicUploadStatus= document.getElementById('music-upload-status');

// OBS Lyrics & Text Display
const lyricsPasteInput     = document.getElementById('lyrics-paste-input');
const lyricsLoadBtn        = document.getElementById('lyrics-load-btn');
const lyricsClearBtn       = document.getElementById('lyrics-clear-btn');
const lyricsSegmentsEl     = document.getElementById('lyrics-segments');
const lyricsPrevBtn        = document.getElementById('lyrics-prev-btn');
const lyricsNextBtn        = document.getElementById('lyrics-next-btn');
const lyricsPositionLabel  = document.getElementById('lyrics-position-label');
const textOverlayToggleBtn = document.getElementById('text-overlay-toggle-btn');
const previewFrame         = document.getElementById('text-overlay-preview-frame');
const previewEmpty         = document.getElementById('text-overlay-preview-empty');
const previewBox           = document.getElementById('text-overlay-preview-box');
const previewContent       = document.getElementById('text-overlay-preview-content');
const previewDivider       = document.getElementById('text-overlay-preview-divider');

const styleFontSel   = document.getElementById('style-font');
const styleSizeInput = document.getElementById('style-size');
const styleSizeLabel = document.getElementById('style-size-label');
const styleColorInput  = document.getElementById('style-color');
const styleAccentInput = document.getElementById('style-accent');
const styleEffectSel = document.getElementById('style-effect');
const styleBgSel     = document.getElementById('style-bg');
const styleAnimSel   = document.getElementById('style-anim');
const styleUppercaseToggle = document.getElementById('style-uppercase');
const styleDividerToggle   = document.getElementById('style-divider');
const stylePosButtons   = document.querySelectorAll('#style-pos-row .choice-btn');
const styleAlignButtons = document.querySelectorAll('#style-align-row .choice-btn');

// Account
const currentPasswordInput = document.getElementById('current-password-input');
const newPasswordInput     = document.getElementById('new-password-input');
const changePasswordBtn    = document.getElementById('change-password-btn');
const changePasswordStatus = document.getElementById('change-password-status');

// =========================================================================
// STATE
// =========================================================================
let musicPlaying       = false;
let loadedTemplates    = [];
let editingTemplateId  = null;
let serverState        = null;
let panelTickInterval  = null;

// Outro state (local admin tracking)
let activeOutro        = null; // the current sanctuaryOverride payload
let outroStripInterval = null;
let sanctuaryTVCount   = 0;    // count of connected sanctuary room clients

// Media library state
let bgLibraryItems    = [];
let musicLibraryItems = [];

// Lyrics / OBS Text Display state
const DEFAULT_TEXT_OVERLAY_STYLE = {
    fontFamily: 'heading', fontSize: 2.6, textColor: '#f8f9fa', accentColor: '#d4af37',
    align: 'center', position: 'bottom', background: 'glass', textEffect: 'shadow',
    animation: 'fade', uppercase: false, letterSpacing: 0, showDivider: true
};
let lyricsState = { visible: false, rawInput: '', segments: [], currentIndex: 0, style: DEFAULT_TEXT_OVERLAY_STYLE };
let lyricsPasteSynced   = false; // becomes true once the paste box has been filled from the server once
const previewRenderState = { lastKey: null };

// =========================================================================
// AUTH — logout + session-expiry handling
// =========================================================================
logoutBtn.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    window.location.href = '/login.html';
});

/** The server disconnects an admin socket outright if its session cookie is missing/expired. */
socket.on('authError', () => {
    window.location.href = '/login.html?next=/admin.html';
});

/** Shared fetch wrapper for admin-only REST calls: redirects to login on a real session
 *  expiry (AUTH_REQUIRED), and otherwise just hands back the parsed response. */
async function apiFetch(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'AUTH_REQUIRED') {
        window.location.href = '/login.html?next=/admin.html';
        throw new Error('Session expired');
    }
    return { ok: res.ok, status: res.status, data };
}

// =========================================================================
// TIME HELPERS
// =========================================================================
function getFutureISO(minsFromNow) {
    return new Date(Date.now() + minsFromNow * 60000);
}

function toLocalInputValue(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function padZ(n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); }

function formatCountdown(msRemaining) {
    if (msRemaining <= 0) return '00:00';
    const totalSec = Math.floor(msRemaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${padZ(m)}:${padZ(s)}`;
}

// Set default time to +15 minutes from now on load
startTimeInput.value = toLocalInputValue(getFutureISO(15));

// =========================================================================
// CONNECTION INDICATOR
// =========================================================================
function setConnected(connected) {
    connectionDot.classList.toggle('connected', connected);
    connectionText.textContent = connected ? 'Server Connected' : 'Disconnected — reconnecting…';
}

socket.on('connect',    () => setConnected(true));
socket.on('disconnect', () => setConnected(false));

// =========================================================================
// MUSIC CONTROLS
// =========================================================================
musicToggleBtn.addEventListener('click', () => {
    musicPlaying = !musicPlaying;
    socket.emit('musicControl', { playing: musicPlaying });
});

musicRestartBtn.addEventListener('click', () => {
    socket.emit('musicRestart');
    musicPlaying = true;
    updateMusicUI({ playing: true, volume: parseFloat(musicVolumeSlider.value), loop: musicLoopToggle.checked });
});

musicLoopToggle.addEventListener('change', () => {
    socket.emit('musicControl', { loop: musicLoopToggle.checked });
});

musicVolumeSlider.addEventListener('input', () => {
    const vol = parseFloat(musicVolumeSlider.value);
    musicVolumeLabel.textContent = `${Math.round(vol * 100)}%`;
    socket.emit('musicControl', { volume: vol });
});

function updateMusicUI(musicState) {
    if (!musicState) return;
    musicPlaying = musicState.playing;
    musicToggleBtn.textContent = musicPlaying ? '⏸ Pause' : '▶ Play';
    musicToggleBtn.style.background  = musicPlaying ? 'rgba(212,175,55,0.15)' : '';
    musicToggleBtn.style.borderColor = musicPlaying ? 'var(--color-gold)' : '';
    musicToggleBtn.style.color       = musicPlaying ? 'var(--color-gold)' : '';
    if (typeof musicState.loop === 'boolean') musicLoopToggle.checked = musicState.loop;
    if (document.activeElement !== musicVolumeSlider) {
        musicVolumeSlider.value = musicState.volume;
        musicVolumeLabel.textContent = `${Math.round(musicState.volume * 100)}%`;
    }
}

// =========================================================================
// OUTRO — MODAL
// =========================================================================

// On page load, check whether outro.mp4 exists and show a warning if not
fetch('/api/media/outro')
    .then(r => r.json())
    .then(d => {
        if (!d.exists && outroMediaWarning) {
            outroMediaWarning.classList.remove('hidden');
        }
    })
    .catch(() => {});

endOfServiceBtn.addEventListener('click', () => {
    openOutroModal();
});

function openOutroModal() {
    outroModal.classList.remove('hidden');
    outroModal.style.display = 'flex';
}

function closeOutroModal() {
    outroModal.classList.add('hidden');
    outroModal.style.display = 'none';
}

outroCancelBtn.addEventListener('click', closeOutroModal);

// Close modal if clicking the backdrop
outroModal.addEventListener('click', (e) => {
    if (e.target === outroModal) closeOutroModal();
});

outroConfirmBtn.addEventListener('click', () => {
    socket.emit('startOutro');
    closeOutroModal();
});

outroStopBtn.addEventListener('click', () => {
    if (confirm('Stop the outro on all sanctuary screens?')) socket.emit('clearOutro');
});

// =========================================================================
// OUTRO — STATUS STRIP
// =========================================================================

function startOutroStripTick() {
    if (outroStripInterval) clearInterval(outroStripInterval);
    outroStripInterval = setInterval(updateOutroStrip, 1000);
}

function stopOutroStripTick() {
    if (outroStripInterval) clearInterval(outroStripInterval);
    outroStripInterval = null;
}

/** While an outro runs: offer Stop, and block a second start (the server ignores it anyway). */
function setOutroRunningUI(running) {
    outroStopBtn.classList.toggle('hidden', !running);
    endOfServiceBtn.disabled = running;
}

function updateOutroStrip() {
    setOutroRunningUI(!!activeOutro && activeOutro.endsAt > Date.now());
    if (!activeOutro) {
        outroStateBadge.textContent   = 'Idle';
        outroStateBadge.className     = 'outro-badge outro-badge-idle';
        outroCountdownDisp.textContent = '';
        return;
    }

    const msLeft = activeOutro.endsAt - Date.now();
    if (msLeft <= 0) {
        // Already expired client-side — clear local state gracefully
        activeOutro = null;
        stopOutroStripTick();
        outroStateBadge.textContent    = 'Completed';
        outroStateBadge.className      = 'outro-badge outro-badge-complete';
        outroCountdownDisp.textContent = '';
        setTimeout(() => {
            outroStateBadge.textContent = 'Idle';
            outroStateBadge.className   = 'outro-badge outro-badge-idle';
        }, 5000);
        return;
    }

    outroStateBadge.textContent    = 'Running';
    outroStateBadge.className      = 'outro-badge outro-badge-running';
    outroCountdownDisp.textContent = `Ends in ${formatCountdown(msLeft)}`;
}

// =========================================================================
// OUTRO — SOCKET EVENTS
// =========================================================================
socket.on('sanctuaryOverride', (payload) => {
    if (!payload || payload.type !== 'OUTRO') return;
    activeOutro = payload;
    outroAudioWarning.classList.add('hidden'); // reset audio warning on new outro
    updateOutroStrip();
    startOutroStripTick();
});

socket.on('sanctuaryOverrideClear', () => {
    activeOutro = null;
    stopOutroStripTick();
    setOutroRunningUI(false);
    outroStateBadge.textContent    = 'Completed';
    outroStateBadge.className      = 'outro-badge outro-badge-complete';
    outroCountdownDisp.textContent = '';
    setTimeout(() => {
        outroStateBadge.textContent = 'Idle';
        outroStateBadge.className   = 'outro-badge outro-badge-idle';
    }, 5000);
});

socket.on('audioBlocked', () => {
    outroAudioWarning.classList.remove('hidden');
});

// Receive live sanctuary TV count from server
socket.on('sanctuaryCount', (count) => {
    sanctuaryTVCount = count;
    outroSanctuaryCount.textContent = `Sanctuary TVs connected: ${count}`;
});

// =========================================================================
// MEDIA LIBRARY — background video/image + background music
// =========================================================================
function libraryItemThumb(kind, item) {
    if (kind === 'background') {
        if ((item.mimeType || '').startsWith('image/')) return `<img src="${item.url}" alt="">`;
        return `<video src="${item.url}#t=0.5" muted preload="metadata"></video>`;
    }
    return `🎵`;
}

function renderLibrary(kind) {
    const items = kind === 'background' ? bgLibraryItems : musicLibraryItems;
    const grid  = kind === 'background' ? bgLibraryGrid  : musicLibraryGrid;
    const current = kind === 'background'
        ? (serverState && serverState.backgroundMedia)
        : (serverState && serverState.musicTrack);

    grid.innerHTML = '';
    if (!items.length) {
        grid.innerHTML = '<p class="library-empty">Nothing uploaded yet.</p>';
    }
    items.forEach(item => {
        const isActive = current && current.path === item.path;
        const card = document.createElement('div');
        card.className = 'library-item' + (isActive ? ' active' : '');
        card.innerHTML = `
            <div class="library-thumb">${libraryItemThumb(kind, item)}</div>
            <div class="library-name">${item.name.replace(/^\d+-/, '')}</div>
            <div class="library-item-actions">
                <button class="btn btn-secondary use-btn" ${isActive ? 'disabled' : ''}>${isActive ? '✓ In Use' : 'Use'}</button>
                <button class="btn btn-danger delete-btn" ${isActive ? 'disabled title="Currently in use"' : ''}>🗑</button>
            </div>`;
        card.querySelector('.use-btn').addEventListener('click', () => {
            if (kind === 'background') {
                socket.emit('selectBackgroundMedia', { url: item.url, kind: (item.mimeType || '').startsWith('image/') ? 'image' : 'video', name: item.name, path: item.path });
            } else {
                socket.emit('selectMusicTrack', { url: item.url, name: item.name, path: item.path });
            }
        });
        card.querySelector('.delete-btn').addEventListener('click', async () => {
            if (!confirm(`Delete "${item.name}" from the library?`)) return;
            const [folder, filename] = item.path.split('/');
            const kindParam = folder === 'backgrounds' ? 'background' : 'music';
            const { ok, data } = await apiFetch(`/api/media/${kindParam}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (!ok) { alert(data.error || 'Delete failed.'); return; }
            loadLibrary(kind);
        });
        grid.appendChild(card);
    });
}

async function loadLibrary(kind) {
    const { ok, data } = await apiFetch(`/api/media/library?kind=${kind}`);
    if (ok && Array.isArray(data)) {
        if (kind === 'background') bgLibraryItems = data; else musicLibraryItems = data;
    }
    renderLibrary(kind);
}

function setUploadStatus(el, message, type) {
    el.textContent = message;
    el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function handleUpload(kind, file, statusEl) {
    if (!file) return;
    setUploadStatus(statusEl, `Uploading ${file.name}…`);
    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file);
    try {
        const { ok, data } = await apiFetch('/api/media/upload', { method: 'POST', body: formData });
        if (!ok) { setUploadStatus(statusEl, data.error || 'Upload failed.', 'error'); return; }
        setUploadStatus(statusEl, `Uploaded "${file.name}". Click "Use" to switch to it.`, 'success');
        loadLibrary(kind);
    } catch (e) {
        setUploadStatus(statusEl, 'Upload failed — please try again.', 'error');
    }
}

bgUploadInput.addEventListener('change', () => {
    handleUpload('background', bgUploadInput.files[0], bgUploadStatus);
    bgUploadInput.value = '';
});
musicUploadInput.addEventListener('change', () => {
    handleUpload('music', musicUploadInput.files[0], musicUploadStatus);
    musicUploadInput.value = '';
});

// =========================================================================
// OBS LYRICS & TEXT DISPLAY
// =========================================================================

/** Splits pasted lyrics into verse/chorus/etc. segments on blank lines. A first line like
 *  "[Verse 1]", "Chorus:", or "(Bridge)" is used as that segment's label and stripped out
 *  of the on-screen text; otherwise segments are just numbered "Part 1", "Part 2", ... */
function parseLyrics(raw) {
    const blocks = raw.replace(/\r\n/g, '\n').split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
    return blocks.map((block, i) => {
        const lines = block.split('\n');
        const first = lines[0].trim();
        const m = first.match(/^[[(]?\s*(verse\s*\d*|pre-chorus|chorus|bridge|intro|outro|refrain|tag|hook)\s*\d*\s*[\])]?\s*[:-]?\s*$/i);
        let label = null;
        if (m && lines.length > 1) {
            label = first.replace(/[[\]():-]/g, '').trim();
            lines.shift();
        }
        return { label: label || `Part ${i + 1}`, text: lines.join('\n').trim() };
    }).filter(seg => seg.text);
}

lyricsLoadBtn.addEventListener('click', () => {
    const segments = parseLyrics(lyricsPasteInput.value);
    if (!segments.length) { alert('Paste some lyrics first — separate verses with a blank line.'); return; }
    socket.emit('updateTextOverlay', { rawInput: lyricsPasteInput.value, segments, currentIndex: 0 });
});

lyricsClearBtn.addEventListener('click', () => {
    if (!confirm('Clear the loaded lyrics and hide the overlay?')) return;
    lyricsPasteInput.value = '';
    socket.emit('updateTextOverlay', { rawInput: '', segments: [], currentIndex: 0, visible: false });
});

function goToSegment(i) {
    if (i < 0 || i >= lyricsState.segments.length) return;
    socket.emit('updateTextOverlay', { currentIndex: i });
}
lyricsPrevBtn.addEventListener('click', () => goToSegment(lyricsState.currentIndex - 1));
lyricsNextBtn.addEventListener('click', () => goToSegment(lyricsState.currentIndex + 1));

textOverlayToggleBtn.addEventListener('click', () => {
    socket.emit('updateTextOverlay', { visible: !lyricsState.visible });
});

/** Every style control sends the *whole* style object (current + this one change) — the
 *  server merges/validates it, so this never needs to know the other fields' shape. */
function emitStylePatch(patch) {
    socket.emit('updateTextOverlay', { style: { ...lyricsState.style, ...patch } });
}
styleFontSel.addEventListener('change', () => emitStylePatch({ fontFamily: styleFontSel.value }));
styleSizeInput.addEventListener('input', () => {
    styleSizeLabel.textContent = `${styleSizeInput.value}rem`;
    emitStylePatch({ fontSize: parseFloat(styleSizeInput.value) });
});
styleColorInput.addEventListener('input',  () => emitStylePatch({ textColor: styleColorInput.value }));
styleAccentInput.addEventListener('input', () => emitStylePatch({ accentColor: styleAccentInput.value }));
styleEffectSel.addEventListener('change',  () => emitStylePatch({ textEffect: styleEffectSel.value }));
styleBgSel.addEventListener('change',      () => emitStylePatch({ background: styleBgSel.value }));
styleAnimSel.addEventListener('change',    () => emitStylePatch({ animation: styleAnimSel.value }));
styleUppercaseToggle.addEventListener('change', () => emitStylePatch({ uppercase: styleUppercaseToggle.checked }));
styleDividerToggle.addEventListener('change',   () => emitStylePatch({ showDivider: styleDividerToggle.checked }));
stylePosButtons.forEach(btn => btn.addEventListener('click', () => emitStylePatch({ position: btn.dataset.pos })));
styleAlignButtons.forEach(btn => btn.addEventListener('click', () => emitStylePatch({ align: btn.dataset.align })));

function renderSegmentNav() {
    lyricsSegmentsEl.innerHTML = '';
    lyricsState.segments.forEach((seg, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lyrics-chip' + (i === lyricsState.currentIndex ? ' active' : '');
        chip.textContent = seg.label;
        chip.title = seg.text.split('\n')[0];
        chip.addEventListener('click', () => goToSegment(i));
        lyricsSegmentsEl.appendChild(chip);
    });
    lyricsPositionLabel.textContent = lyricsState.segments.length
        ? `${lyricsState.currentIndex + 1} / ${lyricsState.segments.length} — ${lyricsState.segments[lyricsState.currentIndex].label}`
        : '—';
    lyricsPrevBtn.disabled = lyricsState.currentIndex <= 0;
    lyricsNextBtn.disabled = lyricsState.currentIndex >= lyricsState.segments.length - 1;
}

/** Reflects the current style into the customize controls — needed after a reconnect, or
 *  when another admin device changes the style, so both stay in sync. */
function syncStyleControls(style) {
    styleFontSel.value = style.fontFamily;
    styleSizeInput.value = style.fontSize;
    styleSizeLabel.textContent = `${style.fontSize}rem`;
    styleColorInput.value = style.textColor;
    styleAccentInput.value = style.accentColor;
    styleEffectSel.value = style.textEffect;
    styleBgSel.value = style.background;
    styleAnimSel.value = style.animation;
    styleUppercaseToggle.checked = style.uppercase;
    styleDividerToggle.checked = style.showDivider;
    stylePosButtons.forEach(b => b.classList.toggle('active-choice', b.dataset.pos === style.position));
    styleAlignButtons.forEach(b => b.classList.toggle('active-choice', b.dataset.align === style.align));
}

const previewEls = { frame: previewFrame, box: previewBox, content: previewContent, divider: previewDivider };
function renderPreview() {
    previewEmpty.classList.toggle('hidden', lyricsState.segments.length > 0);
    renderTextOverlayInto(previewEls, lyricsState, previewRenderState, { forceVisible: true });
    syncStyleControls(lyricsState.style);
}

function applyTextOverlayState(overlay) {
    if (!overlay) return;
    lyricsState = overlay;
    if (!lyricsPasteSynced) {
        lyricsPasteInput.value = overlay.rawInput || '';
        lyricsPasteSynced = true;
    }
    renderSegmentNav();
    renderPreview();
    textOverlayToggleBtn.textContent = overlay.visible ? '⏹ Hide from OBS' : '▶ Show on OBS';
    textOverlayToggleBtn.classList.toggle('is-live', overlay.visible);
}

// Keyboard shortcuts for fast verse-by-verse operation during a live song — ignored while
// typing in any field, or while a modal is open, so they never hijack normal typing.
document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (!modal.classList.contains('hidden') || !outroModal.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight')      { e.preventDefault(); goToSegment(lyricsState.currentIndex + 1); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); goToSegment(lyricsState.currentIndex - 1); }
    else if (e.code === 'Space')     { e.preventDefault(); socket.emit('updateTextOverlay', { visible: !lyricsState.visible }); }
});

// =========================================================================
// ACCOUNT — change password
// =========================================================================
changePasswordBtn.addEventListener('click', async () => {
    const currentPassword = currentPasswordInput.value;
    const newPassword     = newPasswordInput.value;
    if (!newPassword || newPassword.length < 8) {
        setUploadStatus(changePasswordStatus, 'New password must be at least 8 characters.', 'error');
        return;
    }
    const { ok, data } = await apiFetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!ok) { setUploadStatus(changePasswordStatus, data.error || 'Could not change password.', 'error'); return; }
    setUploadStatus(changePasswordStatus, 'Password changed.', 'success');
    currentPasswordInput.value = '';
    newPasswordInput.value = '';
});

// =========================================================================
// MODAL LOGIC (Template Editor)
// =========================================================================
function openModal(mode, tplId = null) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (mode === 'edit') {
        modalTitle.textContent = 'Edit Template';
        btnModalSave.style.display    = '';
        btnModalOneTime.style.display = 'none';
        modalOnetimeControls.classList.add('hidden');
        editingTemplateId = tplId;
        const tpl = loadedTemplates.find(t => t.id === tplId);
        if (tpl) fillModalFields(tpl);
    } else {
        modalTitle.textContent = 'Create One-Time Event';
        btnModalSave.style.display    = 'none';
        btnModalOneTime.style.display = '';
        modalOnetimeControls.classList.remove('hidden');
        editingTemplateId = null;
        clearModalFields();
        document.getElementById('tpl-stream-label').checked = true;
        document.getElementById('modal-is-live').checked    = true;
        document.getElementById('modal-start-now').checked  = false;
        document.getElementById('modal-start-time').value   = toLocalInputValue(getFutureISO(15));
    }
}

function fillModalFields(tpl) {
    document.getElementById('tpl-title').value        = tpl.name        || '';
    document.getElementById('tpl-subtitle').value     = tpl.subtitle    || '';
    document.getElementById('tpl-footer').value       = tpl.footerText  || '';
    document.getElementById('tpl-stream-label').checked = !!tpl.hasStreamLabel;
    document.getElementById('tpl-pre-msgs').value     = (tpl.preMessages     || []).join('\n');
    document.getElementById('tpl-delayed-msgs').value = (tpl.delayedMessages || []).join('\n');
    document.getElementById('tpl-notices').value      = (tpl.notices         || []).join('\n');
    document.getElementById('tpl-live-msg').value     = tpl.liveMessage    || '';
    document.getElementById('tpl-live-submsg').value  = tpl.liveSubmessage || '';
}

function clearModalFields() {
    ['tpl-title','tpl-subtitle','tpl-footer','tpl-pre-msgs','tpl-delayed-msgs',
     'tpl-notices','tpl-live-msg','tpl-live-submsg'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

function scrapeModalData() {
    const lines = id => {
        const raw = document.getElementById(id).value.trim();
        return raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    };
    return {
        id:             editingTemplateId || null,
        name:           document.getElementById('tpl-title').value.trim(),
        subtitle:       document.getElementById('tpl-subtitle').value.trim(),
        footerText:     document.getElementById('tpl-footer').value.trim(),
        hasStreamLabel: document.getElementById('tpl-stream-label').checked,
        preMessages:    lines('tpl-pre-msgs'),
        delayedMessages:lines('tpl-delayed-msgs'),
        notices:        lines('tpl-notices'),
        liveMessage:    document.getElementById('tpl-live-msg').value.trim(),
        liveSubmessage: document.getElementById('tpl-live-submsg').value.trim()
    };
}

function closeModal() {
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

btnModalCancel.addEventListener('click', closeModal);
btnEditTemplate.addEventListener('click', () => {
    if (!templateSelect.value) return;
    openModal('edit', templateSelect.value);
});
btnCreateOneTime.addEventListener('click', () => openModal('onetime'));

btnModalSave.addEventListener('click', () => {
    socket.emit('saveTemplate', scrapeModalData());
    closeModal();
});

btnModalOneTime.addEventListener('click', () => {
    const data    = scrapeModalData();
    const startNow = document.getElementById('modal-start-now').checked;
    const isLive   = document.getElementById('modal-is-live').checked;

    let startTime;
    if (startNow) {
        startTime = new Date().toISOString();
    } else {
        const v = new Date(document.getElementById('modal-start-time').value);
        if (isNaN(v)) { alert('Please enter a valid start date and time.'); return; }
        startTime = v.toISOString();
    }
    socket.emit('setEvent', { isOneTime: true, oneTimeData: data, startTime, isLive });
    closeModal();
});

// =========================================================================
// STANDARD EVENT START
// =========================================================================
setEventBtn.addEventListener('click', () => {
    const v = new Date(startTimeInput.value);
    if (isNaN(v)) { alert('Invalid date/time.'); return; }
    socket.emit('setEvent', {
        templateId: templateSelect.value,
        startTime:  v.toISOString(),
        isLive:     isLiveToggle.checked,
        isOneTime:  false
    });
});

// =========================================================================
// DELAY CONTROLS
// =========================================================================
document.getElementById('add-1-btn').addEventListener('click',  () => socket.emit('addDelay', 1));
document.getElementById('add-5-btn').addEventListener('click',  () => socket.emit('addDelay', 5));
document.getElementById('add-arbitrary-btn').addEventListener('click', () => {
    const input = document.getElementById('arbitrary-delay-input');
    const val   = parseInt(input.value, 10);
    if (!isNaN(val) && val > 0) socket.emit('addDelay', val);
    input.value = '';
});

// =========================================================================
// FORCE STATE
// =========================================================================
document.getElementById('force-pre-btn').addEventListener('click',     () => socket.emit('forceState', 'pre'));
document.getElementById('force-delayed-btn').addEventListener('click', () => socket.emit('forceState', 'delayed'));
document.getElementById('force-live-btn').addEventListener('click',    () => socket.emit('forceState', 'live'));
document.getElementById('force-idle-btn').addEventListener('click',    () => socket.emit('forceState', 'idle'));

// =========================================================================
// ACTIVE CONTROLS PANEL LIVE UPDATE
// =========================================================================
function resolvePhase(state) {
    if (!state || !state.activeEvent) return 'blank';
    const f = state.forcedState;
    if (f === 'idle' || f === 'ended') return 'blank';
    if (f === 'delayed') return 'delayed';
    if (f === 'live')    return 'live';
    if (f === 'countdown') return 'countdown';
    if (f === 'pre' && state.startTime) {
        return Date.now() < new Date(state.startTime).getTime() ? 'countdown' : 'delayed';
    }
    return 'pre';
}

function updatePanelDisplay(state) {
    if (!state || !state.activeEvent) {
        dispEventName.textContent = 'No Event Started';
        dispEventTime.textContent = '—';
        dispIsLive.textContent    = '—';
        dispIsLive.style.color    = '#94a3b8';
        dispState.textContent     = 'IDLE';
        dispState.className       = 'badge';
        if (dispCountdown) dispCountdown.textContent = '—';
        return;
    }

    const phase  = resolvePhase(state);
    const target = state.startTime ? new Date(state.startTime) : null;

    dispEventName.textContent = state.activeEvent.name || '—';
    dispIsLive.textContent    = state.isLive ? 'LIVE STREAM' : 'IN-BUILDING ONLY';
    dispIsLive.style.color    = state.isLive ? '#e74c3c' : '#94a3b8';

    const badges = { live: 'badge live', delayed: 'badge delayed',
                     countdown: 'badge active', pre: 'badge pre', blank: 'badge' };
    dispState.className   = badges[phase] || 'badge';
    dispState.textContent = phase === 'blank' ? 'IDLE' : phase.toUpperCase();

    if (target) {
        dispEventTime.textContent = `Target: ${target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        dispEventTime.textContent = '—';
    }

    if (phase === 'countdown' && target) {
        const diff = target - Date.now();
        if (diff > 0) {
            const h = padZ(diff / 3600000);
            const m = padZ((diff % 3600000) / 60000);
            const s = padZ((diff % 60000) / 1000);
            if (dispCountdown) dispCountdown.textContent = `${h}:${m}:${s} remaining`;
        } else {
            if (dispCountdown) dispCountdown.textContent = '00:00:00';
        }
    } else {
        if (dispCountdown) dispCountdown.textContent = '';
    }
}

function startPanelTick() {
    if (panelTickInterval) clearInterval(panelTickInterval);
    panelTickInterval = setInterval(() => {
        if (serverState) updatePanelDisplay(serverState);
    }, 1000);
}

// =========================================================================
// SOCKET EVENTS — STATE + TEMPLATES
// =========================================================================
socket.on('stateSync', (state) => {
    serverState = state;
    updatePanelDisplay(state);
    updateMusicUI(state.music);

    bgCurrentName.textContent    = (state.backgroundMedia && state.backgroundMedia.name) || '—';
    musicCurrentName.textContent = (state.musicTrack && state.musicTrack.name) || '—';
    renderLibrary('background');
    renderLibrary('music');

    applyTextOverlayState(state.textOverlay);
});

socket.on('templatesSync', (templates) => {
    loadedTemplates = templates;
    const current = templateSelect.value;
    templateSelect.innerHTML = '';
    templates.forEach(t => {
        const opt = document.createElement('option');
        opt.value       = t.id;
        opt.textContent = t.name;
        templateSelect.appendChild(opt);
    });
    if (templates.find(t => t.id === current)) templateSelect.value = current;
});

startPanelTick();

// Initial media library load (stateSync re-renders these on every update after this)
loadLibrary('background');
loadLibrary('music');
