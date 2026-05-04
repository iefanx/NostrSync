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

// button click handler
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
  $('#fetching-progress').css('visibility', 'hidden')
  $('#fetching-progress').val(0)
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  $('#broadcasting-progress').css('visibility', 'hidden')
  $('#broadcasting-progress').val(0)
  
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
  
  // inform user
  $('#fetching-status').text(txt.fetching)
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relays.length)

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

    // Phase 2: Initial Fetch (prioritize personal + bootstrap trusted)
    const bootstrapPool = Array.from(new Set([...personalRelays, ...relays.slice(0, 50)]));
    const filters = [{ authors: [pubkey] }, { "#p": [pubkey] }] 
    
    // Temporarily use bootstrapPool to find NIP-65
    console.log(`Fetching events using ${bootstrapPool.length} bootstrap relays...`);
    const data = (await getEvents(filters, pubkey, bootstrapPool)).sort((a, b) => b.created_at - a.created_at)

    // inform user fetching is done
    $('#fetching-status').html(txt.fetching + checkMark)
    $('#fetching-progress').val(relays.length)

    // Discover more User's Relays (NIP-65 priority, fallback to NIP-02/kind 3)
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

    $('#checking-relays-header-box').css('display', 'none')
    $('#checking-relays-box').css('display', 'none')
    
    $('#file-download').html(txt.download)
    downloadFile(data, 'nostr-backup.js')
    downloadFileCopy(data, "nostr-backup.js");
    
    $('#broadcasting-status').html(txt.broadcasting)
    $('#broadcasting-progress').css('visibility', 'visible')
    $('#broadcasting-progress').prop('max', relays.length)
    
    $('#checking-relays-header-box').css('display', 'flex')
    $('#checking-relays-box').css('display', 'flex')
    $('#checking-relays-header').text("Broadcasting to Relays:")

    await broadcastEvents(data)

    $('#broadcasting-status').html(txt.broadcasting + checkMark)
    $('#broadcasting-progress').val(relays.length)
  } catch (err) {
    console.error("Process failed:", err);
    alert("An error occurred during the sync process. Check console for details.");
  } finally {
    $('#fetch-and-broadcast').prop('disabled', false)
  }
}

// Initial state
$(document).ready(() => {
  updateButtonText();
});




// button click handler
const justBroadcast = async (fileName) => {
  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    var data = JSON.parse(event.target.result.substring(13))
    broadcast(data)
  });
  reader.readAsText(fileName)
}

const broadcast = async (data) => {
  console.log(data)
  // reset UI
  $('#fetching-status').html('')
  $('#fetching-progress').css('visibility', 'hidden')
  $('#fetching-progress').val(0)
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  $('#broadcasting-progress').css('visibility', 'hidden')
  $('#broadcasting-progress').val(0)
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
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relays.length)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  $('#fetching-progress').val(relays.length)

  const latestKind3 = data.filter((it) => it.kind == 3)[0]
  if (latestKind3 && latestKind3.content) {
    try {
      const myRelaySet = JSON.parse(latestKind3.content)
      relays = Object.keys(myRelaySet).filter(url => myRelaySet[url].write).map(url => url)
    } catch (e) {
      console.error("Error parsing JSON from file kind-3:", e);
    }
  }

  $('#checking-relays-header-box').css('display', 'none')
  $('#checking-relays-box').css('display', 'none')

  // inform user that app is broadcasting events to relays
  $('#broadcasting-status').html(txt.broadcasting)
  // show and update broadcasting progress bar
  $('#broadcasting-progress').css('visibility', 'visible')
  $('#broadcasting-progress').prop('max', relays.length)
  
  $('#checking-relays-header-box').css('display', 'flex')
  $('#checking-relays-box').css('display', 'flex')
  $('#checking-relays-header').text("Broadcasting to Relays:")

  await broadcastEvents(data)

  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  $('#broadcasting-progress').val(relays.length)
  // re-enable broadcast button
  $('#fetch-and-broadcast').prop('disabled', false)
}
