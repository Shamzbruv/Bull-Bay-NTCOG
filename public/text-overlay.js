// Read-only OBS browser source. Shows whichever verse/segment the admin has navigated to
// in "OBS Lyrics & Text Display", styled however the operator has customized it there.
const socket = io({ query: { role: 'overlay' } });

const els = {
    frame:   document.body,
    box:     document.getElementById('text-overlay-box'),
    content: document.getElementById('text-overlay-content'),
    divider: document.getElementById('text-overlay-divider')
};
const renderState = { lastKey: null };

socket.on('stateSync', (state) => {
    renderTextOverlayInto(els, state && state.textOverlay, renderState);
});
