// localStorage that never throws: with site data blocked (or in some private
// windows) every access can fail, and the score sheet must still work, just
// without remembering anything.

export function readStorage(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeStorage(key, value) {
  try { localStorage.setItem(key, value) } catch { /* not remembered */ }
}
