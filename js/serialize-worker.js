/**
 * Serialize Worker — runs off the main thread.
 *
 * Responsibilities:
 *   1. Receive an array of Nostr events via postMessage.
 *   2. Serialize to JSONL (chunked, memory-efficient).
 *   3. Store the resulting Blob in IndexedDB.
 *   4. Return a Blob URL to the main thread for download.
 *
 * Messages IN:
 *   { type: 'serialize', events: [...], fileName: 'nostr-backup.jsonl' }
 *
 * Messages OUT:
 *   { type: 'done',     blobUrl: '...', size: 12345 }
 *   { type: 'progress', phase: 'serializing' | 'storing', pct: 0-100 }
 *   { type: 'error',    error: '...' }
 */

// ── IndexedDB helpers (Worker has full IDB access) ──────────────────────────

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("NostrDB", 2);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("Backups")) {
        db.createObjectStore("Backups", { keyPath: "name" });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function storeFile(db, fileObject) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("Backups", "readwrite");
    const store = tx.objectStore("Backups");
    const request = store.put(fileObject);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

// ── Chunked serialization ───────────────────────────────────────────────────

/**
 * Build a Blob from the events array using chunked string parts.
 * Instead of building one giant string, we push each serialized line
 * into a parts array and let the Blob constructor concatenate internally.
 *
 * For very large arrays (>10K events), we yield progress updates.
 */
function createBackupBlob(events, fileName) {
  const isJsonl = fileName.toLowerCase().endsWith(".jsonl");

  if (isJsonl) {
    const CHUNK_REPORT = 2000; // report progress every N events
    const parts = [];
    for (let i = 0; i < events.length; i++) {
      parts.push(JSON.stringify(events[i]) + "\n");

      if (i > 0 && i % CHUNK_REPORT === 0) {
        self.postMessage({
          type: "progress",
          phase: "serializing",
          pct: Math.round((i / events.length) * 100),
        });
      }
    }
    return new Blob(parts, { type: "application/x-ndjson" });
  }

  // JSON format — single stringify (no chunking possible for valid JSON)
  return new Blob([JSON.stringify(events, null, 2)], {
    type: "application/json",
  });
}

// ── Main message handler ────────────────────────────────────────────────────

self.onmessage = async (msg) => {
  const { type, events, fileName } = msg.data;

  if (type !== "serialize") return;

  try {
    // Phase 1: Serialize
    self.postMessage({ type: "progress", phase: "serializing", pct: 0 });
    const blob = createBackupBlob(events, fileName);
    self.postMessage({ type: "progress", phase: "serializing", pct: 100 });

    // Create a URL for download (Worker has URL.createObjectURL)
    const blobUrl = URL.createObjectURL(blob);

    // Phase 2: Store in IndexedDB (non-fatal)
    try {
      self.postMessage({ type: "progress", phase: "storing", pct: 0 });
      const timestamp = Date.now();
      const uniqueFileName = timestamp + "_" + fileName;
      const fileObject = {
        name: uniqueFileName,
        content: blob,
        size: blob.size,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
      };

      const db = await openDatabase();
      await storeFile(db, fileObject);
      db.close();
      self.postMessage({ type: "progress", phase: "storing", pct: 100 });
      console.log("[Worker] Backup stored in IndexedDB:", uniqueFileName);
    } catch (storageErr) {
      console.warn("[Worker] IndexedDB storage failed (download still works):", storageErr);
    }

    // Return the blob URL and size to main thread
    self.postMessage({
      type: "done",
      blobUrl: blobUrl,
      size: blob.size,
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err.message || String(err),
    });
  }
};
