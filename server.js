const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
const RUNTIME_FILE   = path.join(__dirname, 'runtime.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ===========================================================================
// TEMPLATES
// ===========================================================================
const defaultTemplates = [
    {
        id: 'sunday_service',
        name: 'Sunday Service',
        subtitle: 'Sunday Worship',
        preMessages: [
            "We are happy to have you with us this Sunday morning.",
            "Our pre-service countdown begins soon."
        ],
        delayedMessages: [
            "We will begin shortly.",
            "Please stand by as we prepare for worship."
        ],
        liveMessage: "We Are Now Live",
        liveSubmessage: "Please join us as worship begins",
        footerText: "",
        notices: [
            "Welcome to Bull Bay New Testament Church of God. We are glad you are here.",
            "Please prepare your heart and mind for worship.",
            "Kindly silence your phones and other devices."
        ],
        hasStreamLabel: true
    },
    {
        id: 'prayer_meeting',
        name: 'Prayer Meeting',
        subtitle: 'Midweek Service',
        preMessages: [
            "Welcome to our Prayer Meeting.",
            "Please prepare your heart for prayer."
        ],
        delayedMessages: [
            "We will begin our Prayer Meeting shortly.",
            "Thank you for waiting."
        ],
        liveMessage: "We Are Now Live",
        liveSubmessage: "Let us unite our hearts in prayer.",
        footerText: "",
        notices: [
            "If you must move, please do so quietly.",
            "Let us maintain reverence as we begin shortly.",
            "Kindly silence your mobile devices."
        ],
        hasStreamLabel: true
    }
];

let eventTemplates = [];

function loadTemplates() {
    try {
        if (fs.existsSync(TEMPLATES_FILE)) {
            const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
            eventTemplates = JSON.parse(data);
        } else {
            eventTemplates = [...defaultTemplates];
            saveTemplates();
        }
    } catch (e) {
        console.error("Error loading templates:", e);
        eventTemplates = [...defaultTemplates];
    }
}

function saveTemplates() {
    try {
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(eventTemplates, null, 2));
    } catch (e) {
        console.error("Error saving templates:", e);
    }
}

loadTemplates();

// ===========================================================================
// RUNTIME PERSISTENCE  (sanctuaryOverride survives server restarts)
// ===========================================================================
function loadRuntime() {
    try {
        if (fs.existsSync(RUNTIME_FILE)) {
            const data = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
            // Resume override only if it hasn't expired yet
            if (data.sanctuaryOverride && data.sanctuaryOverride.endsAt > Date.now()) {
                appState.sanctuaryOverride = data.sanctuaryOverride;
                console.log('Resumed active sanctuaryOverride from runtime.json');
                // Schedule auto-clear at endsAt
                scheduleOutroClear(data.sanctuaryOverride.endsAt - Date.now());
            }
        }
    } catch (e) {
        console.error("Error loading runtime.json:", e);
    }
}

function saveRuntime() {
    try {
        fs.writeFileSync(RUNTIME_FILE, JSON.stringify({
            sanctuaryOverride: appState.sanctuaryOverride
        }, null, 2));
    } catch (e) {
        console.error("Error saving runtime.json:", e);
    }
}

// ===========================================================================
// OUTRO OVERLAY SCRIPT  (4m 33s = 273 000 ms)
// Blessing, scripture, and send-off messages only.
// ===========================================================================
const DEFAULT_OUTRO_OVERLAYS = [
    {
        startMs:      0, endMs:  30000,
        line1: "Thank you for worshiping with us today.",
        line2: ""
    },
    {
        startMs:  30000, endMs:  60000,
        line1: "May the Lord bless you and keep you.",
        line2: ""
    },
    {
        startMs:  60000, endMs:  95000,
        line1: "The Lord bless thee, and keep thee: the Lord make His face shine upon thee.",
        line2: "\u2014 Numbers 6:24\u201325"
    },
    {
        startMs:  95000, endMs: 125000,
        line1: "May His peace go with you throughout this week.",
        line2: ""
    },
    {
        startMs: 125000, endMs: 160000,
        line1: "The Lord shall preserve thy going out and thy coming in, from this time forth.",
        line2: "\u2014 Psalm 121:8"
    },
    {
        startMs: 160000, endMs: 190000,
        line1: "Walk in faith. Walk in love. Walk in His grace.",
        line2: ""
    },
    {
        startMs: 190000, endMs: 225000,
        line1: "Let the peace of God rule in your hearts\u2026 and be ye thankful.",
        line2: "\u2014 Colossians 3:15"
    },
    {
        startMs: 225000, endMs: 250000,
        line1: "The grace of our Lord Jesus Christ be with you all.",
        line2: ""
    },
    {
        startMs: 250000, endMs: 273000,
        line1: "Go in peace.",
        line2: "God bless you."
    }
];

