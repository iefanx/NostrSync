let isCustomMode = false;

function toggleSettings() {
  const box = $('#settings-box');
  const label = $('#label-settings');
  
  // Close custom relays box if open
  if ($('#custom-relays-box').css('display') !== 'none') {
    $('#custom-relays-box').slideUp();
    $('#label-custom-relays').css({
      'background': '',
      'color': ''
    });
  }
  
  if (box.css('display') === 'none') {
    box.slideDown();
    label.css({
      'background': 'linear-gradient(90deg, #7f7dd1, #548dd9)',
      'color': '#fff'
    });
  } else {
    box.slideUp();
    label.css({
      'background': '',
      'color': ''
    });
  }
}

function toggleCustomRelays() {
  const box = $('#custom-relays-box');
  const label = $('#label-custom-relays');
  
  // Close settings box if open
  if ($('#settings-box').css('display') !== 'none') {
    $('#settings-box').slideUp();
    $('#label-settings').css({
      'background': '',
      'color': ''
    });
  }
  
  if (box.css('display') === 'none') {
    box.slideDown();
    label.css({
      'background': 'linear-gradient(90deg, #7f7dd1, #548dd9)',
      'color': '#fff'
    });
  } else {
    box.slideUp();
    label.css({
      'background': '',
      'color': ''
    });
  }
}

function initSettings() {
  const concurrency = localStorage.getItem('nostrsync_concurrency') || '10';
  const delay = localStorage.getItem('nostrsync_broadcast_delay') || '20';
  
  $('#concurrency-input').val(concurrency);
  $('#concurrency-val').text(concurrency);
  
  $('#delay-input').val(delay);
  $('#delay-val').text(delay);
}

function saveSettings() {
  const concurrency = $('#concurrency-input').val();
  const delay = $('#delay-input').val();
  
  localStorage.setItem('nostrsync_concurrency', concurrency);
  localStorage.setItem('nostrsync_broadcast_delay', delay);
}

function toggleBroadcastOnly() {
  const fileInput = document.getElementById('file-selector');
  const label = $('#label-broadcast-only');

  // Trigger file selection
  fileInput.click();
}

async function syncCustomRelays() {
  const input = $('#custom-relays-input').val().trim();
  if (!input) {
    alert("Please enter at least one relay URL.");
    return;
  }

  const customList = input.split(',')
    .map(r => r.trim())
    .filter(r => r.startsWith('ws://') || r.startsWith('wss://'));

  if (customList.length === 0) {
    alert("Invalid relay URLs. Please use ws:// or wss://");
    return;
  }

  // Set global relays to ONLY the custom ones
  relays = customList;
  isCustomMode = true;
  console.log("Custom Sync Mode Started with relays:", relays);
  
  // Highlight the Custom Relays button
  $('#label-custom-relays').css({
    'background': 'linear-gradient(90deg, #7f7dd1, #548dd9)',
    'color': '#fff',
    'border': 'none'
  });

  // Hide the box and trigger sync
  $('#custom-relays-box').slideUp();
  await fetchAndBroadcast();
}

const updateButtonText = () => {
  const pubkeyInput = $('#pubkey').val().trim();
  const btn = $('#fetch-and-broadcast');
  
  if (pubkeyInput === "") {
    btn.text("Login with Extension");
  } else {
    btn.text("Backup & Broadcast");
  }

  // If a file is selected, ensure we stay in broadcast mode
  if (window.fileName) {
    $('#fetch-and-broadcast').hide();
    $('#just-broadcast').show();
  }
}

const pubkeyOnChange = () => {
  updateButtonText();
}

const parseBackupFileContent = (content, fileName = "") => {
  const trimmedContent = content.trim();
  const normalizedFileName = fileName.toLowerCase();

  if (!trimmedContent) {
    throw new Error("Backup file is empty.");
  }

  if (normalizedFileName.endsWith(".jsonl")) {
    return trimmedContent
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  }

  if (trimmedContent.startsWith("const data =")) {
    return JSON.parse(trimmedContent.slice("const data =".length).trim());
  }

  return JSON.parse(trimmedContent);
}

const getRelayUrlsFromKind10002 = (data) => {
  const relayUrls = data
    .filter((event) => event.kind === 10002 && Array.isArray(event.tags))
    .flatMap((event) =>
      event.tags
        .filter((tag) => tag[0] === 'r' && tag[1])
        .filter((tag) => tag.length < 3 || tag[2] === 'write')
        .map((tag) => tag[1])
    );

  return Array.from(new Set(relayUrls));
}

const getRelayUrlsFromKind3 = (data) => {
  const kind3Event = data.find((event) => event.kind === 3 && event.content);

  if (!kind3Event) {
    return [];
  }

  try {
    const relayMap = JSON.parse(kind3Event.content);

    return Object.keys(relayMap).filter((url) => {
      const relayConfig = relayMap[url];

      if (relayConfig == null || typeof relayConfig !== 'object') {
        return true;
      }

      return relayConfig.write !== false;
    });
  } catch (error) {
    console.error("Error parsing JSON from file kind-3:", error);
    return [];
  }
}

