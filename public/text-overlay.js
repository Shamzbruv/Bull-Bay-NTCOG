// Read-only OBS browser source. Shows whatever text the admin pushes from the
// "OBS Text Display" section (lyrics, affirmations, scripture being read, etc).
const socket = io({ query: { role: 'overlay' } });

const box     = document.getElementById('text-overlay-box');
const content = document.getElementById('text-overlay-content');

function render(overlay) {
    const visible = !!(overlay && overlay.visible && overlay.text && overlay.text.trim());
    box.classList.toggle('hidden', !visible);
    if (visible) content.textContent = overlay.text;
}

socket.on('stateSync', (state) => render(state && state.textOverlay));
