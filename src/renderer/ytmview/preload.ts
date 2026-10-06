// IMPORTANT NOTES ABOUT THIS FILE
//
// This file contains all logic related to interacting with YTM itself and works under the assumption of a trusted environment and data.
// Anything passed to this file does not necessarily need to be or will be validated.
//
// If adding new things to this file ensure best security practices are followed.
// - executeJavaScript is used to enter the main world when you need to interact with YTM APIs or anything from YTM that would otherwise need the prototypes or events from YTM.
//   - Always wrap your executeJavaScript code in an IIFE calling it from outside executeJavaScript when it returns
// - Add functions to exposeInMainWorld when you need to call back to the main program. By nature you should not trust data coming from this.

import { contextBridge, ipcRenderer, webFrame } from "electron";
import Store from "../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";

import playerBarControlsScript from "./scripts/playerbarcontrols.script?raw";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script?raw";
import getPlaylistsScript from "./scripts/getplaylists.script?raw";
import toggleLikeScript from "./scripts/togglelike.script?raw";
import toggleDislikeScript from "./scripts/toggledislike.script?raw";
import simplifyContextMenuScript from "./scripts/simplifycontextmenu.script?raw";
import sortPlaylistsScript from "./scripts/sortplaylists.script?raw";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) =>
    ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata),
  sendStoreUpdate: (queueState: unknown, likeStatus: string, volume: number, muted: boolean, adPlaying: boolean) =>
    ipcRenderer.send("ytmView:storeStateChanged", queueState, likeStatus, volume, muted, adPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmView:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmView:deletePlaylistObserved", playlistId)
});

function createStyleSheet() {
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(`
      .ytmd-history-back, .ytmd-history-forward {
        cursor: pointer;
        margin: 0 18px 0 2px;
        font-size: 24px;
        color: rgba(255, 255, 255, 0.5);
      }

      .ytmd-history-back.pivotbar, .ytmd-history-forward.pivotbar {
        padding-top: 12px;
      }

      .ytmd-history-back.disabled, .ytmd-history-forward.disabled {
        cursor: not-allowed;
      }

      .ytmd-history-back:hover:not(.disabled), .ytmd-history-forward:hover:not(.disabled) {
        color: #FFFFFF;
      }

      .ytmd-hidden {
        display: none;
      }

      .ytmd-persist-volume-slider {
        opacity: 1 !important;
        pointer-events: initial !important;
      }
      
      .ytmd-player-bar-control.library-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.library-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.playlist-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.playlist-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.sleep-timer-button.active {
        color: #FFFFFF;
      }

      /* Never show the floating video miniplayer that YTM opens when leaving the player page (the music keeps playing through the player bar) */
      ytmusic-player[player-ui-state="MINIPLAYER"] {
        display: none !important;
      }
    `)
  );
  document.head.appendChild(css);
}

function createMaterialSymbolsLink() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0";
  return link;
}

function createNavigationMenuArrows() {
  // Go back in history
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add("material-symbols-outlined", "ytmd-history-back", "disabled");
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward", "disabled");
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.classList.contains("disabled")) {
      history.forward();
    }
  });

  ipcRenderer.on("ytmView:navigationStateChanged", (event, state) => {
    if (state.canGoBack) {
      historyBackElement.classList.remove("disabled");
    } else {
      historyBackElement.classList.add("disabled");
    }

    if (state.canGoForward) {
      historyForwardElement.classList.remove("disabled");
    } else {
      historyForwardElement.classList.add("disabled");
    }
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    // New YTM UI
    const searchBar = document.querySelector("ytmusic-search-box");
    const navBar = searchBar.parentNode;
    navBar.insertBefore(historyForwardElement, searchBar);
    navBar.insertBefore(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}

const SIDEBAR_BACK_LABELS: { [language: string]: string } = {
  pt: "Voltar",
  es: "Atrás",
  fr: "Retour",
  de: "Zurück",
  it: "Indietro"
};

// The extra customizations must never stop the app from loading (the loading screen only goes away once the whole setup below has finished),
// so a customization that fails or hangs is only logged to the console and skipped
async function runCustomization(name: string, customization: () => void | Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(customization),
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out")), 5000);
      })
    ]);
  } catch (error) {
    console.error(`[ytmd] Customization "${name}" failed and was skipped`, error);
  } finally {
    clearTimeout(timeout);
  }
}

