/** Background service worker — handles extension icon click and badge updates. */
chrome.action.onClicked.addListener((tab) => {
  // Open the popup (default action) — nothing extra needed
});

// Show badge when on a supported listing page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const url = tab.url;
  const isListing = /zillow\.com\/homedetails/.test(url);
  chrome.action.setBadgeText({ tabId, text: isListing ? '●' : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#34d399' });
});
