const form       = document.getElementById('login-form');
const passwordEl = document.getElementById('login-password');
const errorEl    = document.getElementById('login-error');
const submitBtn  = document.getElementById('login-submit-btn');

// Bounce back to the intended page if a "next" query param was set by the redirect.
const params = new URLSearchParams(window.location.search);
const next   = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : '/admin.html';

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: passwordEl.value })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            window.location.href = next;
            return;
        }
        errorEl.textContent = data.error || 'Login failed.';
        errorEl.classList.remove('hidden');
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
        errorEl.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log In';
    }
});
