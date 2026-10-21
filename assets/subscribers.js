(function () {
  var API = '/api/subscribers';

  function post(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  // Public signup forms
  document.querySelectorAll('[data-subscribe-form]').forEach(function (form) {
    var status = form.querySelector('[data-status]');
    var button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      button.disabled = true;
      status.textContent = 'Joining…';
      post({
        action: 'subscribe',
        name: (data.get('name') || '').toString(),
        email: (data.get('email') || '').toString(),
        website: (data.get('website') || '').toString(),
        source: form.getAttribute('data-source') || ''
      }).then(function () {
        form.reset();
        status.textContent = 'You are on the list. Welcome — and thank you.';
      }).catch(function (error) {
        status.textContent = error.message;
      }).finally(function () {
        button.disabled = false;
      });
    });
  });

  // Admin page
  var admin = document.querySelector('[data-subscribers="admin"]');
  if (!admin) return;
  var loginForm = admin.querySelector('[data-login-form]');
  var status = admin.querySelector('[data-status]');
  var panel = admin.querySelector('[data-panel]');
  var list = admin.querySelector('[data-list]');
  var moreButton = admin.querySelector('[data-more]');
  var countLine = admin.querySelector('[data-count]');
  var nextCursor = null;
  var shown = 0;

  function renderRow(sub) {
    var card = document.createElement('div');
    card.className = 'subscriber-card';
    var title = document.createElement('h3');
    title.textContent = sub.name ? sub.name + ' — ' + sub.email : sub.email;
    var meta = document.createElement('p');
    var when = sub.created_at ? new Date(sub.created_at).toLocaleString() : '';
    meta.textContent = (sub.source ? 'From: ' + sub.source + ' · ' : '') + when;
    var del = document.createElement('button');
    del.className = 'button alt';
    del.type = 'button';
    del.textContent = 'Remove';
    del.addEventListener('click', function () {
      if (!window.confirm('Remove ' + sub.email + ' from the reader list?')) return;
      del.disabled = true;
      post({ action: 'delete', id: sub.id }).then(function () {
        card.remove();
        shown -= 1;
        countLine.textContent = shown + ' shown';
      }).catch(function (error) {
        status.textContent = error.message;
        del.disabled = false;
      });
    });
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(del);
    return card;
  }

  function load(cursor) {
    var url = API + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    return fetch(url).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Could not load the list.');
        return data;
      });
    }).then(function (data) {
      data.subscribers.forEach(function (sub) {
        list.appendChild(renderRow(sub));
        shown += 1;
      });
      nextCursor = data.next;
      moreButton.hidden = !nextCursor;
      countLine.textContent = shown + ' shown';
    });
  }

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var password = new FormData(loginForm).get('password').toString();
    status.textContent = 'Signing in…';
    post({ action: 'login', password: password }).then(function () {
      loginForm.hidden = true;
      panel.hidden = false;
      status.textContent = '';
      list.textContent = '';
      shown = 0;
      return load(null);
    }).catch(function (error) {
      status.textContent = error.message;
    });
  });

  moreButton.addEventListener('click', function () {
    if (nextCursor) load(nextCursor).catch(function (error) { status.textContent = error.message; });
  });
  admin.querySelector('[data-refresh]').addEventListener('click', function () {
    list.textContent = '';
    shown = 0;
    load(null).catch(function (error) { status.textContent = error.message; });
  });
  admin.querySelector('[data-logout]').addEventListener('click', function () {
    post({ action: 'logout' }).finally(function () {
      panel.hidden = true;
      loginForm.hidden = false;
      loginForm.reset();
      status.textContent = 'Signed out.';
    });
  });

  // If a session cookie is still valid, open the panel straight away.
  load(null).then(function () {
    loginForm.hidden = true;
    panel.hidden = false;
  }).catch(function () { /* not signed in yet */ });
})();
