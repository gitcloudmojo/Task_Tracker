import { storage } from './storage.js';

const TOKEN_KEY = 'cloudmojo.tracker.token';

export const getToken = () => storage.get(TOKEN_KEY);
export const setToken = (t) => storage.set(TOKEN_KEY, t);
export const clearToken = () => storage.remove(TOKEN_KEY);

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    // A 401 on the sign-in call itself means the credentials were wrong, so
    // report what the server actually said rather than claiming the session
    // expired — that message is nonsense when you have not signed in yet.
    const text401 = await res.text();
    let payload = {};
    try {
      payload = text401 ? JSON.parse(text401) : {};
    } catch {
      payload = {};
    }
    if (path === '/auth/login') {
      throw new Error(payload.error || 'Email or password is incorrect');
    }
    clearToken();
    onUnauthorized();
    throw new Error(payload.error || 'Your session has expired. Please sign in again.');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),

  /**
   * File upload. Deliberately not using `request` — a multipart body must not
   * carry a JSON content-type, and the browser has to set the boundary itself.
   */
  async upload(path, files) {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: form,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  },

  /**
   * Downloads go through fetch rather than a plain link, because the file is
   * behind the same auth as everything else and a bare href carries no token.
   */
  async download(path, filename) {
    const res = await fetch(`/api${path}`, {
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = `Could not fetch that file (${res.status})`;
      try {
        msg = JSON.parse(text).error || msg;
      } catch {
        /* keep the generic message */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  }
  const out = s.toString();
  return out ? `?${out}` : '';
};
