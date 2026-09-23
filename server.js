const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./lib/supabase');
const auth = require('./lib/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TEMPLATES_CACHE_FILE = path.join(__dirname, 'templates.json'); // local fallback/cache only
const RUNTIME_CACHE_FILE   = path.join(__dirname, 'runtime.json');   // local fallback/cache only

app.set('trust proxy', 1); // Railway sits behind a proxy — needed for correct req.ip on login throttling
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

/** Supabase is the durable source of truth (survives Railway redeploys, which wipe local
 *  disk). The local JSON file is kept only as a best-effort cache for offline development. */
async function loadTemplates() {
    const fromDb = db.enabled ? await db.loadTemplatesFromSupabase() : null;
    if (fromDb && fromDb.length) {
        eventTemplates = fromDb;
    } else {
        try {
            if (fs.existsSync(TEMPLATES_CACHE_FILE)) {
                eventTemplates = JSON.parse(fs.readFileSync(TEMPLATES_CACHE_FILE, 'utf8'));
            } else {
                eventTemplates = [...defaultTemplates];
            }
        } catch (e) {
            console.error('Error loading local templates cache:', e);
            eventTemplates = [...defaultTemplates];
        }
        // Seed Supabase from whatever we just loaded so it becomes the source of truth from now on.
        if (db.enabled) for (const t of eventTemplates) await db.saveTemplateToSupabase(t);
    }
    saveTemplatesCache();
}

function saveTemplatesCache() {
    try {
        fs.writeFileSync(TEMPLATES_CACHE_FILE, JSON.stringify(eventTemplates, null, 2));
    } catch (e) {
        console.error('Error saving local templates cache:', e);
    }
}

// ===========================================================================
// TEXT OVERLAY (lyrics / affirmations / scripture) — validation helpers
// ===========================================================================
const TEXT_OVERLAY_FONTS       = ['heading', 'elegant', 'body', 'bold', 'impact', 'script'];
const TEXT_OVERLAY_ALIGNS      = ['left', 'center', 'right'];
const TEXT_OVERLAY_POSITIONS   = ['top', 'middle', 'bottom'];
const TEXT_OVERLAY_BACKGROUNDS = ['glass', 'solid', 'none'];
const TEXT_OVERLAY_EFFECTS     = ['none', 'shadow', 'glow', 'outline', 'gradient'];
const TEXT_OVERLAY_ANIMATIONS  = ['none', 'fade', 'slide'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_TEXT_OVERLAY_STYLE = {
    fontFamily: 'heading', fontSize: 2.6, textColor: '#f8f9fa', accentColor: '#d4af37',
    align: 'center', position: 'bottom', background: 'glass', textEffect: 'shadow',
    animation: 'fade', uppercase: false, letterSpacing: 0, showDivider: true
};

/** Merges only well-formed, allow-listed fields onto `base` — this ends up as inline CSS
 *  on a public page, so it's validated even though only an authenticated admin can set it. */
function sanitizeTextOverlayStyle(input, base) {
    const s = { ...base };
    if (!input || typeof input !== 'object') return s;
    if (TEXT_OVERLAY_FONTS.includes(input.fontFamily))       s.fontFamily = input.fontFamily;
    if (typeof input.fontSize === 'number' && input.fontSize >= 1 && input.fontSize <= 6) s.fontSize = input.fontSize;
    if (typeof input.textColor === 'string' && HEX_COLOR_RE.test(input.textColor))       s.textColor = input.textColor;
    if (typeof input.accentColor === 'string' && HEX_COLOR_RE.test(input.accentColor))   s.accentColor = input.accentColor;
    if (TEXT_OVERLAY_ALIGNS.includes(input.align))           s.align = input.align;
    if (TEXT_OVERLAY_POSITIONS.includes(input.position))     s.position = input.position;
    if (TEXT_OVERLAY_BACKGROUNDS.includes(input.background)) s.background = input.background;
    if (TEXT_OVERLAY_EFFECTS.includes(input.textEffect))     s.textEffect = input.textEffect;
    if (TEXT_OVERLAY_ANIMATIONS.includes(input.animation))   s.animation = input.animation;
    if (typeof input.uppercase === 'boolean')                s.uppercase = input.uppercase;
    if (typeof input.letterSpacing === 'number' && input.letterSpacing >= -0.05 && input.letterSpacing <= 0.5) s.letterSpacing = input.letterSpacing;
    if (typeof input.showDivider === 'boolean')              s.showDivider = input.showDivider;
    return s;
}

function sanitizeSegments(input) {
    if (!Array.isArray(input)) return null;
    return input.slice(0, 200).map(seg => ({
        label: typeof seg?.label === 'string' ? seg.label.slice(0, 60) : 'Part',
        text:  typeof seg?.text  === 'string' ? seg.text.slice(0, 4000) : ''
    })).filter(seg => seg.text);
}

// ===========================================================================
// RUNTIME / SETTINGS PERSISTENCE  (survives server restarts and redeploys)
// ===========================================================================
async function loadSettings() {
    const [bg, music, text, runtime] = await Promise.all([
        db.getSetting('backgroundMedia'),
        db.getSetting('musicTrack'),
        db.getSetting('textOverlay'),
        db.getSetting('sanctuaryOverride')
    ]);
    if (bg)    appState.backgroundMedia = bg;
    if (music) appState.musicTrack      = music;
    if (text && typeof text === 'object') {
        // Merged rather than assigned outright — an earlier version of this app persisted
        // textOverlay as just { visible, text }, and this safely upgrades that shape too.
        appState.textOverlay = {
            visible:      typeof text.visible === 'boolean' ? text.visible : appState.textOverlay.visible,
            rawInput:     typeof text.rawInput === 'string' ? text.rawInput.slice(0, 20000) : appState.textOverlay.rawInput,
            segments:     Array.isArray(text.segments) ? (sanitizeSegments(text.segments) || []) : appState.textOverlay.segments,
            currentIndex: Number.isInteger(text.currentIndex) ? text.currentIndex : appState.textOverlay.currentIndex,
            style:        sanitizeTextOverlayStyle(text.style, appState.textOverlay.style)
        };
    }

    let resumedRuntime = runtime;
    if (!db.enabled) {
        try {
            if (fs.existsSync(RUNTIME_CACHE_FILE)) {
                resumedRuntime = JSON.parse(fs.readFileSync(RUNTIME_CACHE_FILE, 'utf8')).sanctuaryOverride;
            }
        } catch (e) { console.error('Error loading local runtime cache:', e); }
    }
    if (resumedRuntime && resumedRuntime.endsAt > Date.now()) {
        appState.sanctuaryOverride = resumedRuntime;
        console.log('Resumed active sanctuaryOverride from persisted settings');
        scheduleOutroClear(resumedRuntime.endsAt - Date.now());
    }
}

function saveRuntime() {
    db.setSetting('sanctuaryOverride', appState.sanctuaryOverride).catch(() => {});
    try {
        fs.writeFileSync(RUNTIME_CACHE_FILE, JSON.stringify({ sanctuaryOverride: appState.sanctuaryOverride }, null, 2));
    } catch (e) {
        console.error('Error saving local runtime cache:', e);
    }
}

// ===========================================================================
// OUTRO OVERLAY SCRIPT  (4m 33s = 273 000 ms)
// Blessing, scripture, and send-off messages only.
// ===========================================================================
const DEFAULT_OUTRO_OVERLAYS = [
    { startMs:      0, endMs:  30000, line1: "Thank you for worshiping with us today.", line2: "" },
    { startMs:  30000, endMs:  60000, line1: "May the Lord bless you and keep you.", line2: "" },
    { startMs:  60000, endMs:  95000, line1: "The Lord bless thee, and keep thee: the Lord make His face shine upon thee.", line2: "— Numbers 6:24–25" },
    { startMs:  95000, endMs: 125000, line1: "May His peace go with you throughout this week.", line2: "" },
    { startMs: 125000, endMs: 160000, line1: "The Lord shall preserve thy going out and thy coming in, from this time forth.", line2: "— Psalm 121:8" },
    { startMs: 160000, endMs: 190000, line1: "Walk in faith. Walk in love. Walk in His grace.", line2: "" },
    { startMs: 190000, endMs: 225000, line1: "Let the peace of God rule in your hearts… and be ye thankful.", line2: "— Colossians 3:15" },
    { startMs: 225000, endMs: 250000, line1: "The grace of our Lord Jesus Christ be with you all.", line2: "" },
    { startMs: 250000, endMs: 273000, line1: "Go in peace.", line2: "God bless you." }
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
    sanctuaryOverride: null,  // only emitted in full to the 'sanctuary' room
    backgroundMedia:   null,  // { url, kind: 'video'|'image', name, path } — set from the Media Library
    musicTrack:        null,  // { url, name, path } — set from the Media Library
    textOverlay:       {      // OBS Lyrics & Text Display (separate transparent overlay)
        visible:      false,
        rawInput:     '',           // the operator's pasted lyrics, kept so it can be re-split later
        segments:     [],           // [{ label, text }] — one per verse/chorus/etc.
        currentIndex: 0,            // which segment is on screen
        style:        DEFAULT_TEXT_OVERLAY_STYLE
    }
};

let outroTimerHandle = null;

// ===========================================================================
// BROADCAST HELPERS
// ===========================================================================
function broadcastState() {
    io.emit('stateSync', appState);
}

function broadcastTemplates() {
    io.emit('templatesSync', eventTemplates);
}

function broadcastSanctuaryOverride() {
    io.to('sanctuary').emit('sanctuaryOverride', appState.sanctuaryOverride);
    io.to('admin').emit('sanctuaryOverride', appState.sanctuaryOverride);
}

function broadcastSanctuaryClear() {
    io.to('sanctuary').emit('sanctuaryOverrideClear');
    io.to('admin').emit('sanctuaryOverrideClear');
}

async function broadcastSanctuaryCount() {
    try {
        const sockets = await io.in('sanctuary').fetchSockets();
        io.to('admin').emit('sanctuaryCount', sockets.length);
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
// AUTH ROUTES  (public)
// ===========================================================================
app.post('/api/login', async (req, res) => {
    const ip = req.ip;
    const { allowed, retryAfterMs } = auth.checkRateLimit(ip);
    if (!allowed) {
        return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minute(s).` });
    }
    const password = (req.body && req.body.password) || '';
    const ok = await auth.verifyAdminPassword(password);
    if (!ok) {
        auth.recordFailure(ip);
        return res.status(401).json({ error: 'Incorrect password.' });
    }
    auth.recordSuccess(ip);
    auth.setSessionCookie(res);
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    auth.clearSessionCookie(res);
    res.json({ ok: true });
});

app.post('/api/change-password', auth.requireAdminApi, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const ok = await auth.verifyAdminPassword(currentPassword || '');
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    await auth.setAdminPassword(String(newPassword));
    res.json({ ok: true });
});

// ===========================================================================
// PROTECTED PAGE — admin.html requires a valid session; everything else in
// public/ (the sanctuary display, both OBS overlays, and the login page)
// is intentionally public since TVs and OBS browser sources need it.
// ===========================================================================
app.get('/admin.html', auth.requireAdminPage, (req, res, next) => next());
app.get('/login.html', (req, res, next) => {
    if (auth.isRequestAuthenticated(req)) return res.redirect('/admin.html');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

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

// ---------------------------------------------------------------------------
// MEDIA LIBRARY  (background video/image + background music — admin only)
// Backed by the Supabase Storage bucket "countdown-media" so uploads survive
// a Railway redeploy, unlike files saved to local disk.
// ---------------------------------------------------------------------------
const LIBRARY_FOLDERS = { background: 'backgrounds', music: 'audio' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/api/media/library', auth.requireAdminApi, async (req, res) => {
    const folder = LIBRARY_FOLDERS[req.query.kind];
    if (!folder) return res.status(400).json({ error: 'kind must be "background" or "music"' });
    if (!db.enabled) return res.json([]);
    res.json(await db.listLibrary(folder));
});

app.post('/api/media/upload', auth.requireAdminApi, upload.single('file'), async (req, res) => {
    const kind = req.body.kind;
    const folder = LIBRARY_FOLDERS[kind];
    if (!folder) return res.status(400).json({ error: 'kind must be "background" or "music"' });
    if (!db.enabled) return res.status(503).json({ error: 'Supabase is not configured on this server.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const mime = req.file.mimetype || '';
    const validType = kind === 'music' ? mime.startsWith('audio/') : (mime.startsWith('video/') || mime.startsWith('image/'));
    if (!validType) return res.status(400).json({ error: `That file type isn't allowed for ${kind}.` });

    try {
        const item = await db.uploadToLibrary(folder, req.file.originalname, req.file.buffer, mime);
        res.json({ ...item, mimeType: mime });
    } catch (e) {
        console.error('Upload failed:', e.message);
        res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
});

app.delete('/api/media/:kind/:filename', auth.requireAdminApi, async (req, res) => {
    const folder = LIBRARY_FOLDERS[req.params.kind];
    if (!folder) return res.status(400).json({ error: 'kind must be "background" or "music"' });
    const filePath = `${folder}/${req.params.filename}`;

    const inUse = (appState.backgroundMedia && appState.backgroundMedia.path === filePath) ||
                  (appState.musicTrack && appState.musicTrack.path === filePath);
    if (inUse) return res.status(400).json({ error: "Can't delete the item currently in use — switch to another one first." });

    await db.deleteFromLibrary(filePath);
    res.json({ ok: true });
});

// ===========================================================================
// WEBSOCKET — ROOMS + HANDLERS
// ===========================================================================
// Every socket's admin privileges are decided once here, from its login
// cookie — never from the client-supplied `role` query string, which anyone
// can fake from a browser console.
io.use((socket, next) => {
    socket.data.isAdmin = auth.isSocketAuthenticated(socket);
    next();
});

io.on('connection', (socket) => {
    let requestedRole = socket.handshake.query.role || 'sanctuary';
    if (requestedRole === 'admin' && !socket.data.isAdmin) {
        socket.emit('authError', 'Your session has expired. Please log in again.');
        socket.disconnect(true);
        return;
    }
    const role = requestedRole;
    socket.join(role);
    console.log(`Client connected: ${socket.id}  role=${role}${socket.data.isAdmin ? ' (authenticated)' : ''}`);
    if (role === 'sanctuary' || role === 'admin') setImmediate(broadcastSanctuaryCount);

    // Send current state on connect
    socket.emit('stateSync', appState);
    socket.emit('templatesSync', eventTemplates);

    if ((role === 'sanctuary' || role === 'admin') && appState.sanctuaryOverride) {
        socket.emit('sanctuaryOverride', appState.sanctuaryOverride);
    }

    /** Every state-changing event is gated behind this — set once at connect time from the
     *  verified session cookie, never from anything the client can influence per-event. */
    function ifAdmin(handler) {
        return (...args) => { if (socket.data.isAdmin) handler(...args); };
    }

    // --- EVENT CONTROLS ---
    socket.on('setEvent', ifAdmin((data) => {
        if (!data || isNaN(new Date(data.startTime))) return;
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
    }));

    socket.on('addDelay', ifAdmin((minutes) => {
        if (!appState.startTime || !Number.isFinite(Number(minutes))) return;
        const currentStart = new Date(appState.startTime);
        currentStart.setMinutes(currentStart.getMinutes() + Number(minutes));
        appState.startTime = currentStart.toISOString();
        console.log(`Added ${minutes} minutes delay. Target: ${appState.startTime}`);
        broadcastState();
    }));

    socket.on('musicControl', ifAdmin((data) => {
        if (!data) return;
        if (typeof data.playing === 'boolean') appState.music.playing = data.playing;
        if (typeof data.volume  === 'number')  appState.music.volume  = Math.min(1, Math.max(0, data.volume));
        if (typeof data.loop    === 'boolean') appState.music.loop    = data.loop;
        console.log(`Music: playing=${appState.music.playing} volume=${appState.music.volume} loop=${appState.music.loop}`);
        broadcastState();
    }));

    socket.on('musicRestart', ifAdmin(() => {
        appState.music.restartPulse = Date.now();
        appState.music.playing = true;
        console.log('Music restart triggered');
        broadcastState();
    }));

    socket.on('forceState', ifAdmin((newState) => {
        appState.forcedState = newState;
        console.log(`State forced: ${newState}`);
        broadcastState();
    }));

    // --- MEDIA LIBRARY SELECTION ---
    socket.on('selectBackgroundMedia', ifAdmin((data) => {
        if (!data || !data.url || !data.kind) return;
        appState.backgroundMedia = { url: data.url, kind: data.kind, name: data.name || '', path: data.path || '' };
        db.setSetting('backgroundMedia', appState.backgroundMedia).catch(() => {});
        console.log('Background media selected:', appState.backgroundMedia.name);
        broadcastState();
    }));

    socket.on('selectMusicTrack', ifAdmin((data) => {
        if (!data || !data.url) return;
        appState.musicTrack = { url: data.url, name: data.name || '', path: data.path || '' };
        db.setSetting('musicTrack', appState.musicTrack).catch(() => {});
        console.log('Music track selected:', appState.musicTrack.name);
        broadcastState();
    }));

    // --- OBS LYRICS & TEXT DISPLAY (lyrics / affirmations / scripture reading) ---
    // Accepts a partial patch — the admin panel sends only the field(s) that changed
    // (loading new lyrics, stepping to another verse, a style tweak, or show/hide).
    socket.on('updateTextOverlay', ifAdmin((patch) => {
        if (!patch || typeof patch !== 'object') return;
        const to = appState.textOverlay;
        if (typeof patch.rawInput === 'string') to.rawInput = patch.rawInput.slice(0, 20000);
        if (patch.segments !== undefined) {
            const seg = sanitizeSegments(patch.segments);
            if (seg) to.segments = seg;
        }
        if (Number.isInteger(patch.currentIndex)) {
            to.currentIndex = Math.max(0, Math.min(patch.currentIndex, Math.max(0, to.segments.length - 1)));
        }
        if (typeof patch.visible === 'boolean') to.visible = patch.visible;
        if (patch.style !== undefined) to.style = sanitizeTextOverlayStyle(patch.style, to.style);
        db.setSetting('textOverlay', to).catch(() => {});
        broadcastState();
    }));

    // --- OUTRO CONTROLS ---
    socket.on('startOutro', ifAdmin(() => {
        // Screens ignore a second start while one is playing, so restarting here would only
        // desync the server timer from what they're showing. Stop it first to restart.
        if (appState.sanctuaryOverride) return;
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
    }));

    socket.on('clearOutro', ifAdmin(() => {
        clearOutro('admin');
    }));

    /** Called by sanctuary clients when video naturally ends */
    socket.on('sanctuaryOutroEnded', () => {
        if (role !== 'sanctuary') return;
        console.log(`Sanctuary outro ended signal from ${socket.id}`);
        clearOutro('client-ended');
    });

    /** Audio-block telemetry from sanctuary clients */
    socket.on('audioBlocked', (data) => {
        if (role !== 'sanctuary') return;
        console.warn(`Audio blocked on sanctuary screen ${socket.id}:`, data);
        io.to('admin').emit('audioBlocked', { socketId: socket.id, ...data });
    });

    // --- TEMPLATE MANAGER ---
    socket.on('saveTemplate', ifAdmin((templateData) => {
        if (!templateData || typeof templateData !== 'object') return;
        const idx = eventTemplates.findIndex(t => t.id === templateData.id);
        if (idx !== -1) {
            eventTemplates[idx] = templateData;
        } else {
            if (!templateData.id) templateData.id = 'tpl_' + Date.now();
            eventTemplates.push(templateData);
        }
        saveTemplatesCache();
        db.saveTemplateToSupabase(templateData).catch(() => {});
        broadcastTemplates();
    }));

    socket.on('deleteTemplate', ifAdmin((templateId) => {
        eventTemplates = eventTemplates.filter(t => t.id !== templateId);
        saveTemplatesCache();
        db.deleteTemplateFromSupabase(templateId).catch(() => {});
        broadcastTemplates();
    }));

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}  role=${role}`);
        if (role === 'sanctuary') setImmediate(broadcastSanctuaryCount);
    });
});

// ===========================================================================
// BOOT
// ===========================================================================
async function main() {
    await auth.init();
    await loadTemplates();
    await loadSettings();

    if (appState.sanctuaryOverride) {
        // Broadcast resumed outro after a short delay so room assignments settle
        setTimeout(() => {
            console.log('Broadcasting resumed sanctuaryOverride after boot delay');
            broadcastSanctuaryOverride();
        }, 500);
    }

    server.listen(PORT, () => {
        console.log(`System running at http://localhost:${PORT}`);
        if (!db.enabled) {
            console.warn('⚠ Running WITHOUT Supabase — templates/media/settings will not persist across a redeploy.');
        }
    });
}

main();
