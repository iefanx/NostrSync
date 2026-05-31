var relays = [];

function displayRelays() {
  console.log("Active Relays in Pool:", relays.length);
}

// Simple probe function for NIP-65 discovery verification
async function probeRelay(url) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve(false);
      return;
    }
    const timeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        resolve(false);
      }
    }, 2000);

    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      ws.close();
      resolve(false);
    };
  });
}

async function updateRelays() {
  // If relays are already loaded, don't refetch (optional, but saves bandwidth)
  if (relays.length > 100) return;

  // Try the remote API first
  try {
    console.log("Attempting to fetch relays from TrustedRelays API...");
    const response = await fetch("https://trustedrelays.xyz/api/relays");
    if (response.ok) {
      const result = await response.json();
      const pool = result.data || result;
      
      if (Array.isArray(pool)) {
        const onlineUrls = pool
          .filter(r => r.isOnline === true)
          .map(r => r.url);
        
        if (onlineUrls.length > 0) {
          relays = onlineUrls;
          console.log(`Loaded ${relays.length} active relays from TrustedRelays API`);
          displayRelays();
          return;
        }
      }
    }
  } catch (error) {
    console.warn("TrustedRelays API fetch failed. Falling back to local JSON.", error);
  }

  // Fallback to local JSON
  try {
    const response = await fetch("trustedrelays.json");
    if (response.ok) {
      const data = await response.json();
      const localUrls = data
        .filter(r => r.isOnline !== false)
        .map(r => r.url);
      
      if (localUrls.length > 0) {
        relays = localUrls;
        console.log(`Loaded ${relays.length} relays from local trustedrelays.json fallback`);
        displayRelays();
        return;
      }
    }
  } catch (error) {
    console.warn("Failed to load local trustedrelays.json", error);
  }
}

// Initial call removed - now on-demand
// $(document).ready(() => {
//   updateRelays();
// });

// Legacy support for download button if triggered
function downloadActiveRelays() {
  if (relays.length === 0) return;
  const blob = new Blob([relays.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trusted_relays.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
