(function() {
  // Shows the playlists of the left sidebar in alphabetical order, with "Liked music" and then "Episodes for later" at the very bottom.
  // The entries are not moved in the DOM (YTM re-renders and manages them), only their visual order is changed using the CSS order property.
  // Entries are identified by the page they open instead of their text, so this works in every language.
  const LIKED_MUSIC_BROWSE_ID = "VLLM";
  const EPISODES_FOR_LATER_BROWSE_ID = "VLSE";
  const SORTED_ATTRIBUTE = "ytmd-sorted-playlists";

  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(`
      ytmusic-guide-section-renderer[${SORTED_ATTRIBUTE}] #items {
        display: flex;
        flex-direction: column;
      }
    `)
  );
  document.head.appendChild(style);

  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

  const getBrowseId = entry => {
    const endpoint = entry.data && entry.data.navigationEndpoint && entry.data.navigationEndpoint.browseEndpoint;
    return (endpoint && endpoint.browseId) || "";
  };

  const getTitle = entry => {
    const title = entry.querySelector(".title");
    return title ? title.textContent.trim() : "";
  };

  const sortSection = section => {
    const entries = Array.from(section.querySelectorAll("#items > ytmusic-guide-entry-renderer"));
    const playlistEntries = entries.filter(entry => getBrowseId(entry).startsWith("VL"));
    if (playlistEntries.length < 2) return;

    const likedMusic = playlistEntries.filter(entry => getBrowseId(entry) === LIKED_MUSIC_BROWSE_ID);
    const episodesForLater = playlistEntries.filter(entry => getBrowseId(entry) === EPISODES_FOR_LATER_BROWSE_ID);
    const playlists = playlistEntries
      .filter(entry => getBrowseId(entry) !== LIKED_MUSIC_BROWSE_ID && getBrowseId(entry) !== EPISODES_FOR_LATER_BROWSE_ID)
      .sort((a, b) => collator.compare(getTitle(a), getTitle(b)));

    section.setAttribute(SORTED_ATTRIBUTE, "");
    [...playlists, ...likedMusic, ...episodesForLater].forEach((entry, index) => {
      entry.style.order = String(index + 1);
    });
  };

  const sortAll = () => {
    for (const section of document.querySelectorAll("#guide-renderer ytmusic-guide-section-renderer, #mini-guide-renderer ytmusic-guide-section-renderer")) {
      sortSection(section);
    }
  };

  // YTM can redraw or update the sidebar at any time (new playlist, renamed playlist...), so sort again whenever it changes
  let sortScheduled = false;
  const scheduleSort = () => {
    if (sortScheduled) return;
    sortScheduled = true;
    requestAnimationFrame(() => {
      sortScheduled = false;
      sortAll();
    });
  };

  const observer = new MutationObserver(scheduleSort);
  for (const guide of document.querySelectorAll("#guide-renderer, #mini-guide-renderer")) {
    observer.observe(guide, { childList: true, subtree: true, characterData: true });
  }
  sortAll();
})
