// from https://github.com/paulmillr/noble-secp256k1/blob/main/index.ts#L803
function hexToBytes(hex) {
    if (typeof hex !== 'string') {
      throw new TypeError('hexToBytes: expected string, got ' + typeof hex)
    }
    if (hex.length % 2)
      throw new Error('hexToBytes: received invalid unpadded hex' + hex.length)
    const array = new Uint8Array(hex.length / 2)
    for (let i = 0; i < array.length; i++) {
      const j = i * 2
      const hexByte = hex.slice(j, j + 2)
      const byte = Number.parseInt(hexByte, 16)
      if (Number.isNaN(byte) || byte < 0) throw new Error('Invalid byte sequence')
      array[i] = byte
    }
    return array
  }
  
  // decode nip19 ('npub') to hex
  const npub2hexa = (npub) => {
    let { prefix, words } = bech32.bech32.decode(npub, 90)
    if (prefix === 'npub') {
      let data = new Uint8Array(bech32.bech32.fromWords(words))
      return buffer.Buffer.from(data).toString('hex')
    }
  }
  
  // encode hex to nip19 ('npub')
  const hexa2npub = (hex) => {
    const data = hexToBytes(hex)
    const words = bech32.bech32.toWords(data)
    const prefix = 'npub'
    return bech32.bech32.encode(prefix, words, 90)
  }
  
  // parse inserted pubkey
  const parsePubkey = (pubkey) =>
    pubkey.match('npub1') ? npub2hexa(pubkey) : pubkey
  


 // Open or create a new IndexedDB database
const dbName = 'NostrDB';
const dbVersion = 1;
const objectStoreName = 'Backups';

const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create an object store to store your "Data" files
      if (!db.objectStoreNames.contains(objectStoreName)) {
        db.createObjectStore(objectStoreName, { autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      resolve(db);
    };
  });
};

const generateUniqueFileName = (fileName) => {
  const timestamp = Date.now(); // Use a timestamp as part of the unique key
  return `${timestamp}_${fileName}`;
};

