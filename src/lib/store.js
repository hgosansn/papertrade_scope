export async function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("papertrade-observer-v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function readStore(db, key = "journal") {
  return new Promise((resolve, reject) => {
    const req = db.transaction("state").objectStore("state").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function readArchives(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction("state").objectStore("state").getAllKeys();
    req.onsuccess = () =>
      resolve(
        req.result.filter((key) => String(key).startsWith("archive:")).sort(),
      );
    req.onerror = () => reject(req.error);
  });
}

// Both writes commit together; quota/storage failure retains the active journal.
export function archiveAndSaveStore(db, previous, next) {
  return new Promise((resolve, reject) => {
    const key = `archive:${Date.now()}:${previous.start}`;
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    store.put(previous, key);
    store.put(next, "journal");
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Archive transaction aborted"));
  });
}
export function saveStore(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    // Single atomic snapshot: logs and reconciled cursor cannot diverge.
    tx.objectStore("state").put(state, "journal");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction aborted"));
  });
}
