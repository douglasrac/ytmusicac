(function() {
  // Simplifies the context menu (the three dots) of songs so it only shows "Save to playlist" (and "Remove from playlist" when managing a playlist).
  // Items are identified by their icon / endpoint instead of their text, so this works in every language.
  const container = document.querySelector("ytmusic-popup-container");
  if (!container) return;

  const SAVE_TO_PLAYLIST_ICON = "ADD_TO_PLAYLIST";

  const isSaveToPlaylist = item => item.data && item.data.icon && item.data.icon.iconType === SAVE_TO_PLAYLIST_ICON;
  const isRemoveFromPlaylist = item => !!(item.data && item.data.serviceEndpoint && item.data.serviceEndpoint.playlistEditEndpoint);

  // Albums, singles and playlists have menus that look like song menus but queue a whole playlist instead of a single video, they are left alone
  const isCollectionMenu = items =>
    items.some(item => {
      const endpoint = item.data && item.data.serviceEndpoint && item.data.serviceEndpoint.queueAddEndpoint;
      return !!(endpoint && endpoint.queueTarget && !endpoint.queueTarget.videoId);
    });

  const simplifyPopup = popup => {
    const items = Array.from(popup.querySelectorAll("#items > *"));
    if (!items.some(isSaveToPlaylist) || isCollectionMenu(items)) return;

    for (const item of items) {
      item.style.display = isSaveToPlaylist(item) || isRemoveFromPlaylist(item) ? "" : "none";
    }
  };

  const simplifyAll = () => {
    for (const popup of container.querySelectorAll("ytmusic-menu-popup-renderer")) {
      simplifyPopup(popup);
    }
  };

  new MutationObserver(simplifyAll).observe(container, { childList: true, subtree: true });
  simplifyAll();
})