async function pausePlayback() {
  try {
    (
      await webFrame.executeJavaScript(`
        (function() {
          window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo();
        })
      `)
    )();
  } catch {
    document.querySelector("video")?.pause();
  }
}

// Adds a "Back" button to YTM's left sidebar, right below "Home" (and above "Explore"), in both the expanded and the collapsed sidebar
function createSidebarBackButton() {
  let canGoBack = history.length > 1;

  const language = (document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase();
  const label = SIDEBAR_BACK_LABELS[language] ?? "Back";

  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(`
      .ytmd-sidebar-back {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        color: #FFFFFF;
        font-family: Roboto, Noto, sans-serif;
        cursor: pointer;
        user-select: none;
        border-radius: 8px;
        outline: none;
      }

      .ytmd-sidebar-back .ytmd-sidebar-back-icon {
        flex: none;
        width: 24px;
        height: 24px;
        font-size: 24px;
        line-height: 24px;
      }

      .ytmd-sidebar-back--full {
        width: 100%;
        height: 48px;
        padding: 0 16px;
      }

      .ytmd-sidebar-back--full .ytmd-sidebar-back-icon {
        margin-right: 20px;
      }

      .ytmd-sidebar-back--full .ytmd-sidebar-back-label {
        font-size: 16px;
        font-weight: 500;
        line-height: 24px;
      }

      .ytmd-sidebar-back--mini {
        width: 56px;
        height: 65px;
        flex-direction: column;
        justify-content: center;
      }

      .ytmd-sidebar-back--mini .ytmd-sidebar-back-label {
        margin-top: 5px;
        font-size: 10px;
        line-height: 12px;
      }

      .ytmd-sidebar-back:hover:not(.disabled),
      .ytmd-sidebar-back:focus-visible:not(.disabled) {
        background-color: rgba(255, 255, 255, 0.1);
      }

      .ytmd-sidebar-back.disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `)
  );
  document.head.appendChild(css);

  const goBack = () => {
    if (!canGoBack) return;

    // Going back from the player page would leave the song playing without its page, so pause it once we have actually left the player page
    if (window.location.pathname === "/watch") {
      const onPopState = () => {
        clearTimeout(removeListenerTimeout);
        if (window.location.pathname !== "/watch") {
          pausePlayback();
        }
      };
      const removeListenerTimeout = setTimeout(() => window.removeEventListener("popstate", onPopState), 2000);
      window.addEventListener("popstate", onPopState, { once: true });
    }

    history.back();
  };

  const updateState = () => {
    for (const button of document.querySelectorAll(".ytmd-sidebar-back")) {
      button.classList.toggle("disabled", !canGoBack);
      button.setAttribute("aria-disabled", String(!canGoBack));
    }
  };

  const buildButton = (variant: "full" | "mini") => {
    const button = document.createElement("div");
    button.classList.add("ytmd-sidebar-back", `ytmd-sidebar-back--${variant}`);
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.title = label;
    button.setAttribute("aria-label", label);

    const icon = document.createElement("span");
    icon.classList.add("material-symbols-outlined", "ytmd-sidebar-back-icon");
    icon.innerText = "arrow_back";

    const text = document.createElement("span");
    text.classList.add("ytmd-sidebar-back-label");
    text.innerText = label;

    button.append(icon, text);

    button.addEventListener("click", goBack);
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        goBack();
      }
    });

    return button;
  };

  // YTM can redraw the sidebar at any time, so make sure the button exists and is still right after "Home"
  const ensureButtons = () => {
    const guides = [
      { selector: "#guide-renderer", variant: "full" },
      { selector: "#mini-guide-renderer", variant: "mini" }
    ] as const;

    for (const { selector, variant } of guides) {
      const guide = document.querySelector(selector);
      if (!guide) continue;

      const home = guide.querySelector("ytmusic-guide-section-renderer ytmusic-guide-entry-renderer");
      if (!home) continue;

      const existing = guide.querySelector(".ytmd-sidebar-back");
      if (existing && existing.previousElementSibling === home) continue;

      home.insertAdjacentElement("afterend", existing ?? buildButton(variant));
    }

    updateState();
  };

  let ensureScheduled = false;
  const scheduleEnsure = () => {
    if (ensureScheduled) return;
    ensureScheduled = true;
    requestAnimationFrame(() => {
      ensureScheduled = false;
      ensureButtons();
    });
  };

  ensureButtons();

  const observer = new MutationObserver(scheduleEnsure);
  for (const selector of ["#guide-renderer", "#mini-guide-renderer"]) {
    const guide = document.querySelector(selector);
    if (guide) {
      observer.observe(guide, { childList: true, subtree: true });
    }
  }

  ipcRenderer.on("ytmView:navigationStateChanged", (_event, state: { canGoBack: boolean }) => {
    canGoBack = state.canGoBack;
    updateState();
  });
}

