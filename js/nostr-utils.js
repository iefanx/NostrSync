// from https://github.com/paulmillr/noble-secp256k1/blob/main/index.ts#L803
function hexToBytes(hex) {
  if (typeof hex !== "string") {
    throw new TypeError("hexToBytes: expected string, got " + typeof hex);
  }
  if (hex.length % 2)
    throw new Error("hexToBytes: received invalid unpadded hex" + hex.length);
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    const hexByte = hex.slice(j, j + 2);
    const byte = Number.parseInt(hexByte, 16);
    if (Number.isNaN(byte) || byte < 0)
      throw new Error("Invalid byte sequence");
    array[i] = byte;
  }
  return array;
}

// decode nip19 ('npub') to hex
const npub2hexa = (npub) => {
  let { prefix, words } = bech32.bech32.decode(npub, 90);
  if (prefix === "npub") {
    let data = new Uint8Array(bech32.bech32.fromWords(words));
    return buffer.Buffer.from(data).toString("hex");
  }
};

// encode hex to nip19 ('npub')
const hexa2npub = (hex) => {
  const data = hexToBytes(hex);
  const words = bech32.bech32.toWords(data);
  const prefix = "npub";
  return bech32.bech32.encode(prefix, words, 90);
};

// parse inserted pubkey
const parsePubkey = (pubkey) =>
  pubkey.match("npub1") ? npub2hexa(pubkey) : pubkey;

// ── IndexedDB helpers ───────────────────────────────────────────────────────

// Function to open the IndexedDB database
async function openDatabase() {
  const dbPromise = idb.openDB("NostrDB", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("Backups")) {
        db.createObjectStore("Backups", { keyPath: "name" });
      }
    },
  });

  return dbPromise;
}

// Function to store a file in IndexedDB
async function storeFile(db, fileObject) {
  const tx = db.transaction("Backups", "readwrite");
  const store = tx.objectStore("Backups");
  await store.put(fileObject);
  await tx.done;
}

// Function to generate a unique file name
function generateUniqueFileName(originalFileName) {
  const date = new Date();
  const timestamp = date.getTime();
  const uniqueFileName = timestamp + "_" + originalFileName;
  return uniqueFileName;
}

// ── Mobile detection ────────────────────────────────────────────────────────

const isMobile = () =>
  navigator.maxTouchPoints > 0 ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ── Serialization + Storage (Worker-based with main-thread fallback) ────────

// Main-thread fallback: creates Blob directly using array-of-strings.
const createBackupBlob = (data, fileName) => {
  if (fileName.toLowerCase().endsWith('.jsonl')) {
    const parts = [];
    for (const event of data) {
      parts.push(JSON.stringify(event) + "\n");
    }
    return new Blob(parts, { type: "application/x-ndjson" });
  }

  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

// Trigger a browser download from a Blob URL or Blob.
const triggerDownload = (blobOrUrl, fileName) => {
  const url = typeof blobOrUrl === 'string'
    ? blobOrUrl
    : URL.createObjectURL(blobOrUrl);
  const tempLink = document.createElement("a");
  tempLink.setAttribute("href", url);
  tempLink.setAttribute("download", fileName);
  tempLink.click();
  // Revoke after a short delay to ensure the download starts
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/**
 * serializeAndStore — Uses a Web Worker to serialize events and store in
 * IndexedDB off the main thread.  Falls back to main-thread if Workers
 * are unavailable (e.g. older browsers or file:// origin).
 *
 * Returns a Promise that resolves when the download is triggered.
 */
async function serializeAndStore(data, fileName) {
  // Try Worker-based path first
  if (typeof Worker !== 'undefined') {
    try {
      return await _workerSerialize(data, fileName);
    } catch (err) {
      console.warn("Worker serialization failed, falling back to main thread:", err);
    }
  }

  // Main-thread fallback
  return _mainThreadSerialize(data, fileName);
}

function _workerSerialize(data, fileName) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker("/js/serialize-worker.js");
    } catch (e) {
      reject(e);
      return;
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Worker timed out after 60s"));
    }, 60_000);

    worker.onmessage = (msg) => {
      const { type, blobUrl, size, error } = msg.data;

      if (type === "progress") {
        // Could update a secondary progress indicator here
        return;
      }

      if (type === "done") {
        clearTimeout(timeout);
        console.log(`[Worker] Serialization complete: ${(size / 1024 / 1024).toFixed(2)} MB`);
        triggerDownload(blobUrl, fileName);
        worker.terminate();
        resolve();
      }

      if (type === "error") {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(err);
    };

    // Send events to worker — structured clone transfers the array
    worker.postMessage({ type: "serialize", events: data, fileName });
  });
}

