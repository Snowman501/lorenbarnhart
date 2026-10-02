(() => {
  const root = document.querySelector('[data-guestbook]');
  if (!root) return;
  const admin = root.dataset.guestbook === 'admin';
  const status = root.querySelector('[data-status]');
  const list = root.querySelector('[data-list]');
  const more = root.querySelector('[data-more]');
  const form = root.querySelector('form');
  const panel = root.querySelector('[data-panel]');
  let cursor = null, scope = admin ? 'pending' : 'public', busy = false;
  const tell = message => { status.textContent = message; };
  async function api(body, query = '') {
    const response = await fetch('/api/guestbook' + query, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    } : { cache: 'no-store' });
    let data;
    try { data = await response.json(); } catch { throw new Error('Guestbook is unavailable. Please try again later.'); }
    if (!response.ok) {
      if (admin && response.status === 401) { form.hidden = false; panel.hidden = true; list.replaceChildren(); more.hidden = true; }
      throw new Error(data.error || 'Please try again later.');
    }
    return data;
  }
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  function card(comment) {
    const article = element('article', ''); article.className = 'guestbook-card';
    article.append(element('h3', comment.name));
    const date = new Date(comment.created_at);
    const time = element('time', date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
    time.dateTime = date.toISOString(); article.append(time, element('p', comment.message));
    if (admin) {
      const actions = element('div', ''); actions.className = 'actions';
      for (const [action, label] of [[comment.approved ? 'hide' : 'approve', comment.approved ? 'Unpublish' : 'Approve'], ['delete', 'Delete']]) {
        const button = element('button', label); button.type = 'button'; button.className = 'button alt';
        button.addEventListener('click', () => perform(async () => {
          if (action === 'delete' && !confirm('Permanently delete this message?')) return;
          await api({ action, id: comment.id }); await load(); tell(action === 'approve' ? 'Message published.' : action === 'hide' ? 'Message returned to pending.' : 'Message deleted.');
        }));
        actions.append(button);
      }
      article.append(actions);
    }
    return article;
  }
  async function load(append = false) {
    const query = '?scope=' + scope + (append && cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const data = await api(null, query);
    if (!append) list.replaceChildren();
    if (admin) { form.hidden = true; panel.hidden = false; }
    if (!data.comments.length && !append) list.append(element('p', admin ? 'No messages in this view.' : 'No published messages yet. You’re welcome to leave the first.'));
    for (const comment of data.comments) list.append(card(comment));
    cursor = data.next; more.hidden = !cursor;
  }
  async function perform(work) {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy', 'true');
    const disable = value => root.querySelectorAll('button').forEach(button => { button.disabled = value; });
    disable(true);
    try { await work(); } catch (error) { tell(error.message || 'Please check your connection and try again.'); }
    finally { busy = false; root.removeAttribute('aria-busy'); disable(false); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const values = new FormData(form);
      if (admin) {
        const password = values.get('password'); form.elements.password.value = '';
        await api({ action: 'login', password }); await load(); tell('Signed in. Messages wait here until you approve them.');
      } else {
        tell('Sending your message…');
        await api({ name: values.get('name'), message: values.get('message'), website: values.get('website'), consent: values.get('consent') === 'on' });
        form.reset(); tell('Thank you. Your message was received and will appear after Loren reviews it.');
      }
    });
  });
  more.addEventListener('click', () => perform(() => load(true)));
  if (admin) {
    root.querySelector('[data-view]').addEventListener('change', event => {
      scope = event.target.value; perform(async () => { await load(); tell(scope === 'pending' ? 'Pending messages.' : 'Published messages.'); });
    });
    root.querySelector('[data-refresh]').addEventListener('click', () => perform(async () => { await load(); tell('Messages refreshed.'); }));
    root.querySelector('[data-logout]').addEventListener('click', () => perform(async () => {
      await api({ action: 'logout' }); form.hidden = false; panel.hidden = true; list.replaceChildren(); more.hidden = true; tell('Signed out.');
    }));
  }
  perform(async () => { await load(); tell(''); });
})();
