/**
 * localStorage with an in-memory fallback.
 *
 * Private-mode browsers, sandboxed iframes and pages opened straight off disk
 * can all throw on `localStorage` access. The app should degrade to a
 * session-only memory store rather than fail to boot.
 */
const memory = new Map();

let usable = false;
try {
  const probe = '__tracker_probe__';
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
  usable = true;
} catch {
  usable = false;
}

export const storage = {
  get(key) {
    if (!usable) return memory.has(key) ? memory.get(key) : null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    if (!usable) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore — the memory copy is enough for this session */
    }
  },
  remove(key) {
    memory.delete(key);
    if (!usable) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
