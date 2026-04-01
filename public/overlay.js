// Role 'overlay' → joins the overlay Socket.IO room.
// This client never receives sanctuaryOverride events (rooms isolate it).
const socket = io({ query: { role: 'overlay' } });

// --- DOM REFS ---
const overlayContainer = document.getElementById('overlay-container');
const eventTitle       = document.getElementById('event-title');
const countdownWrap    = document.getElementById('countdown-wrap');
const statusWrap       = document.getElementById('status-wrap');
const statusText       = document.getElementById('status-text');
const hEl = document.getElementById('hours');
const mEl = document.getElementById('minutes');
const sEl = document.getElementById('seconds');

let serverState = null;

// --- Resolve phase using same logic as sanctuary display ---
function resolvePhase(state) {
    if (!state || !state.activeEvent) return 'blank';
    const forced = state.forcedState;
    if (forced === 'idle' || forced === 'ended') return 'blank';
    if (forced === 'delayed') return 'delayed';
    if (forced === 'live')    return 'live';
    if (forced === 'countdown') return 'countdown';
    if (forced === 'pre') {
        if (state.startTime) {
            return Date.now() < new Date(state.startTime).getTime() ? 'countdown' : 'pre';
        }
        return 'pre';
    }
    return 'pre';
}

socket.on('stateSync', (state) => {
    serverState = state;
});

function tick() {
    if (!serverState || !serverState.activeEvent) {
        overlayContainer.classList.add('hidden');
        requestAnimationFrame(tick);
        return;
    }

    const phase = resolvePhase(serverState);

    if (phase === 'blank') {
        overlayContainer.classList.add('hidden');
        requestAnimationFrame(tick);
        return;
    }

    overlayContainer.classList.remove('hidden');
    eventTitle.textContent = (serverState.activeEvent.name || '').trim();

    if (phase === 'countdown') {
        const diff = new Date(serverState.startTime).getTime() - Date.now();
        countdownWrap.classList.remove('hidden');
        statusWrap.classList.add('hidden');
        if (diff > 0) {
            hEl.textContent = String(Math.floor(diff / 3600000)).padStart(2, '0');
            mEl.textContent = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
            sEl.textContent = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        } else {
            hEl.textContent = '00';
            mEl.textContent = '00';
            sEl.textContent = '00';
        }
    } else if (phase === 'pre') {
        countdownWrap.classList.add('hidden');
        statusWrap.classList.remove('hidden');
        statusText.textContent = 'Starting Soon';
        statusText.style.color = 'var(--color-gold)';
    } else if (phase === 'delayed') {
        countdownWrap.classList.add('hidden');
        statusWrap.classList.remove('hidden');
        statusText.textContent = 'Please Stand By';
        statusText.style.color = 'var(--color-gold)';
    } else if (phase === 'live') {
        countdownWrap.classList.add('hidden');
        statusWrap.classList.remove('hidden');
        statusText.textContent = 'Live Now';
        statusText.style.color = '#e74c3c';
    }

    requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
