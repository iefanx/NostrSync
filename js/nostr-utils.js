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

async function storeFileChunks(db, fileObject) {
  const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks
  const content = fileObject.content;

  for (let offset = 0; offset < content.size; offset += CHUNK_SIZE) {
    const chunk = content.slice(offset, offset + CHUNK_SIZE);

    // Create a transaction for each chunk
    const tx = db.transaction("Backups", "readwrite");
    const store = tx.objectStore("Backups");
    await store.put({ ...fileObject, content: chunk });
    await tx.done;
  }
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
    const uniqueFileName = generateUniqueFileName(originalFileName);
    const prettyJs = "const data = " + JSON.stringify(data, null, 2);
    const taBlob = new Blob([prettyJs], { type: "text/javascript" });

    const fileObject = {
      name: uniqueFileName,
      content: taBlob,
      size: taBlob.size,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
    };

    const db = await openDatabase();

    // Store file in chunks
    await storeFileChunks(db, fileObject);
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
const getEvents = async (filters, pubkey) => {
  // events hash
  const events = {};

  // batch processing of 10 relays
  let fetchFunctions = [...relays];
  while (fetchFunctions.length) {
    let relaysForThisRound = fetchFunctions.splice(0, 10);
    let relayStatus = {};
    $("#fetching-progress").val(relays.length - fetchFunctions.length);
    await Promise.allSettled(
      relaysForThisRound.map((relay) =>
        fetchFromRelay(relay, filters, pubkey, events, relayStatus)
      )
    );
  }
  displayRelayStatus({});

  // return data as an array of events
  return Object.keys(events).map((id) => events[id]);
};

const sendToRelay = async (relay, data, relayStatus) => {
  const openWebSocket = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(relay);
      const timeout = setTimeout(() => {
        ws.close();
        reject("timeout");
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(ws);
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        reject("WebSocket closed unexpectedly");
      };
    });

  const sendEvent = (ws, evnt) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject("timeout");
      }, 10_000);

      ws.send(JSON.stringify(["EVENT", evnt]));

      ws.onmessage = (event) => {
        clearTimeout(timeout);
        const [msgType, subscriptionId, inserted] = JSON.parse(event.data);
        if (msgType === "OK") {
          if (inserted == true) {
            updateRelayStatus(relay, undefined, 1, relayStatus);
            resolve();
          } else {
            console.log(event.data);
            reject("Failed to insert event");
          }
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        reject("WebSocket closed unexpectedly");
      };
    });

  try {
    const ws = await openWebSocket();
    updateRelayStatus(relay, "Starting", 0, relayStatus);

    for (const evnt of data) {
      updateRelayStatus(relay, "Sending", 0, relayStatus);
      await sendEvent(ws, evnt);
    }

    updateRelayStatus(relay, "Done", 0, relayStatus);
    ws.close();
  } catch (error) {
    console.error(`Error in sendToRelay for relay ${relay}:`, error);
    updateRelayStatus(relay, "Error", 0, relayStatus);
  }
};

const broadcastEvents = async (data) => {
  let relayStatus = {};
  const batchSize = 10;

  while (relays.length > 0) {
    const relaysForThisRound = relays.splice(0, batchSize);
    $("#broadcasting-progress").val(relays.length);
    await Promise.allSettled(
      relaysForThisRound.map((relay) => sendToRelay(relay, data, relayStatus))
    );
  }

  displayRelayStatus(relayStatus);
};
