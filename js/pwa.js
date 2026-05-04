let deferredInstallPrompt = null;

const isStandaloneMode = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const updateInstallButton = () => {
  const installButton = document.getElementById("install-app");

  if (!installButton) {
    return;
  }

  if (isStandaloneMode()) {
    installButton.hidden = true;
    return;
  }

  if (deferredInstallPrompt) {
    installButton.hidden = false;
    installButton.disabled = false;
    installButton.textContent = "Install App";
    return;
  }

  installButton.hidden = true;
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
};

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});

window.addEventListener("DOMContentLoaded", () => {
  registerServiceWorker();

  const installButton = document.getElementById("install-app");
  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        return;
      }

      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallButton();
    });
  }

  updateInstallButton();
});