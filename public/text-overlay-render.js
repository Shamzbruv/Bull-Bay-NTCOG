// Shared between text-overlay.js (the real OBS browser source) and admin.js (the live
// preview in the admin panel), so what the operator sees while styling always matches
// what actually goes out over OBS.
const TEXT_OVERLAY_FONTS = {
    heading: "'Cinzel', serif",
    elegant: "'Playfair Display', serif",
    body:    "'Outfit', sans-serif",
    bold:    "'Montserrat', sans-serif",
    impact:  "'Bebas Neue', sans-serif",
    script:  "'Great Vibes', cursive"
};

/**
 * Renders one textOverlay state into a { frame, box, content, divider } element set.
 *
 * `renderState` is a plain object ({ lastKey: null }) the caller owns and passes back in
 * every time — it's how this function knows whether the segment actually changed, so the
 * entrance animation only replays on a real verse change and not on every unrelated
 * stateSync broadcast (e.g. someone moving the music volume slider elsewhere in the app).
 *
 * `opts.forceVisible`, used by the admin preview, ignores the live show/hide flag so the
 * operator can keep styling and stepping through verses while off-air.
 */
function renderTextOverlayInto(els, overlay, renderState, opts) {
    const { frame, box, content, divider } = els;
    const forceVisible = !!(opts && opts.forceVisible);

    const seg        = overlay && overlay.segments && overlay.segments[overlay.currentIndex];
    const style       = (overlay && overlay.style) || {};
    const hasContent = !!(seg && seg.text);
    const visible     = forceVisible ? hasContent : !!(overlay && overlay.visible && hasContent);

    box.classList.toggle('hidden', !visible);
    if (!visible) { renderState.lastKey = null; return; }

    box.style.setProperty('--to-color', style.textColor || '#f8f9fa');
    box.style.setProperty('--to-accent', style.accentColor || '#d4af37');
    box.style.setProperty('--to-size', (style.fontSize || 2.6) + 'rem');
    box.style.setProperty('--to-family', TEXT_OVERLAY_FONTS[style.fontFamily] || TEXT_OVERLAY_FONTS.heading);
    box.style.setProperty('--to-align', style.align || 'center');
    box.style.setProperty('--to-tracking', (style.letterSpacing || 0) + 'em');
    box.dataset.align = style.align || 'center';

    box.classList.remove('to-bg-glass', 'to-bg-solid', 'to-bg-none');
    box.classList.add('to-bg-' + (style.background || 'glass'));

    content.textContent = seg.text;
    content.classList.remove('to-fx-none', 'to-fx-shadow', 'to-fx-glow', 'to-fx-outline', 'to-fx-gradient', 'to-uppercase');
    content.classList.add('to-fx-' + (style.textEffect || 'shadow'));
    if (style.uppercase) content.classList.add('to-uppercase');

    if (divider) divider.classList.toggle('hidden', style.showDivider === false);

    if (frame) {
        frame.style.alignItems = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[style.position] || 'flex-end';
    }

    // Only replay the entrance animation when the segment (or its animation choice) actually changed.
    const key = overlay.currentIndex + '|' + seg.text + '|' + (style.animation || 'fade');
    if (key !== renderState.lastKey) {
        renderState.lastKey = key;
        box.classList.remove('to-anim-fade', 'to-anim-slide');
        const animName = style.animation || 'fade';
        if (animName !== 'none') {
            void box.offsetWidth; // force a reflow so the animation restarts even from the same class
            box.classList.add('to-anim-' + animName);
        }
    }
}
