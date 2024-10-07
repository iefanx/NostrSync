// button click handler
const fetchAndBroadcast = async () => {
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
    fetching: 'Fetching from relays... ',
    download: `Downloading Backup file... ${checkMark}`,
  }
  $('#checking-relays-header').text("Waiting for Relays: ")
  // parse pubkey ('npub' or hexa)
  const pubkey = parsePubkey($('#pubkey').val())
  if (!pubkey) return
  // disable button (will be re-enable at the end of the process)
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)
  // inform user that app is fetching from relays
  $('#fetching-status').text(txt.fetching)
  // show and update fetching progress bar
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relays.length)

  $('#checking-relays-header-box').css('display', 'flex')
  $('#checking-relays-box').css('display', 'flex')
  $('#checking-relays-header').text("Waiting for Relays:")

  // get all events from relays
  const filters =[{ authors: [pubkey] }, { "#p": [pubkey] }] 
  const data = (await getEvents(filters, pubkey)).sort((a, b) => b.created_at - a.created_at)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  $('#fetching-progress').val(relays.length)

  const latestKind3 = data.filter((it) => it.kind == 3 && it.pubkey === pubkey)[0]  
 try {
   const myRelaySet = JSON.parse(latestKind3.content);

   // Continue with your code to work with the parsed JSON data
   relays = Object.keys(myRelaySet)
     .filter((url) => myRelaySet[url].write)
     .map((url) => url);

   $("#checking-relays-header-box").css("display", "none");
   $("#checking-relays-box").css("display", "none");
 } catch (error) {
   console.error("Error parsing JSON:", error);
   // Handle the error gracefully, e.g., display an error message to the user or take appropriate action.
 }

  $('#checking-relays-header-box').css('display', 'none')
  $('#checking-relays-box').css('display', 'none')
  // inform user that backup file (js format) is being downloaded
  $('#file-download').html(txt.download)
  downloadFile(data, 'nostr-backup.js')

   $("#file-download").html(txt.download);
   const useJsonl = document.getElementById("jsonlToogle").checked;
   const fileName = useJsonl ? "nostr-backup.jsonl" : "nostr-backup.js"

   downloadFileCopy(data, fileName, useJsonl);
  
  
  // inform user that app is broadcasting events to relays
  $('#broadcasting-status').html(txt.broadcasting)
  // show and update broadcasting progress bar
  $('#broadcasting-progress').css('visibility', 'visible')
  $('#broadcasting-progress').prop('max', relays.length)
  
  $('#checking-relays-header-box').css('display', 'flex')
  $('#checking-relays-box').css('display', 'flex')
  $('#checking-relays-header').text("Broadcasting to Relays:")

  const shouldBroadcast = document.getElementById("broadcastToogle").checked;
  if (shouldBroadcast) {
    await broadcastEvents(data)
  }

  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  $('#broadcasting-progress').val(relays.length)
  // re-enable broadcast button
  $('#fetch-and-broadcast').prop('disabled', false)
}

const getFromExtension = async () => {
  const pubkey = await window.nostr.getPublicKey()
  if (pubkey) $('#pubkey').val(pubkey).change()
}

const pubkeyOnChange = () => {
  $('#fetch-and-broadcast').css('display', '')
  $('#get-from-extension').css('display', 'none')
}

if (window.nostr) {
  $('#fetch-and-broadcast').css('display', 'none')
  $('#get-from-extension').css('display', '')
}




// button click handler
const justBroadcast = async (fileName) => {
  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    let data = ""
    const lines = event.target.result.split('\n');
    if (fileName.name.endsWith('.jsonl')) {
      data = lines.filter(line => line.trim() !== '').map(line => JSON.parse(line));
    } else {
      data = JSON.parse(event.target.result.substring(13))
    }
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
  const myRelaySet = JSON.parse(latestKind3.content)
  relays = Object.keys(myRelaySet).filter(url => myRelaySet[url].write).map(url => url)

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