function createKeyboardNavigation() {
  const keyboardNavigation = document.createElement("div");
  keyboardNavigation.tabIndex = 32767;
  keyboardNavigation.onfocus = () => {
    keyboardNavigation.blur();
    ipcRenderer.send("ytmView:switchFocus", "main");
  };
  document.body.appendChild(keyboardNavigation);
}

async function createAdditionalPlayerBarControls() {
  (await webFrame.executeJavaScript(playerBarControlsScript))();
}

async function simplifyContextMenu() {
  (await webFrame.executeJavaScript(simplifyContextMenuScript))();
}

async function sortSidebarPlaylists() {
  (await webFrame.executeJavaScript(sortPlaylistsScript))();
}

async function hideChromecastButton() {
  (
    await webFrame.executeJavaScript(`
      (function() {
        window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
      })
    `)
  )();
}

async function hookPlayerApiEvents() {
  (await webFrame.executeJavaScript(hookPlayerApiEventsScript))();
}

function overrideHistoryButtonDisplay() {
  // @ts-expect-error Style is reported as readonly but this still works
  document.querySelector<HTMLElement>("#history-link .history-button").style = "display: inline-block !important;";
}

function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

// This function helps hook YTM
(async function () {
  (
    await webFrame.executeJavaScript(`
    (function() {
      window.__YTMD_HOOK__ = {};

      let fakeBaseClass = function() {
        try {
          if (window.__YTMD_HOOK__) {
            if (this.hostElement && this.hostElement.nodeName === "YTMUSIC-PLAYER-BAR") {
              window.__YTMD_HOOK__.ytmPlayerBar = this
            }

            if (this.store && !!this.store.getState && !!this.store.dispatch && !!this.store.subscribe) {
              window.__YTMD_HOOK__.ytmStore = this.store
            }
          }
        } catch {}
      }
      Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
        set: (value) => {},
        get: () => {
          return fakeBaseClass
        }
      })
    })
  `)
  )();
})();

