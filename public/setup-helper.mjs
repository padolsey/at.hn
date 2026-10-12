import { usernameAddress } from './username.mjs';

export function setupHelper(doc, clipboard) {
  const form = doc.getElementById('setup-helper');
  if (!form) return;
  const input = doc.getElementById('setup-username');
  const result = doc.getElementById('setup-result');
  const errorText = doc.getElementById('setup-error');
  const address = doc.getElementById('generated-address');
  const copyStatus = doc.getElementById('copy-status');
  const profile = doc.getElementById('profile-address');

  function update() {
    const { username, encoded, error } = usernameAddress(input.value);
    result.hidden = Boolean(error);
    errorText.hidden = !username || !error;
    errorText.textContent = username && error ? error : '';
    input.setAttribute('aria-invalid', String(Boolean(username && error)));
    copyStatus.textContent = '';
    if (error) {
      address.value = '';
      return;
    }
    address.value = `${encoded}.at.hn`;
    doc.getElementById('edit-profile').href = `https://news.ycombinator.com/user?id=${encodeURIComponent(username)}`;
    doc.getElementById('check-profile').href = `/user?user=${encodeURIComponent(encoded)}&refresh`;
    profile.href = form.dataset.profileMode === 'path'
      ? `/user?user=${encodeURIComponent(encoded)}` : `https://${encoded}.at.hn`;
    profile.textContent = address.value;
  }

  input.addEventListener('input', update);
  form.addEventListener('submit', event => {
    event.preventDefault();
    update();
    if (!result.hidden) {
      address.focus();
      address.select();
    }
  });
  doc.getElementById('copy-address').addEventListener('click', async () => {
    const text = address.value;
    try {
      if (!clipboard) throw new Error('Clipboard unavailable');
      await clipboard.writeText(text);
      copyStatus.textContent = `Copied ${text}`;
    } catch {
      address.focus();
      address.select();
      copyStatus.textContent = 'Text selected. Copy it with your keyboard or touch menu.';
    }
  });
  update();
  doc.getElementById('setup-submit').hidden = true;
}

if (typeof document !== 'undefined') setupHelper(document, navigator.clipboard);
