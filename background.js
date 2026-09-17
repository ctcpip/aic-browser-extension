if (typeof fetchArticImage !== 'function' && typeof importScripts === 'function') {
  importScripts('cloudflare-cookies.js');
}

const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

function sync() {
  if (typeof syncCloudflareClearance !== 'function') {
    return;
  }
  syncCloudflareClearance().catch(() => {
    // Cookie or DNR APIs can be unavailable during early startup.
  });
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== extensionApi.runtime.id) {
    sendResponse({ ok: false, error: 'Rejected external sender' });
    return false;
  }

  if (typeof fetchArticImage !== 'function' || typeof syncCloudflareClearance !== 'function') {
    sendResponse({ ok: false, error: 'background helpers missing' });
    return false;
  }

  if (message?.type === 'syncCloudflareCookies') {
    syncCloudflareClearance(Boolean(message.force))
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === 'fetchArticImage') {
    fetchArticImage(message.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

extensionApi.runtime.onInstalled.addListener(sync);
extensionApi.runtime.onStartup.addListener(sync);

if (typeof watchCloudflareClearance === 'function') {
  watchCloudflareClearance();
}
sync();
