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
    // Provide immediate optimistic feedback on button
    outroConfirmBtn.textContent = '✓ Outro Started';
    setTimeout(() => { outroConfirmBtn.textContent = '▶ Start Outro Now'; }, 3000);
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

function updateOutroStrip() {
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
        return Date.now() < new Date(state.startTime).getTime() ? 'countdown' : 'pre';
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
    dispState.textContent = phase.toUpperCase();

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

// =========================================================================
// AUDIO FILE DETECTION
// =========================================================================
const nowPlayingEl = document.querySelector('.music-now-playing');
fetch('/api/audio')
    .then(r => r.json())
    .then(data => {
        if (nowPlayingEl) {
            nowPlayingEl.textContent = data.file
                ? `Now playing: ${data.file}`
                : 'No audio file found in public/audio/';
        }
    })
    .catch(() => {});