async function _mainThreadSerialize(data, fileName) {
  const blob = createBackupBlob(data, fileName);
  triggerDownload(blob, fileName);

  // Try to persist in IndexedDB (non-fatal on failure)
  try {
    const uniqueFileName = generateUniqueFileName(fileName);
    const fileObject = {
      name: uniqueFileName,
      content: blob,
      size: blob.size,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
    };

    const db = await openDatabase();
    await storeFile(db, fileObject);
    console.log("Backup stored in IndexedDB:", uniqueFileName);
  } catch (error) {
    console.warn("IndexedDB storage failed (download still succeeded):", error);
  }
}

// ── Throttled relay status display ──────────────────────────────────────────

let _statusRafPending = false;
let _pendingRelayStatus = null;

const _flushRelayStatus = () => {
  _statusRafPending = false;
  if (!_pendingRelayStatus) return;

  const relayStatusAndCount = _pendingRelayStatus;
  const keys = Object.keys(relayStatusAndCount);

  if (keys.length > 0) {
    let newText = keys
      .map(
        (it) =>
          it.replace("wss://", "").replace("ws://", "") +
          ": " +
          relayStatusAndCount[it].status +
          " (" +
          relayStatusAndCount[it].count +
          ")"
      )
      .join("<br />");
    $("#checking-relays").html(newText);
  } else {
    $("#checking-relays-header").html("");
    $("#checking-relays").html("");
  }
};

const updateRelayStatus = (relay, status, addToCount, relayStatusAndCount) => {
  if (relayStatusAndCount[relay] == undefined) {
    relayStatusAndCount[relay] = {};
  }

  if (status) relayStatusAndCount[relay].status = status;

  if (relayStatusAndCount[relay].count != undefined)
    relayStatusAndCount[relay].count =
      relayStatusAndCount[relay].count + addToCount;
  else relayStatusAndCount[relay].count = addToCount;

  // Throttle DOM updates via requestAnimationFrame (coalesce rapid updates)
  _pendingRelayStatus = relayStatusAndCount;
  if (!_statusRafPending) {
    _statusRafPending = true;
    requestAnimationFrame(_flushRelayStatus);
  }
};

const displayRelayStatus = (relayStatusAndCount) => {
  // Immediate flush for explicit calls (e.g. clearing status)
  _pendingRelayStatus = relayStatusAndCount;
  _flushRelayStatus();
};

// ── Throttled event counter ─────────────────────────────────────────────────

let _eventCountRafPending = false;
let _pendingEventCount = 0;

const _flushEventCount = () => {
  _eventCountRafPending = false;
  $("#events-found").text(`${_pendingEventCount} events found`);
};

const updateEventCount = (count) => {
  _pendingEventCount = count;
  if (!_eventCountRafPending) {
    _eventCountRafPending = true;
    requestAnimationFrame(_flushEventCount);
  }
};

// ── Fetch events from a single relay ────────────────────────────────────────

const fetchFromRelay = async (relay, filters, pubkey, events, eventCount, relayStatus) =>
  new Promise((resolve, reject) => {
    try {
      updateRelayStatus(relay, "Starting", 0, relayStatus);
      // open websocket
      const ws = new WebSocket(relay);

      // prevent hanging forever
      let myTimeout = setTimeout(() => {
        ws.close();
        reject("timeout");
      }, 10_000);

      // subscription id
      const subsId = "my-sub";
      // subscribe to events filtered by author
      ws.onopen = () => {
        clearTimeout(myTimeout);
        myTimeout = setTimeout(() => {
          ws.close();
          reject("timeout");
        }, 10_000);
        updateRelayStatus(relay, "Downloading", 0, relayStatus);
        ws.send(JSON.stringify(["REQ", subsId].concat(filters)));
      };

      // Listen for messages
      ws.onmessage = (event) => {
        const [msgType, subscriptionId, data] = JSON.parse(event.data);
        // event messages
        if (msgType === "EVENT" && subscriptionId === subsId) {
          clearTimeout(myTimeout);
          myTimeout = setTimeout(() => {
            ws.close();
            reject("timeout");
          }, 10_000);

          const { id } = data;

          // don't save/rebroadcast kind 3s that are not from the author.
          // they are too big.
          if (data.kind == 3 && data.pubkey != pubkey) {
            return;
          }

          updateRelayStatus(relay, undefined, 1, relayStatus);

          // prevent duplicated events
          if (events[id]) return;
          else events[id] = data;

          // Increment counter and update UI (throttled — no O(n²))
          eventCount.value++;
          updateEventCount(eventCount.value);
        }
        // end of subscription messages
        if (msgType === "EOSE" && subscriptionId === subsId) {
          updateRelayStatus(relay, "Done", 0, relayStatus);
          ws.close();
          resolve();
        }
      };
      ws.onerror = (err) => {
        updateRelayStatus(relay, "Done", 0, relayStatus);
        ws.close();
        reject(err);
      };
      ws.onclose = (socket, event) => {
        updateRelayStatus(relay, "Done", 0, relayStatus);
        resolve();
      };
    } catch (exception) {
      console.log(exception);
      updateRelayStatus(relay, "Error", 0, relayStatus);
      try {
        ws.close();
      } catch (exception) {}

      reject(exception);
    }
  });