window.addEventListener("load", async () => {
  console.log("[ytmd-debug] page load event on", window.location.hostname);
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:loaded");
    }
    return;
  }

  let hookChecks = 0;
  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      if (++hookChecks % 20 === 0) {
        const state = await webFrame.executeJavaScript(`
          (function() {
            const hook = window.__YTMD_HOOK__;
            return JSON.stringify({
              hookExists: !!hook,
              store: !!(hook && hook.ytmStore),
              playerBar: !!(hook && hook.ytmPlayerBar),
              playerApi: !!(hook && hook.ytmPlayerBar && hook.ytmPlayerBar.playerApi),
              ytmApp: !!document.querySelector("ytmusic-app"),
              playerBarElement: !!document.querySelector("ytmusic-player-bar"),
              url: location.href
            });
          })
        `);
        console.log("[ytmd-debug] still waiting for YTM hook:", await state());
      }
      const hooked = (
        await webFrame.executeJavaScript(`
        (function() {
          if (window.__YTMD_HOOK__ && (window.__YTMD_HOOK__.ytmStore && window.__YTMD_HOOK__.ytmPlayerBar && window.__YTMD_HOOK__.ytmPlayerBar.playerApi)) {
            return true;
          }
          
          return false;
        })
      `)
      )();

      if (hooked) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });

  console.log("[ytmd-debug] YTM hook ready");
  let materialSymbolsLoaded = false;

  const materialSymbols = createMaterialSymbolsLink();
  materialSymbols.onload = () => {
    materialSymbolsLoaded = true;
  };
  document.head.appendChild(materialSymbols);

  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const playerApiReady: boolean = (
        await webFrame.executeJavaScript(`
          (function() {
            return window.__YTMD_HOOK__.ytmPlayerBar.playerApi.isReady();
          })
        `)
      )();

      if (materialSymbolsLoaded && playerApiReady) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });

  console.log("[ytmd-debug] player api ready, applying customizations");
  createStyleSheet();
  createNavigationMenuArrows();
  await runCustomization("sidebar back button", createSidebarBackButton);
  createKeyboardNavigation();
  await createAdditionalPlayerBarControls();
  await hideChromecastButton();
  await runCustomization("simplify context menu", simplifyContextMenu);
  await runCustomization("sort sidebar playlists", sortSidebarPlaylists);
  console.log("[ytmd-debug] customizations done");
  await hookPlayerApiEvents();
  overrideHistoryButtonDisplay();

  const integrationScripts: { [integrationName: string]: { [scriptName: string]: string } } = await ipcRenderer.invoke("ytmView:getIntegrationScripts");

  const state = await store.get("state");
  const continueWhereYouLeftOff = (await store.get("playback")).continueWhereYouLeftOff;

  if (continueWhereYouLeftOff) {
    // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
    if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
      if (state.lastVideoId) {
        // This height transition check is a hack to fix the `Start playback` hint from not being in the correct position https://github.com/ytmdesktop/ytmdesktop/issues/1159
        let heightTransitionCount = 0;
        const transitionEnd = async (e: TransitionEvent) => {
          if (e.target === document.querySelector("ytmusic-app-layout>ytmusic-player-bar")) {
            if (e.propertyName === "height") {
              (
                await webFrame.executeJavaScript(`
                  (function() {
                    document.querySelector("ytmusic-popup-container").refitPopups_();
                  })
                `)
              )();
              heightTransitionCount++;
              if (heightTransitionCount >= 2) {
                document.querySelector("ytmusic-app-layout>ytmusic-player-bar").removeEventListener("transitionend", transitionEnd);
              }
            }
          }
        };
        document.querySelector("ytmusic-app-layout>ytmusic-player-bar").addEventListener("transitionend", transitionEnd);

        document.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: {
              endpoint: {
                watchEndpoint: {
                  videoId: state.lastVideoId,
                  playlistId: state.lastPlaylistId
                }
              }
            }
          })
        );
      }
    } else {
      (
        await webFrame.executeJavaScript(`
          (function() {
            let playerResponse = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse();
            if (playerResponse) {
              window.ytmd.sendVideoData(playerResponse.videoDetails, window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlaylistId());
            }
          })
        `)
      )();
    }
  }

  const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
  if (alwaysShowVolumeSlider) {
    document.querySelector("ytmusic-app-layout>ytmusic-player-bar #volume-slider").classList.add("ytmd-persist-volume-slider");
  }

  ipcRenderer.on("remoteControl:execute", async (_event, command, value) => {
    switch (command) {
      case "playPause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playing ? window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo() : window.__YTMD_HOOK__.ytmPlayerBar.playerApi.playVideo();
            })
          `)
        )();
        break;
      }

      case "play": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.playVideo();
            })
          `)
        )();
        break;
      }

      case "pause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo();
            })
          `)
        )();
        break;
      }

      case "next": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.nextVideo();
            })
          `)
        )();
        break;
      }

      case "previous": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.previousVideo();
            })
          `)
        )();
        break;
      }

      case "toggleLike": {
        (await webFrame.executeJavaScript(toggleLikeScript))();
        break;
      }

      case "toggleDislike": {
        (await webFrame.executeJavaScript(toggleDislikeScript))();
        break;
      }

      case "volumeUp": {
        const currentVolumeUp: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getVolume();
            })
          `)
        )();

        let newVolumeUp = currentVolumeUp + 10;
        if (currentVolumeUp > 100) {
          newVolumeUp = 100;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeUp) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(newVolumeUp);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeUp });
            })
          `)
        )(newVolumeUp);
        break;
      }

      case "volumeDown": {
        const currentVolumeDown: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getVolume();
            })
          `)
        )();

        let newVolumeDown = currentVolumeDown - 10;
        if (currentVolumeDown < 0) {
          newVolumeDown = 0;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeDown) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(newVolumeDown);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeDown });
            })
          `)
        )(newVolumeDown);
        break;
      }

      case "setVolume": {
        const valueInt: number = parseInt(value);
        // Check if Volume is a number and between 0 and 100
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
          return;
        }

        (
          await webFrame.executeJavaScript(`
            (function(valueInt) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(valueInt);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: valueInt });
            })
          `)
        )(valueInt);
        break;
      }

      case "mute":
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.mute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: true });
            })
          `)
        )();
        break;

      case "unmute":
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.unMute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: false });
            })
          `)
        )();
        break;

      case "repeatMode":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_REPEAT', payload: value });
            })
          `)
        )(value);
        break;

      case "seekTo":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.seekTo(value);
            })
          `)
        )(value);
        break;

      case "shuffle":
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").queue.shuffle();
            })
          `)
        )();
        break;

      case "playQueueIndex": {
        const index: number = parseInt(value);

        (
          await webFrame.executeJavaScript(`
            (function(index) {
              const state = window.__YTMD_HOOK__.ytmStore.getState();
              const queue = state.queue;

              const maxQueueIndex = state.queue.items.length - 1;
              const maxAutoMixQueueIndex = Math.max(state.queue.automixItems.length - 1, 0);

              let useAutoMix = false;
              if (index > maxQueueIndex) {
                index = index - state.queue.items.length;
                useAutoMix = true;
              }

              let song = null;
              if (!useAutoMix) {
                song = queue.items[index];
              } else {
                song = queue.automixItems[index];
              }

              let playlistPanelVideoRenderer;
              if (song.playlistPanelVideoRenderer) {
                playlistPanelVideoRenderer = song.playlistPanelVideoRenderer;
              } else if (song.playlistPanelVideoWrapperRenderer) {
                playlistPanelVideoRenderer = song.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
              }

              document.dispatchEvent(
                new CustomEvent("yt-navigate", {
                  detail: {
                    endpoint: {
                      watchEndpoint: playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint
                    }
                  }
                })
              );
            })
          `)
        )(index);

        break;
      }

      case "navigate": {
        const endpoint = value;
        document.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: {
              endpoint
            }
          })
        );
        break;
      }
    }
  });

  ipcRenderer.on("ytmView:getPlaylists", async (_event, requestId) => {
    const rawPlaylists = await (await webFrame.executeJavaScript(getPlaylistsScript))();

    const playlists = [];
    for (const rawPlaylist of rawPlaylists) {
      const playlist = rawPlaylist.playlistAddToOptionRenderer;
      playlists.push({
        id: playlist.playlistId,
        title: getYTMTextRun(playlist.title.runs)
      });
    }
    ipcRenderer.send(`ytmView:getPlaylists:response:${requestId}`, playlists);
  });

  store.onDidAnyChange(newState => {
    if (newState.appearance.alwaysShowVolumeSlider) {
      const volumeSlider = document.querySelector("#volume-slider");
      if (!volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.add("ytmd-persist-volume-slider");
      }
    } else {
      const volumeSlider = document.querySelector("#volume-slider");
      if (volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.remove("ytmd-persist-volume-slider");
      }
    }
  });

  ipcRenderer.on("ytmView:refitPopups", async () => {
    // Update 4/14/2024: Broken until a hook is provided for this
    /*
    (
      await webFrame.executeJavaScript(`
        (function() {
          document.querySelector("ytmusic-popup-container").refitPopups_();
        })
      `)
    )();
    */
  });

  ipcRenderer.on("ytmView:executeScript", async (_event, integrationName, scriptName) => {
    const scripts = integrationScripts[integrationName];
    if (scripts) {
      const script = scripts[scriptName];
      if (script) {
        (await webFrame.executeJavaScript(script))();
      }
    }
  });

  console.log("[ytmd-debug] sending ytmView:loaded");
  ipcRenderer.send("ytmView:loaded");
});
