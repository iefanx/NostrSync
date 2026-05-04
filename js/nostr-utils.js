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

const downloadFileCopy = (data, fileName) => {
  const prettyJs = "const data = " + JSON.stringify(data, null, 2);
  const tempLink = document.createElement("a");
  const taBlob = new Blob([prettyJs], { type: "text/javascript" });
  tempLink.setAttribute("href", URL.createObjectURL(taBlob));
  tempLink.setAttribute("download", fileName);
  tempLink.click();
};

async function downloadFile(data, originalFileName) {
  try {
    // Step 1: Generate a unique file name
    const uniqueFileName = generateUniqueFileName(originalFileName);

    // Step 2: Create a formatted JavaScript string
    const prettyJs = "const data = " + JSON.stringify(data, null, 2);

    // Step 3: Create a Blob from the formatted JavaScript string
    const taBlob = new Blob([prettyJs], { type: "text/javascript" });

    // Step 4: Optionally, store the file in IndexedDB (if needed)
    const fileObject = {
      name: uniqueFileName,
      content: taBlob,
      size: taBlob.size,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
    };

    // Step 5: Optionally, open a connection to the IndexedDB database
    const db = await openDatabase();

    // Step 6: Optionally, store the file object in IndexedDB
    await storeFile(db, fileObject);
  } catch (error) {
    console.error("Error while downloading and storing the file:", error);
    // Handle the error, possibly by showing a user-friendly message
  }
}

const updateRelayStatus = (relay, status, addToCount, relayStatusAndCount) => {
  if (relayStatusAndCount[relay] == undefined) {
    relayStatusAndCount[relay] = {};
  }

  if (status) relayStatusAndCount[relay].status = status;

  if (relayStatusAndCount[relay].count != undefined)
    relayStatusAndCount[relay].count =
      relayStatusAndCount[relay].count + addToCount;
  else relayStatusAndCount[relay].count = addToCount;

  displayRelayStatus(relayStatusAndCount);
};

const displayRelayStatus = (relayStatusAndCount) => {
  if (Object.keys(relayStatusAndCount).length > 0) {
    let newText = Object.keys(relayStatusAndCount)
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

// fetch events from relay, returns a promise
const fetchFromRelay = async (relay, filters, pubkey, events, relayStatus) =>
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

          // don't save/reboradcast kind 3s that are not from the author.
          // their are too big.
          if (data.kind == 3 && data.pubkey != pubkey) {
            return;
          }

          updateRelayStatus(relay, undefined, 1, relayStatus);

          // prevent duplicated events
          if (events[id]) return;
          else events[id] = data;

          // show how many events were found until this moment
          $("#events-found").text(`${Object.keys(events).length} events found`);
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

// query relays for events published by this pubkey
const getEvents = async (filters, pubkey, customPool) => {
  const events = {};
  const pool = customPool || relays;
  const relayStatus = {};
  const poolSize = 30; // Maintain 30 active connections
  let processedCount = 0;

  console.log(`Starting dynamic fetch pool for ${pool.length} relays...`);
  
  const queue = [...pool];
  const workers = [];

  const next = async () => {
    if (queue.length === 0) return;
    const relay = queue.shift();
    try {
      await fetchFromRelay(relay, filters, pubkey, events, relayStatus);
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

// send events to a relay, returns a promisse
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

      // fetch events from relay
      ws.onopen = () => {
        updateRelayStatus(relay, "Sending", 0, relayStatus);
        for (evnt of data) {
          clearTimeout(myTimeout);
          myTimeout = setTimeout(() => {
            ws.close();
            reject("timeout");
          }, 10_000);

          ws.send(JSON.stringify(["EVENT", evnt]));
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

// broadcast events to list of relays
const broadcastEvents = async (data) => {
  const poolSize = 30; // Maintain 30 active connections
  const relayStatus = {};
  let processedCount = 0;

  console.log(`Starting dynamic broadcast pool for ${relays.length} relays...`);

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
