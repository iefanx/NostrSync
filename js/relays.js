const fixedRelays = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://eden.nostr.land",
  "wss://nostr.wine",
  "wss://relay.snort.social",
  "wss://relay.nostr.band",
  "wss://nostr.bitcoiner.social",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.nostr.bg",
  "wss://nostr.mom",
  "wss://relay.orangepill.dev",
  "wss://no.str.cr",
  "wss://relay.nostr.com.au",
  "wss://offchain.pub",
  "wss://relay.plebstr.com",
  "wss://nostr.fmt.wiz.biz",
  "wss://nostr.rocks",
  "wss://nostr.mutinywallet.com",
  "wss://e.nos.lol",
  "wss://purplepag.es",
  "wss://nostr-relay.nokotaro.com",
  "wss://filter.nostr.wine",
  "wss://relayable.org",
  "wss://relay.mostr.pub",
  "wss://nostr-pub1.southflorida.ninja",
  "wss://nostr.600.wtf",
  "wss://nostr-relay.texashedge.xyz",
  "wss://nostr.btcmp.com",
  "wss://relay.nostr.africa",
  "wss://ragnar-relay.com",
  "wss://nostr.zkid.social",
  "wss://nostr.data.haus",
  "wss://nostr.terminus.money",
  "wss://nostr.0ne.day",
  "wss://relay.valera.co",
  "wss://nostr.koning-degraaf.nl",
  "wss://nostr.pleb.network",
  "wss://nostr.cheeserobot.org",
  "wss://nostr.thank.eu",
  "wss://relay.hamnet.io",
  "wss://nostr.shroomslab.net",
  "wss://nostr.truckenbucks.com",
  "wss://zee-relay.fly.dev",
  "wss://nostr.blockpower.capital",
  "wss://nostr.sidnlabs.nl",
  "wss://nostr.inosta.cc",
  "wss://nostr21.com",
  "wss://arc1.arcadelabs.co",
  "wss://spore.ws",
  "wss://nostr.ch3n2k.com",
  "wss://nostr.island.network",
  "wss://relay.nostrview.com",
  "wss://relay.nostromo.social",
  "wss://offchain.pub",
  "wss://relay.nostr.wirednet.jp",
  "wss://jp-relay-nostr.invr.chat",
  "wss://paid.spore.ws",
  "wss://nostr.notmyhostna.me",
  "wss://nostr.l00p.org",
  "wss://relay.reeve.cn",
  "wss://lightningrelay.com",
  "wss://bitcoinmaximalists.online",
  "wss://nostr.rocket-tech.net",
  "wss://nostr-2.afarazit.eu",
  "wss://private.red.gb.net",
  "wss://relay.nostrid.com",
  "wss://nostr.uthark.com",
  "wss://nostr.cruncher.com",
  "wss://relay.nostrcheck.me",
  "wss://nostrelay.yeghro.site",
  "wss://relay.nostr.vet",
  "wss://nostr.yuv.al",
];

var relays = []

function updateRelays() {
  const showAllRelays = document.getElementById("relayToggle").checked;

  if (showAllRelays) {
    fetch("https://api.nostr.watch/v1/online")
      .then((response) => response.json())
      .then((json) => {
        relays = fixedRelays.concat(json);
        // Call a function to display the relays as needed.
        displayRelays();
      });
  } else {
    // Show only fixed relays
    relays = fixedRelays;
    // Call a function to display the relays as needed.
    displayRelays();
  }
}



// Initial call to populate relays array
updateRelays();

// Add an event listener to the toggle switch
document.getElementById("relayToggle").addEventListener("change", updateRelays);

function displayRelays() {
  // Implement code to display the relays in your UI as per your requirements.
  // You can loop through the relays array and append them to a list, for example.
}
