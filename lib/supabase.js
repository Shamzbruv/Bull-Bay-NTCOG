// ===========================================================================
// SUPABASE ACCESS LAYER
// ===========================================================================
// This project shares one Supabase project ("Bull Bay NTCOG Games") with
// another platform. To stay out of its way:
//   - every table this app owns is prefixed `countdown_`
//   - all app data lives in its own storage bucket, `countdown-media`
//   - both tables have Row Level Security ON with zero policies, so the
//     public anon key (if it were ever used) gets no access at all — only
//     this server, using the service_role key below, can read or write them.
//
// The service_role key must NEVER be sent to a browser. It only lives here,
// on the server, loaded from the environment (.env locally, Railway
// Variables in production).
// ===========================================================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const enabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

if (!enabled) {
    console.warn(
        '⚠ SUPABASE_URL / SUPABASE_SERVICE_KEY not set — templates, settings, and the ' +
        'media library will fall back to local files and cannot persist across a Railway redeploy.'
    );
}

const supabase = enabled
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
        // supabase-js always constructs a realtime client, which needs a WebSocket
        // implementation — Node 20 (Railway's default) has none built in. We never use
        // realtime subscriptions here (just REST/storage), but without this the app
        // crashes on boot. See: github.com/supabase/supabase-js WebSocketFactory error.
        realtime: { transport: require('ws') }
    })
    : null;

const BUCKET = 'countdown-media';

// ---------------------------------------------------------------------------
// Settings (key/value) — admin auth, current background/music selection,
// the live text-overlay content, and the sanctuary outro runtime state.
// ---------------------------------------------------------------------------
async function getSetting(key) {
    if (!enabled) return null;
    const { data, error } = await supabase
        .from('countdown_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    if (error) { console.error(`getSetting(${key}):`, error.message); return null; }
    return data ? data.value : null;
}

async function setSetting(key, value) {
    if (!enabled) return;
    const { error } = await supabase
        .from('countdown_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.error(`setSetting(${key}):`, error.message);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
async function loadTemplatesFromSupabase() {
    if (!enabled) return null;
    const { data, error } = await supabase.from('countdown_templates').select('id, data');
    if (error) { console.error('loadTemplatesFromSupabase:', error.message); return null; }
    if (!data || !data.length) return null;
    return data.map(row => row.data);
}

async function saveTemplateToSupabase(template) {
    if (!enabled) return;
    const { error } = await supabase
        .from('countdown_templates')
        .upsert({ id: template.id, data: template, updated_at: new Date().toISOString() });
    if (error) console.error('saveTemplateToSupabase:', error.message);
}

async function deleteTemplateFromSupabase(id) {
    if (!enabled) return;
    const { error } = await supabase.from('countdown_templates').delete().eq('id', id);
    if (error) console.error('deleteTemplateFromSupabase:', error.message);
}

// ---------------------------------------------------------------------------
// Media library (Supabase Storage) — background video/image + music tracks.
// Folder layout inside the bucket: backgrounds/*, audio/*
// ---------------------------------------------------------------------------
function publicUrlFor(path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function listLibrary(folder) {
    if (!enabled) return [];
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, {
        sortBy: { column: 'created_at', order: 'desc' }
    });
    if (error) { console.error(`listLibrary(${folder}):`, error.message); return []; }
    return (data || [])
        .filter(f => f.name && f.id) // real objects only, not the folder placeholder
        .map(f => ({
            name: f.name,
            path: `${folder}/${f.name}`,
            url: publicUrlFor(`${folder}/${f.name}`),
            size: f.metadata?.size || 0,
            mimeType: f.metadata?.mimetype || null,
            createdAt: f.created_at
        }));
}

async function uploadToLibrary(folder, filename, buffer, mimeType) {
    if (!enabled) throw new Error('Supabase is not configured');
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const path = `${folder}/${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
        contentType: mimeType,
        upsert: false
    });
    if (error) throw error;
    return { name: safeName, path, url: publicUrlFor(path) };
}

async function deleteFromLibrary(path) {
    if (!enabled) return;
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) console.error(`deleteFromLibrary(${path}):`, error.message);
}

module.exports = {
    enabled,
    getSetting,
    setSetting,
    loadTemplatesFromSupabase,
    saveTemplateToSupabase,
    deleteTemplateFromSupabase,
    listLibrary,
    uploadToLibrary,
    deleteFromLibrary
};
