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



// ── Mobile detection ────────────────────────────────────────────────────────

const isMobile = () =>
  navigator.maxTouchPoints > 0 ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ── Serialization (download only — no IndexedDB) ────────────────────────────
//
// Strategy: Build the JSONL backup as a chain of small Blobs.
//
// Instead of stringifying all 50K events into a parts[] array (~80MB of
// UTF-16 strings), we process 2000 events at a time:
//   1. Stringify 2000 events → small string array (~3MB)
//   2. Create a Blob from those strings (~1.6MB binary)
//   3. Discard the strings (GC reclaims ~3MB)
//   4. Repeat for next chunk
//   5. Combine all chunk-Blobs into one final Blob
//
// Peak string memory: ~3MB (one chunk) instead of ~80MB (all events).
// The Blob constructor accepts other Blobs and concatenates internally.

// Yield to event loop — keeps iOS from killing the tab.
const _yield = () => new Promise((r) => setTimeout(r, 0));

// Trigger a browser download from a Blob.
const triggerDownload = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const tempLink = document.createElement("a");
  tempLink.setAttribute("href", url);
  tempLink.setAttribute("download", fileName);
  tempLink.click();
  // Revoke after a delay to ensure the download starts
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/**
 * serializeAndDownload — Serialize events to JSONL and trigger download.
 * No IndexedDB, no Workers — just the minimum work to create a file.
 *
 * Uses chunked sub-Blob building to keep peak memory low on mobile.
 */
const SERIALIZE_CHUNK = 2000;

async function serializeAndDownload(data, fileName) {
  const isJsonl = fileName.toLowerCase().endsWith('.jsonl');
  let blob;

  if (isJsonl) {
    // Build blob from small chunk-blobs to minimize peak string memory.
    // Each chunk: 2000 events → ~3MB of strings → ~1.6MB Blob → strings freed.
    const chunkBlobs = [];

    for (let i = 0; i < data.length; i += SERIALIZE_CHUNK) {
      const end = Math.min(i + SERIALIZE_CHUNK, data.length);
      const lines = [];
      for (let j = i; j < end; j++) {
        lines.push(JSON.stringify(data[j]) + "\n");
      }
      // Create a sub-Blob from this chunk's strings
      chunkBlobs.push(new Blob(lines, { type: "application/x-ndjson" }));
      // lines[] will be GC'd — only the Blob reference survives
      await _yield();
    }

    // Combine all chunk-Blobs into the final Blob
    // Blob constructor handles this efficiently — no string copies
    blob = new Blob(chunkBlobs, { type: "application/x-ndjson" });
    // Free chunk blob references
    chunkBlobs.length = 0;
  } else {
    blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }

  console.log(`[Serialize] Backup ready: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

  // Trigger browser download
  triggerDownload(blob, fileName);

  // Allow GC to potentially free blob internals
  await _yield();
}

// ── Throttled relay status display (500ms interval) ─────────────────────────
//
// With 300+ relays, rebuilding the HTML string at 60fps via rAF causes
// massive main-thread jank.  Instead, coalesce updates and flush at most
// every 500ms — reduces DOM writes from ~18K/sec to ~2/sec.

let _statusTimerActive = false;
let _pendingRelayStatus = null;

const _flushRelayStatus = () => {
  _statusTimerActive = false;
  if (!_pendingRelayStatus) return;

  const relayStatusAndCount = _pendingRelayStatus;
  const keys = Object.keys(relayStatusAndCount);

  if (keys.length > 0) {
    let completedCount = 0;
    
    // Only show active relays (non-Done) first, then Done at the bottom
    // to keep the scrollable area useful
    let newText = keys
      .map(
        (it) => {
          const status = relayStatusAndCount[it].status;
          if (status === "Done" || status === "Error") {
            completedCount++;
          }
          return it.replace("wss://", "").replace("ws://", "") +
            ": " +
            status +
            " (" +
            relayStatusAndCount[it].count +
            ")";
        }
      )
      .join("<br />");
      
      // Update the header with the progress
    const headerPrefix = $("#checking-relays-header").text().split(' (')[0];
    if (headerPrefix) {
      const totalRelays = (window.relays && window.relays.length > 0) ? window.relays.length : keys.length;
      $("#checking-relays-header").text(`${headerPrefix} (${completedCount}/${totalRelays})`);
    }

    $("#checking-relays").html(newText);
    
    // Auto-scroll to the bottom as new relays are added
    const scrollContainer = document.getElementById("checking-relays");
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  } else {
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

  // Throttle DOM updates to every 500ms (not every frame)
  _pendingRelayStatus = relayStatusAndCount;
  if (!_statusTimerActive) {
    _statusTimerActive = true;
    setTimeout(_flushRelayStatus, 500);
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
      $("#sync-progress").val(processedCount);
      // Immediately start the next relay in the queue
      await next();
    }
  };

  $("#sync-progress").prop('max', pool.length);
  // Initialize the pool
  for (let i = 0; i < Math.min(poolSize, pool.length); i++) {
    workers.push(next());
  }

  await Promise.all(workers);
  displayRelayStatus({});

  // Extract events into an array, then clear the hash map so GC can
  // reclaim its internal storage (~20-50MB for 50K keys) before
  // serialization begins.
  const result = Object.keys(events).map((id) => events[id]);
  for (const key in events) delete events[key];
  return result;
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
            // Reset timeout for each event sent
            clearTimeout(myTimeout);
            myTimeout = setTimeout(() => {
              ws.close();
              reject("timeout");
            }, 10_000);

            // True Network Backpressure:
            // If the WebSocket buffer gets larger than 512KB, pause the loop.
            // This prevents the JS from generating millions of strings in RAM 
            // faster than the mobile connection can upload them, which causes OOM crashes.
            if (ws.bufferedAmount > 512 * 1024) {
              while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 512 * 1024) {
                // Wait 50ms for the network to drain the buffer
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
            }
            
            // Abort if the connection closed while we were waiting
            if (ws.readyState !== WebSocket.OPEN) {
              break;
            }

            ws.send(JSON.stringify(["EVENT", data[i]]));

            // Yield every BROADCAST_BATCH_SIZE events to prevent
            // main thread lockup and keep UI responsive
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
      $("#sync-progress").val(processedCount);
      // Immediately start the next relay in the queue
      await next();
    }
  };

  $("#sync-progress").prop('max', relays.length);
  // Initialize the pool
  for (let i = 0; i < Math.min(poolSize, relays.length); i++) {
    workers.push(next());
  }

  await Promise.all(workers);
  displayRelayStatus(relayStatus);
};