// ── Query relays for events (sliding window pool) ───────────────────────────

const getEvents = async (filters, pubkey, customPool) => {
  const events = {};
  const eventCount = { value: 0 }; // Mutable counter shared across all relay workers
  const pool = customPool || relays;
  const relayStatus = {};
  const poolSize = 30; // Maintain 30 active fetch connections
  let processedCount = 0;

  console.log(`Starting dynamic fetch pool for ${pool.length} relays...`);
  
  const queue = [...pool];
  const workers = [];

  const next = async () => {
    if (queue.length === 0) return;
    const relay = queue.shift();
    try {
      await fetchFromRelay(relay, filters, pubkey, events, eventCount, relayStatus);
    } catch (e) {
      console.warn(`Fetch failed for ${relay}`, e);
    } finally {
      processedCount++;
      $("#fetching-progress").val(processedCount);
      // Immediately start the next relay in the queue
      await next();
    }
  };

  $("#fetching-progress").prop('max', pool.length);
  // Initialize the pool
  for (let i = 0; i < Math.min(poolSize, pool.length); i++) {
    workers.push(next());
  }

  await Promise.all(workers);
  displayRelayStatus({});

  // return data as an array of events
  return Object.keys(events).map((id) => events[id]);
};

// ── Send events to a relay (chunked with backpressure) ──────────────────────

const BROADCAST_BATCH_SIZE = 50; // Send 50 events, then yield to event loop

// Yield control to the event loop to prevent UI freezes and WS buffer overflow
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

const sendToRelay = async (relay, data, relayStatus) =>
  new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(relay);

      updateRelayStatus(relay, "Starting", 0, relayStatus);

      // prevent hanging forever
      let myTimeout = setTimeout(() => {
        ws.close();
        reject("timeout");
      }, 10_000);

      // send events in chunked batches
      ws.onopen = async () => {
        updateRelayStatus(relay, "Sending", 0, relayStatus);

        try {
          for (let i = 0; i < data.length; i++) {
            clearTimeout(myTimeout);
            myTimeout = setTimeout(() => {
              ws.close();
              reject("timeout");
            }, 10_000);

            ws.send(JSON.stringify(["EVENT", data[i]]));

            // Yield every BROADCAST_BATCH_SIZE events to prevent
            // WebSocket buffer overflow and keep UI responsive
            if ((i + 1) % BROADCAST_BATCH_SIZE === 0) {
              await yieldToEventLoop();
            }
          }
        } catch (sendErr) {
          console.warn(`Send error on ${relay}:`, sendErr);
        }
      };
      // Listen for messages
      ws.onmessage = (event) => {
        clearTimeout(myTimeout);
        myTimeout = setTimeout(() => {
          ws.close();
          reject("timeout");
        }, 10_000);

        const [msgType, subscriptionId, inserted] = JSON.parse(event.data);
        // event messages
        // end of subscription messages
        if (msgType === "OK") {
          if (inserted == true) {
            updateRelayStatus(relay, undefined, 1, relayStatus);
          } else {
            console.log(event.data);
          }
        }
      };
      ws.onerror = (err) => {
        updateRelayStatus(relay, "Error", 0, relayStatus);
        console.log("Error", err);
        ws.close();
        reject(err);
      };
      ws.onclose = (socket, event) => {
        updateRelayStatus(relay, "Done", 0, relayStatus);
        resolve();
      };
    } catch (exception) {
      console.log(exception);
      updateRelayStatus(relay, "Error", 0, relayStatus);
      try {
        ws.close();
      } catch (exception) {}
      reject(exception);
    }
  });

// ── Broadcast events to list of relays (adaptive pool) ──────────────────────

const broadcastEvents = async (data) => {
  // Adaptive pool size: fewer concurrent connections on mobile
  const poolSize = isMobile() ? 10 : 15;
  const relayStatus = {};
  let processedCount = 0;

  console.log(`Starting dynamic broadcast pool (${poolSize} workers) for ${relays.length} relays...`);

  const queue = [...relays];
  const workers = [];

  const next = async () => {
    if (queue.length === 0) return;
    const relay = queue.shift();
    try {
      await sendToRelay(relay, data, relayStatus);
    } catch (e) {
      console.warn(`Broadcast failed for ${relay}`, e);
    } finally {
      processedCount++;
      $("#broadcasting-progress").val(processedCount);
      // Immediately start the next relay in the queue
      await next();
    }
  };

  $("#broadcasting-progress").prop('max', relays.length);
  // Initialize the pool
  for (let i = 0; i < Math.min(poolSize, relays.length); i++) {
    workers.push(next());
  }

  await Promise.all(workers);
  displayRelayStatus(relayStatus);
};
