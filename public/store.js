export async function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('papertrade-observer-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function readStore(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('state').objectStore('state').get('journal');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function saveStore(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    // Single atomic snapshot: logs and reconciled cursor cannot diverge.
    tx.objectStore('state').put(state, 'journal');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}
