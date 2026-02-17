// Allow the side panel to be opened alongside the popup
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

// Listen for messages from popup to open side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: message.windowId }).then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true; // async response
  }
});
