let isCustomMode = false;

function toggleCustomRelays() {
  const box = $('#custom-relays-box');
  if (box.css('display') === 'none') {
    box.slideDown();
  } else {
    box.slideUp();
  }
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
  
  // Highlight the Custom Relays button (target the label inside the toggle-button container)
  $('#toggleCustomRelays label').css({
    'background': 'linear-gradient(90deg, #7f7dd1, #548dd9 100%, #548dd9 0)',
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

const resetProgressBar = (selector) => {
  $(selector).css('visibility', 'hidden');
  $(selector).prop('max', 1);
  $(selector).val(0);
}

const showProgressBar = (selector, max, value = 0) => {
  const normalizedMax = Math.max(1, max);
  const normalizedValue = Math.min(value, normalizedMax);

  $(selector).css('visibility', 'visible');
  $(selector).prop('max', normalizedMax);
  $(selector).val(normalizedValue);
}

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
    await Promise.all(discoveredRelays.map(async (url) => {
      const isAlive = await probeRelay(url);
      if (isAlive) activePersonalRelays.push(url);
    }));

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
          // We don't auto-start here to give user a chance to see the key
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
    $('#fetching-status').text("Updating relay list from API...")
    await updateRelays();
  }

  // reset UI
  $('#fetching-status').html('')
  resetProgressBar('#fetching-progress')
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  resetProgressBar('#broadcasting-progress')
  
  const checkMark = '&#10003;'
  const txt = {
    broadcasting: 'Broadcasting to relays... ',
    fetching: 'Fetching from relays... ',
    download: `Downloading Backup file... ${checkMark}`,
  }
  
  $('#checking-relays-header').text("Waiting for Relays: ")
  
  // disable button
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)

  $('#checking-relays-header-box').css('display', 'flex')
  $('#checking-relays-box').css('display', 'flex')

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

    // Phase 2: Fetch from the full trusted pool plus any relays from the extension.
    const bootstrapPool = Array.from(new Set([...personalRelays, ...relays]));
    const filters = [{ authors: [pubkey] }, { "#p": [pubkey] }] 

    // inform user
    $('#fetching-status').text(txt.fetching)
    showProgressBar('#fetching-progress', bootstrapPool.length)
    
    // Temporarily use bootstrapPool to find NIP-65
    console.log(`Fetching events using ${bootstrapPool.length} bootstrap relays...`);
    const data = (await getEvents(filters, pubkey, bootstrapPool)).sort((a, b) => b.created_at - a.created_at)

    // inform user fetching is done
    $('#fetching-status').html(txt.fetching + checkMark)
    showProgressBar('#fetching-progress', bootstrapPool.length, bootstrapPool.length)

    // ── PARALLEL PHASE: Serialize/Store + Relay Discovery simultaneously ────
    // These two operations are independent — no reason to wait for one before
    // starting the other.  On mobile this saves 2-5 seconds.

    const serializePromise = serializeAndStore(data, 'nostr-backup.jsonl');
    const discoveryPromise = discoverAndProbeRelays(data, pubkey, personalRelays);

    // Wait for both to finish
    await Promise.all([serializePromise, discoveryPromise]);

    $('#checking-relays-header-box').css('display', 'none')
    $('#checking-relays-box').css('display', 'none')
    
    $('#file-download').html(txt.download)

    // Free the data reference — broadcastData holds the only ref now.
    // This lets GC reclaim the serialization artifacts (Worker already
    // finished and terminated at this point).
    const broadcastData = data;
    
    $('#broadcasting-status').html(txt.broadcasting)
    showProgressBar('#broadcasting-progress', relays.length)
    
    $('#checking-relays-header-box').css('display', 'flex')
    $('#checking-relays-box').css('display', 'flex')
    $('#checking-relays-header').text("Broadcasting to Relays:")

    await broadcastEvents(broadcastData)

    $('#broadcasting-status').html(txt.broadcasting + checkMark)
    showProgressBar('#broadcasting-progress', relays.length, relays.length)
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
  // reset UI
  $('#fetching-status').html('')
  resetProgressBar('#fetching-progress')
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  resetProgressBar('#broadcasting-progress')
  // messages to show to user
  const checkMark = '&#10003;'
  const txt = {
    broadcasting: 'Broadcasting to relays... ',
    fetching: 'Loading from file... ',
    download: `Downloading Backup file... ${checkMark}`,
  }
  // disable button (will be re-enable at the end of the process)
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)
  // show and update fetching progress bar
  showProgressBar('#fetching-progress', 1)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  showProgressBar('#fetching-progress', 1, 1)

  relays = await resolveRestoreRelayPool(data)

  if (relays.length === 0) {
    $('#broadcasting-status').html('No relays available for broadcast.')
    $('#fetch-and-broadcast').prop('disabled', false)
    $('#just-broadcast').prop('disabled', false)
    alert("No relays were found in the backup or trusted relay pool.");
    return;
  }

  $('#checking-relays-header-box').css('display', 'none')
  $('#checking-relays-box').css('display', 'none')

  // inform user that app is broadcasting events to relays
  $('#broadcasting-status').html(txt.broadcasting)
  // show and update broadcasting progress bar
  showProgressBar('#broadcasting-progress', relays.length)
  
  $('#checking-relays-header-box').css('display', 'flex')
  $('#checking-relays-box').css('display', 'flex')
  $('#checking-relays-header').text("Broadcasting to Relays:")

  await broadcastEvents(data)

  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  showProgressBar('#broadcasting-progress', relays.length, relays.length)
  // re-enable broadcast button
  $('#fetch-and-broadcast').prop('disabled', false)
  $('#just-broadcast').prop('disabled', false)
}