const resolveRestoreRelayPool = async (data) => {
  const fileRelays = Array.from(new Set([
    ...getRelayUrlsFromKind10002(data),
    ...getRelayUrlsFromKind3(data),
  ]));

  const existingRelays = [...relays];

  if (existingRelays.length === 0) {
    await updateRelays();
  }

  return Array.from(new Set([...fileRelays, ...relays]));
}

// ── UI helpers for the sync panel ───────────────────────────────────────────

const setPhase = (id, state) => {
  // state: 'idle' | 'active' | 'done'
  const el = $(`#${id}`);
  el.removeClass('active done');
  if (state === 'active') el.addClass('active');
  if (state === 'done')   el.addClass('done');
};

const setProgress = (value, max) => {
  const bar = $('#sync-progress');
  bar.prop('max', Math.max(1, max));
  bar.val(Math.min(value, max));
};

const showSyncPanel = () => {
  // Reset everything
  $('#sync-panel').show();
  $('#fetching-status').text('');
  $('#file-download').text('');
  $('#broadcasting-status').text('');
  $('#events-found').text('');
  $('#checking-relays').html('');
  $('#checking-relays-header').text('');
  setProgress(0, 1);
  setPhase('phase-fetch', 'idle');
  setPhase('phase-download', 'idle');
  setPhase('phase-broadcast', 'idle');
  $('#relay-section').hide();
};

// ── Relay discovery (extracted for parallel execution) ───────────────────────

/**
 * Discover and probe the user's personal relays from NIP-65 / NIP-02 events.
 * Returns the final merged relay pool for broadcast.
 */
const discoverAndProbeRelays = async (data, pubkey, personalRelays) => {
  let discoveredRelays = [...personalRelays];
  
  // Check for NIP-65 (kind: 10002)
  const nip65Event = data.find(it => it.kind === 10002 && it.pubkey === pubkey);
  if (nip65Event) {
    console.log("NIP-65 Event Found. Extracting relays...");
    const nip65Urls = nip65Event.tags.filter(t => t[0] === 'r').map(t => t[1]);
    discoveredRelays = Array.from(new Set([...discoveredRelays, ...nip65Urls]));
  } 
  
  // If no NIP-65 found in events, check for NIP-02 (kind: 3)
  if (discoveredRelays.length === personalRelays.length) {
    const latestKind3 = data.filter((it) => it.kind == 3 && it.pubkey === pubkey)[0]
    if (latestKind3 && latestKind3.content) {
      try {
        const myRelaySet = JSON.parse(latestKind3.content);
        const kind3Urls = Object.keys(myRelaySet);
        discoveredRelays = Array.from(new Set([...discoveredRelays, ...kind3Urls]));
        console.log("NIP-02 (Kind 3) Relays Found.");
      } catch (error) {
        console.error("Error parsing JSON from kind-3 event:", error);
      }
    }
  }

  // Verify and merge discovered relays into the pool
  if (discoveredRelays.length > 0) {
    console.log("Probing discovered personal relays...");
    const activePersonalRelays = [];
    const queue = [...discoveredRelays];
    const probeWorkers = [];
    const maxProbeConcurrency = Math.min(5, parseInt(localStorage.getItem('nostrsync_concurrency') || '10'));
    
    const nextProbe = async () => {
      if (queue.length === 0) return;
      const url = queue.shift();
      try {
        const isAlive = await probeRelay(url);
        if (isAlive) activePersonalRelays.push(url);
      } catch (e) {
        console.warn(`Probe failed for ${url}`, e);
      }
      await nextProbe();
    };
    
    for (let i = 0; i < Math.min(maxProbeConcurrency, queue.length); i++) {
      probeWorkers.push(nextProbe());
    }
    await Promise.all(probeWorkers);

    console.log("User Relays Discovered:", activePersonalRelays);
    
    // Final merge with full trusted pool
    relays = Array.from(new Set([...activePersonalRelays, ...relays]));
  }

  console.log(`Final Relay Pool Size for Broadcast: ${relays.length}`);
};

// ── Main button click handler ───────────────────────────────────────────────

