chrome.runtime.onInstalled.addListener(() => {
  console.log('Feishu2MD extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  // Popup handles the UI; this is a fallback if popup is disabled
});
