const fixedRelays = []; // Initialize as an empty array

var relays = [];

function updateRelays() {
  const showAllRelays = document.getElementById("relayToggle").checked;

  if (showAllRelays) {
    fetch("https://api.nostr.watch/v1/online")
      .then((response) => response.json())
      .then((json) => {
        relays = json.slice(0, 30); // Get the first 30 relays
        displayRelays();
      });
  } else {
    // If the toggle is off, fetch and use the first 30 relays
    fetch("https://api.nostr.watch/v1/online")
      .then((response) => response.json())
      .then((json) => {
        relays = json.slice(0, 30);
        displayRelays();
      });

  }
}

// Initial call to populate relays array
updateRelays();


// Add an event listener to the toggle switch
document.getElementById("relayToggle").addEventListener("change", updateRelays);