const downloadFile = async (data, fileName) => {
  const prettyJs = "const data = " + JSON.stringify(data, null, 2);

  try {
    // Open the IndexedDB database
    const db = await openDatabase();
    const transaction = db.transaction([objectStoreName], 'readwrite');
    const objectStore = transaction.objectStore(objectStoreName);

    const uniqueFileName = generateUniqueFileName(fileName);
    const fileData = new Blob([prettyJs], { type: "text/javascript" });

    // Store the file in IndexedDB with the unique key
    const request = objectStore.add(fileData, uniqueFileName);

    request.onsuccess = (event) => {
      console.log('File stored in IndexedDB with unique key:', uniqueFileName);
    };

    request.onerror = (event) => {
      console.error('Error storing file in IndexedDB:', event.target.error);
    };
  } catch (error) {
    console.error('Error opening IndexedDB:', error);
  }
};





  const updateRelayStatus = (relay, status, addToCount, relayStatusAndCount) => {
    if (relayStatusAndCount[relay] == undefined) {
      relayStatusAndCount[relay] = {}
    }

    if (status)
      relayStatusAndCount[relay].status = status

    if (relayStatusAndCount[relay].count != undefined) 
      relayStatusAndCount[relay].count = relayStatusAndCount[relay].count + addToCount
    else 
      relayStatusAndCount[relay].count = addToCount

    displayRelayStatus(relayStatusAndCount)
  }

  const displayRelayStatus = (relayStatusAndCount) => {
    if (Object.keys(relayStatusAndCount).length > 0) {
      let newText = Object.keys(relayStatusAndCount).map(
        it => it.replace("wss://", "").replace("ws://", "") + ": " + relayStatusAndCount[it].status + " (" + relayStatusAndCount[it].count + ")"
      ).join("<br />")
      $('#checking-relays').html(newText)
    } else {
      $('#checking-relays-header').html("")
      $('#checking-relays').html("")
    }
  }

  // fetch events from relay, returns a promise
  const fetchFromRelay = async (relay, filters, pubkey, events, relayStatus) =>
    new Promise((resolve, reject) => {
      try {
        updateRelayStatus(relay, "Starting", 0, relayStatus)
        // open websocket
        const ws = new WebSocket(relay)

        // prevent hanging forever
        let myTimeout = setTimeout(() => {
          ws.close()
          reject('timeout')
        }, 10_000)


        // subscription id
        const subsId = 'my-sub'
        // subscribe to events filtered by author
        ws.onopen = () => {
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => {
            ws.close()
            reject('timeout')
          }, 10_000)
          updateRelayStatus(relay, "Downloading", 0, relayStatus)
          ws.send(JSON.stringify(['REQ', subsId].concat(filters)))
        }
  
        // Listen for messages
        ws.onmessage = (event) => {
          const [msgType, subscriptionId, data] = JSON.parse(event.data)
          // event messages
          if (msgType === 'EVENT' && subscriptionId === subsId) {
            clearTimeout(myTimeout)
            myTimeout = setTimeout(() => {
              ws.close()
              reject('timeout')
            }, 10_000)

            const { id } = data

            // don't save/reboradcast kind 3s that are not from the author. 
            // their are too big. 
            if (data.kind == 3 && data.pubkey != pubkey) {
              return
            }

            updateRelayStatus(relay, undefined, 1, relayStatus)

            // prevent duplicated events
            if (events[id]) return
            else events[id] = data

            // show how many events were found until this moment
            $('#events-found').text(`${Object.keys(events).length} events found`)
          }
          // end of subscription messages
          if (msgType === 'EOSE' && subscriptionId === subsId) {
            updateRelayStatus(relay, "Done", 0, relayStatus)
            ws.close()
            resolve()
          }
        }
        ws.onerror = (err) => {
          updateRelayStatus(relay, "Done", 0, relayStatus)
          ws.close()
          reject(err)
        }
        ws.onclose = (socket, event) => {
          updateRelayStatus(relay, "Done", 0, relayStatus)
          resolve()
        }
      } catch (exception) {
        console.log(exception)
        updateRelayStatus(relay, "Error", 0, relayStatus)
        try {
          ws.close()
        } catch (exception) {
        }
        
        reject(exception)
      }
    })
  
  // query relays for events published by this pubkey
  const getEvents = async (filters, pubkey) => {
    // events hash
    const events = {}

    // batch processing of 10 relays
    let fetchFunctions = [...relays]
    while (fetchFunctions.length) {
      let relaysForThisRound = fetchFunctions.splice(0, 10)
      let relayStatus = {}
      $('#fetching-progress').val(relays.length - fetchFunctions.length)
      await Promise.allSettled( relaysForThisRound.map((relay) => fetchFromRelay(relay, filters, pubkey, events, relayStatus)) )
    }
    displayRelayStatus({})

    // return data as an array of events
    return Object.keys(events).map((id) => events[id])
  }
  
  // send events to a relay, returns a promisse
  const sendToRelay = async (relay, data, relayStatus) =>
    new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(relay)

        updateRelayStatus(relay, "Starting", 0, relayStatus)

        // prevent hanging forever
        let myTimeout = setTimeout(() => {
          ws.close()
          reject('timeout')
        }, 10_000)

        // fetch events from relay
        ws.onopen = () => {
          updateRelayStatus(relay, "Sending", 0, relayStatus)
          for (evnt of data) {
            clearTimeout(myTimeout)
            myTimeout = setTimeout(() => {
              ws.close()
              reject('timeout')
            }, 10_000)

            ws.send(JSON.stringify(['EVENT', evnt]))
          }
        }
        // Listen for messages
        ws.onmessage = (event) => {
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => {
            ws.close()
            reject('timeout')
          }, 10_000)

          const [msgType, subscriptionId, inserted] = JSON.parse(event.data)
          // event messages
          // end of subscription messages
          if (msgType === 'OK') {
            if (inserted == true) {
              updateRelayStatus(relay, undefined, 1, relayStatus)
            } else {
              console.log(event.data)
            }
          }
        }
        ws.onerror = (err) => {
          updateRelayStatus(relay, "Error", 0, relayStatus)
          console.log("Error", err)
          ws.close()
          reject(err)
        }
        ws.onclose = (socket, event) => {
          updateRelayStatus(relay, "Done", 0, relayStatus)
          resolve()
        }
      } catch (exception) {
        console.log(exception)
        updateRelayStatus(relay, "Error", 0, relayStatus)
        try {
          ws.close()
        } catch (exception) {
        }
        reject(exception)
      }
    })
  
  // broadcast events to list of relays
  const broadcastEvents = async (data) => {
    // batch processing of 10 relays
    let broadcastFunctions = [...relays]
    let relayStatus = {}
    while (broadcastFunctions.length) {
      let relaysForThisRound = broadcastFunctions.splice(0, 10)
      $('#broadcasting-progress').val(relays.length - broadcastFunctions.length)
      await Promise.allSettled( relaysForThisRound.map((relay) => sendToRelay(relay, data, relayStatus)) )
    }

    displayRelayStatus(relayStatus)
  }