// ===========================================================================
// GLOBAL APPLICATION STATE
// ===========================================================================
let appState = {
    activeEvent:       null,
    forcedState:       'idle',
    startTime:         null,
    isLive:            false,
    music:             { playing: false, volume: 0.6, loop: true },
    sanctuaryOverride: null   // NEW — only emitted to 'sanctuary' room
};

let outroTimerHandle = null;

// ===========================================================================
// BROADCAST HELPERS
// ===========================================================================
function broadcastState() {
    // Broadcast full state to EVERYONE (admin, overlay, sanctuary)
    // sanctuaryOverride is included so admin can subscribe without
    // needing a separate channel, but sanctuary clients gave it priority.
    io.emit('stateSync', appState);
}

function broadcastTemplates() {
    io.emit('templatesSync', eventTemplates);
}

/** Emit sanctuaryOverride only to the sanctuary room (and admins for status). */
function broadcastSanctuaryOverride() {
    io.to('sanctuary').emit('sanctuaryOverride', appState.sanctuaryOverride);
    // Also tell admins so they can show the status strip
    io.to('admin').emit('sanctuaryOverride', appState.sanctuaryOverride);
}

function broadcastSanctuaryClear() {
    io.to('sanctuary').emit('sanctuaryOverrideClear');
    io.to('admin').emit('sanctuaryOverrideClear');
}

/** Count sanctuary sockets and broadcast the count to all admins. */
async function broadcastSanctuaryCount() {
    try {
        const sockets = await io.in('sanctuary').allSockets();
        io.to('admin').emit('sanctuaryCount', sockets.size);
    } catch (_) {}
}

// ===========================================================================
// OUTRO LIFECYCLE
// ===========================================================================
function scheduleOutroClear(msFromNow) {
    if (outroTimerHandle) clearTimeout(outroTimerHandle);
    outroTimerHandle = setTimeout(() => {
        console.log('Outro timer elapsed — clearing sanctuaryOverride');
        clearOutro('timer');
    }, Math.max(0, msFromNow));
}

function clearOutro(source) {
    if (!appState.sanctuaryOverride) return;
    console.log(`Clearing sanctuaryOverride (source: ${source})`);
    appState.sanctuaryOverride = null;
    if (outroTimerHandle) { clearTimeout(outroTimerHandle); outroTimerHandle = null; }
    saveRuntime();
    broadcastSanctuaryClear();
}

// ===========================================================================
// REST ENDPOINTS
// ===========================================================================
app.get('/api/templates', (req, res) => res.json(eventTemplates));
app.get('/api/state',     (req, res) => res.json(appState));

/** Runtime state — used by sanctuary clients on reconnect to re-sync. */
app.get('/api/runtime', (req, res) => {
    res.json({ sanctuaryOverride: appState.sanctuaryOverride || null });
});

/** Check whether an outro media file exists so admin can warn operator. */
app.get('/api/media/outro', (req, res) => {
    const mp3path = path.join(__dirname, 'public', 'media', 'Go in Peace.mp3');
    const mp4path = path.join(__dirname, 'public', 'media', 'outro.mp4');
    const hasMp3  = fs.existsSync(mp3path);
    const hasMp4  = fs.existsSync(mp4path);
    res.json({
        exists: hasMp3 || hasMp4,
        kind:   hasMp3 ? 'audio' : (hasMp4 ? 'video' : null)
    });
});

// Auto-detect audio file in public/audio/
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
const MIME_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac'
};

app.get('/api/audio', (req, res) => {
    try {
        if (!fs.existsSync(AUDIO_DIR)) return res.json({ file: null });
        const files = fs.readdirSync(AUDIO_DIR).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return MIME_TYPES[ext] !== undefined;
        });
        if (!files.length) return res.json({ file: null });
        const filename = files[0];
        const ext      = path.extname(filename).toLowerCase();
        res.json({
            file:     filename,
            url:      '/audio/' + encodeURIComponent(filename),
            mimeType: MIME_TYPES[ext]
        });
    } catch (e) {
        res.json({ file: null });
    }
});

