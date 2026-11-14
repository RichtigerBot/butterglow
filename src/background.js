// Starts capturing the active tab when the icon is clicked.
// The stream ID is only valid for a few seconds and is passed to the visualizer window immediately.

async function getCaptures() {
  const { captures = {} } = await chrome.storage.session.get('captures');
  return captures;
}

chrome.action.onClicked.addListener(async (tab) => {
  const captures = await getCaptures();

  // A tab can only be captured once, so bring the open window back to the front.
  if (captures[tab.id] !== undefined) {
    try {
      await chrome.windows.update(captures[tab.id], { focused: true });
      return;
    } catch {
      delete captures[tab.id];
    }
  }

  const query = new URLSearchParams();
  query.set('tab', String(tab.id)); // For the media player: it controls exactly this tab.
  try {
    query.set('streamId', await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }));
  } catch (error) {
    query.set('error', error.message);
  }

  const window = await chrome.windows.create({
    url: chrome.runtime.getURL(`visualizer.html?${query}`),
    type: 'popup',
    state: 'fullscreen',
  });

  if (query.has('streamId')) {
    captures[tab.id] = window.id;
    await chrome.storage.session.set({ captures });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const captures = await getCaptures();
  for (const [tabId, captureWindowId] of Object.entries(captures)) {
    if (captureWindowId === windowId) delete captures[tabId];
  }
  await chrome.storage.session.set({ captures });
});