const fetchAndBroadcast = async () => {
  let pubkey = parsePubkey($('#pubkey').val().trim())
  
  // If no pubkey, act as a login button
  if (!pubkey) {
    if (typeof window.nostr !== 'undefined') {
      try {
        pubkey = await window.nostr.getPublicKey();
        if (pubkey) {
          $('#pubkey').val(pubkey);
          updateButtonText();
          return;
        }
      } catch (e) {
        console.error("User denied login or extension error:", e);
        return;
      }
    } else {
      alert("Nostr extension not found. Please install nos2x, Alby, or similar.");
      return;
    }
  }

  // Phase 0: Load relays if not in custom mode
  if (!isCustomMode) {
    $('#sync-panel').show();
    $('#fetching-status').text("Updating relay list...");
    setPhase('phase-fetch', 'active');
    await updateRelays();
  }

  // Show panel and reset
  showSyncPanel();
  const checkMark = ' ✓';
  
  // disable buttons
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)

  try {
    // Phase 1: Pre-discovery via Extension
    let personalRelays = [];
    if (typeof window.nostr !== 'undefined' && window.nostr.getRelays) {
      try {
        const extRelays = await window.nostr.getRelays();
        personalRelays = Object.keys(extRelays);
        console.log("Relays discovered from extension:", personalRelays);
      } catch (e) {
        console.warn("Could not get relays from extension", e);
      }
    }

    // ── PHASE: FETCH ────────────────────────────────────────────────────────
    const bootstrapPool = Array.from(new Set([...personalRelays, ...relays]));
    const filters = [{ authors: [pubkey] }, { "#p": [pubkey] }] 

    setPhase('phase-fetch', 'active');
    $('#fetching-status').text('Fetching from relays...');
    setProgress(0, bootstrapPool.length);

    // Show relay activity
    $('#relay-section').show();
    $('#checking-relays-header').text('Relay Activity');
    
    console.log(`Fetching events using ${bootstrapPool.length} bootstrap relays...`);
    const data = (await getEvents(filters, pubkey, bootstrapPool)).sort((a, b) => b.created_at - a.created_at)

    // Fetch done
    setPhase('phase-fetch', 'done');
    $('#fetching-status').text('Fetching from relays' + checkMark);
    setProgress(bootstrapPool.length, bootstrapPool.length);

    // ── PHASE: DOWNLOAD (parallel with relay discovery) ─────────────────────
    setPhase('phase-download', 'active');
    $('#file-download').text('Saving backup...');

    const serializePromise = serializeAndDownload(data, 'nostr-backup.jsonl');
    const discoveryPromise = discoverAndProbeRelays(data, pubkey, personalRelays);

    await Promise.all([serializePromise, discoveryPromise]);

    setPhase('phase-download', 'done');
    $('#file-download').text('Backup saved' + checkMark);

    // ── PHASE: BROADCAST ────────────────────────────────────────────────────
    setPhase('phase-broadcast', 'active');
    $('#broadcasting-status').text('Broadcasting to relays...');
    setProgress(0, relays.length);

    $('#checking-relays-header').text('Broadcasting to Relays');
    $('#checking-relays').html('');

    const broadcastData = data;
    await broadcastEvents(broadcastData)

    setPhase('phase-broadcast', 'done');
    $('#broadcasting-status').text('Broadcasting complete' + checkMark);
    setProgress(relays.length, relays.length);

  } catch (err) {
    console.error("Process failed:", err);
    alert("An error occurred during the sync process. Check console for details.");
  } finally {
    $('#fetch-and-broadcast').prop('disabled', false)
    $('#just-broadcast').prop('disabled', false)
  }
}

// Initial state
$(document).ready(() => {
  updateButtonText();
  initSettings();
});




// button click handler
const justBroadcast = async (fileName) => {
  if (!fileName) {
    alert("Choose a backup file first.");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    try {
      const data = parseBackupFileContent(event.target.result, fileName.name || "");
      broadcast(data);
    } catch (error) {
      console.error("Error parsing backup file:", error);
      alert("Invalid backup file. Upload a NostrSync backup JSON file and try again.");
    }
  });
  reader.readAsText(fileName)
}

const broadcast = async (data) => {
  console.log(data)
  
  showSyncPanel();
  const checkMark = ' ✓';
  
  // disable buttons
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)

  // Mark file load as done immediately
  setPhase('phase-fetch', 'done');
  $('#fetching-status').text('Loaded from file' + checkMark);
  setProgress(1, 1);

  relays = await resolveRestoreRelayPool(data)

  if (relays.length === 0) {
    $('#broadcasting-status').text('No relays available for broadcast.')
    setPhase('phase-broadcast', 'active');
    $('#fetch-and-broadcast').prop('disabled', false)
    $('#just-broadcast').prop('disabled', false)
    alert("No relays were found in the backup or trusted relay pool.");
    return;
  }

  // ── PHASE: BROADCAST ──────────────────────────────────────────────────
  setPhase('phase-broadcast', 'active');
  $('#broadcasting-status').text('Broadcasting to relays...');
  setProgress(0, relays.length);

  $('#relay-section').show();
  $('#checking-relays-header').text('Broadcasting to Relays');

  await broadcastEvents(data)

  setPhase('phase-broadcast', 'done');
  $('#broadcasting-status').text('Broadcasting complete' + checkMark);
  setProgress(relays.length, relays.length);

  // re-enable buttons
  $('#fetch-and-broadcast').prop('disabled', false)
  $('#just-broadcast').prop('disabled', false)
}