// ===========================================================================
// WEBSOCKET — ROOMS + HANDLERS
// ===========================================================================
io.on('connection', (socket) => {
    // --- Role-based room assignment ---
    const role = socket.handshake.query.role || 'sanctuary'; // default → sanctuary
    socket.join(role);
    console.log(`Client connected: ${socket.id}  role=${role}`);
    // Notify admins of updated sanctuary TV count
    if (role === 'sanctuary') setImmediate(broadcastSanctuaryCount);

    // Send current state on connect
    socket.emit('stateSync', appState);
    socket.emit('templatesSync', eventTemplates);

    // If this is a sanctuary client and an outro is active, send it immediately
    if ((role === 'sanctuary' || role === 'admin') && appState.sanctuaryOverride) {
        socket.emit('sanctuaryOverride', appState.sanctuaryOverride);
    }

    // --- EVENT CONTROLS ---
    socket.on('setEvent', (data) => {
        if (data.isOneTime && data.oneTimeData) {
            appState.activeEvent = { ...data.oneTimeData, id: 'one_time_custom' };
            console.log("Started One-Time Event:", appState.activeEvent.name);
        } else {
            const template = eventTemplates.find(t => t.id === data.templateId) || eventTemplates[0];
            appState.activeEvent = { ...template };
            console.log("Started Template Event:", appState.activeEvent.name);
        }
        appState.startTime   = data.startTime;
        appState.isLive      = data.isLive;
        appState.forcedState = 'pre';
        broadcastState();
    });

    socket.on('addDelay', (minutes) => {
        if (!appState.startTime) return;
        const currentStart = new Date(appState.startTime);
        currentStart.setMinutes(currentStart.getMinutes() + Number(minutes));
        appState.startTime = currentStart.toISOString();
        console.log(`Added ${minutes} minutes delay. Target: ${appState.startTime}`);
        broadcastState();
    });

    socket.on('musicControl', (data) => {
        if (typeof data.playing === 'boolean') appState.music.playing = data.playing;
        if (typeof data.volume  === 'number')  appState.music.volume  = Math.min(1, Math.max(0, data.volume));
        if (typeof data.loop    === 'boolean') appState.music.loop    = data.loop;
        console.log(`Music: playing=${appState.music.playing} volume=${appState.music.volume} loop=${appState.music.loop}`);
        broadcastState();
    });

    socket.on('musicRestart', () => {
        appState.music.restartPulse = Date.now();
        appState.music.playing = true;
        console.log('Music restart triggered');
        broadcastState();
    });

    socket.on('forceState', (newState) => {
        appState.forcedState = newState;
        console.log(`State forced: ${newState}`);
        broadcastState();
    });

    // --- OUTRO CONTROLS ---

    socket.on('startOutro', () => {
        const DURATION_MS = 273000; // 4:33 exactly
        const now = Date.now();
        appState.sanctuaryOverride = {
            type:       'OUTRO',
            startedAt:  now,
            durationMs: DURATION_MS,
            endsAt:     now + DURATION_MS,
            media:      { kind: 'audio', src: '/media/Go%20in%20Peace.mp3' },
            overlays:   DEFAULT_OUTRO_OVERLAYS,
            returnTo:   'IDLE'
        };
        console.log('Sanctuary outro started — endsAt:', new Date(appState.sanctuaryOverride.endsAt).toISOString());
        saveRuntime();
        scheduleOutroClear(DURATION_MS);
        broadcastSanctuaryOverride();
    });

    socket.on('clearOutro', () => {
        clearOutro('admin');
    });

    /** Called by sanctuary clients when video naturally ends */
    socket.on('sanctuaryOutroEnded', () => {
        console.log(`Sanctuary outro ended signal from ${socket.id}`);
        clearOutro('client-ended');
    });

    /** Audio-block telemetry from sanctuary clients */
    socket.on('audioBlocked', (data) => {
        console.warn(`Audio blocked on sanctuary screen ${socket.id}:`, data);
        // Relay to admins so the status strip can show a warning
        io.to('admin').emit('audioBlocked', { socketId: socket.id, ...data });
    });

    // --- TEMPLATE MANAGER ---
    socket.on('saveTemplate', (templateData) => {
        const idx = eventTemplates.findIndex(t => t.id === templateData.id);
        if (idx !== -1) {
            eventTemplates[idx] = templateData;
        } else {
            if (!templateData.id) templateData.id = 'tpl_' + Date.now();
            eventTemplates.push(templateData);
        }
        saveTemplates();
        broadcastTemplates();
    });

    socket.on('deleteTemplate', (templateId) => {
        eventTemplates = eventTemplates.filter(t => t.id !== templateId);
        saveTemplates();
        broadcastTemplates();
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}  role=${role}`);
        if (role === 'sanctuary') setImmediate(broadcastSanctuaryCount);
    });
});

// ===========================================================================
// BOOT
// ===========================================================================
loadRuntime(); // Must come after appState is defined and helpers exist

// Broadcast resumed outro after a short delay so room assignments settle
if (appState.sanctuaryOverride) {
    setTimeout(() => {
        console.log('Broadcasting resumed sanctuaryOverride after boot delay');
        broadcastSanctuaryOverride();
    }, 500);
}

server.listen(PORT, () => {
    console.log(`System running at http://localhost:${PORT}`);
});
