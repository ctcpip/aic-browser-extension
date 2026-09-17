const articDomain = 'artic.edu';
const cloudflareCookieRuleId = 1;
const cloudflareOriginRuleId = 2;
const cloudflareCookieNames = new Set(['cf_clearance', '__cf_bm']);
let watchingCloudflareCookies = false;
let webRequestInstalled = false;
let dnrCookieRuleInstalled = false;
let dnrOriginRuleInstalled = false;
let cachedCookieHeader = '';
let lastCookieNames = [];
let lastInjected = false;
let hostAccess = null;
let lastError = null;
let lastConfiguredCookieHeader = null;
let lastSyncAt = 0;
let syncPromise = null;
let syncQueue = Promise.resolve();

const articOrigins = [
  'https://www.artic.edu/*',
  'https://artic.edu/*',
];
const cookieSyncMaxAgeMs = 30 * 1000;
const iiifHostname = 'www.artic.edu';
const iiifPath = '/iiif/2/';

function getExtensionApi() {
  if (typeof browser !== 'undefined' && browser.cookies) {
    return browser;
  }
  if (typeof chrome !== 'undefined' && chrome.cookies) {
    return chrome;
  }
  return null;
}

function isFirefoxBrowser() {
  return typeof browser !== 'undefined' && Boolean(browser.runtime?.getBrowserInfo);
}

function isArticDomain(domain) {
  const normalized = (domain || '').replace(/^\./, '');
  return normalized === articDomain || normalized.endsWith(`.${articDomain}`);
}

function isAllowedIIIFUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === iiifHostname
      && url.pathname.startsWith(iiifPath);
  }
  catch {
    return false;
  }
}

function cookieAppliesToIIIF(cookie) {
  const domain = (cookie.domain || '').replace(/^\./, '');
  const domainMatches = cookie.hostOnly
    ? domain === iiifHostname
    : iiifHostname === domain || iiifHostname.endsWith(`.${domain}`);
  const pathMatches = iiifPath.startsWith(cookie.path || '/');
  const partition = cookie.partitionKey?.topLevelSite || '';
  const partitionMatches = !partition
    || partition === 'https://www.artic.edu'
    || partition === 'https://artic.edu';
  const firstParty = cookie.firstPartyDomain || '';
  const firstPartyMatches = !firstParty
    || firstParty === articDomain
    || firstParty === iiifHostname;

  return domainMatches && pathMatches && partitionMatches && firstPartyMatches;
}

function isExtensionInitiated(details, api) {
  const origin = details.originUrl || details.initiator || details.documentUrl || '';
  const extensionOrigin = api.runtime.getURL('').replace(/\/$/, '');
  return origin === extensionOrigin || origin.startsWith(`${extensionOrigin}/`);
}

function syncInfo() {
  return {
    cookieCount: lastCookieNames.length,
    cookieNames: lastCookieNames,
    hasClearance: lastCookieNames.includes('cf_clearance'),
    hostAccess,
    webRequestInstalled,
    dnrCookieRuleInstalled,
    dnrOriginRuleInstalled,
    injected: lastInjected,
    error: lastError,
  };
}

async function checkHostAccess(api) {
  if (!api?.permissions?.contains) {
    hostAccess = null;
    return;
  }

  try {
    hostAccess = await api.permissions.contains({ origins: articOrigins });
  }
  catch (error) {
    hostAccess = null;
    lastError = `permission check: ${String(error)}`;
  }
}

async function queryCookies(api, details) {
  try {
    return await api.cookies.getAll(details);
  }
  catch {
    // Query fields vary between Chrome and Firefox; unsupported fallbacks are
    // expected and another query below will cover that browser.
    return [];
  }
}

async function getArticCookies(api) {
  const found = [];
  const queries = [
    { domain: articDomain, partitionKey: {} },
    { domain: articDomain },
    { domain: articDomain, firstPartyDomain: null, partitionKey: {} },
    { domain: articDomain, firstPartyDomain: null },
    { domain: articDomain, firstPartyDomain: articDomain, partitionKey: {} },
    { domain: articDomain, firstPartyDomain: articDomain },
    { name: 'cf_clearance', partitionKey: {} },
    { name: 'cf_clearance' },
    { name: '__cf_bm', partitionKey: {} },
    { name: '__cf_bm' },
  ];

  // Omitting storeId intentionally limits this to the background context's
  // cookie store instead of crossing Firefox container/private boundaries.
  for (const query of queries) {
    found.push(...await queryCookies(api, query));
  }

  const unique = new Map();
  for (const cookie of found) {
    if (!isArticDomain(cookie.domain)) {
      continue;
    }
    const partition = cookie.partitionKey?.topLevelSite || '';
    const key = `${cookie.name}\0${cookie.domain}\0${cookie.path}\0${cookie.firstPartyDomain || ''}\0${partition}`;
    const current = unique.get(key);
    if (!current || (cookie.expirationDate || 0) >= (current.expirationDate || 0)) {
      unique.set(key, cookie);
    }
  }

  return [...unique.values()];
}

function toCookieHeader(cookies) {
  function contextScore(cookie) {
    const partition = cookie.partitionKey?.topLevelSite || '';
    if (partition === 'https://www.artic.edu' || partition === 'https://artic.edu') {
      return 3;
    }
    if (cookie.firstPartyDomain === articDomain || cookie.firstPartyDomain === 'www.artic.edu') {
      return 3;
    }
    if (!partition && !cookie.firstPartyDomain) {
      return 2;
    }
    return 0;
  }

  const byName = new Map();
  for (const cookie of cookies) {
    if (!cloudflareCookieNames.has(cookie.name) || !cookieAppliesToIIIF(cookie)) {
      continue;
    }
    const current = byName.get(cookie.name);
    const preferredContext = !current || contextScore(cookie) > contextScore(current);
    const sameContextNewer = current
      && contextScore(cookie) === contextScore(current)
      && (cookie.expirationDate || 0) >= (current.expirationDate || 0);
    if (preferredContext || sameContextNewer) {
      byName.set(cookie.name, cookie);
    }
  }

  lastCookieNames = [...byName.keys()];
  return [...byName.values()]
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function looksLikeImage(bytes, contentType) {
  if (contentType.startsWith('image/')) {
    return true;
  }
  return bytes[0] === 0xff || bytes[0] === 0x89 || bytes[0] === 0x47 || bytes[0] === 0x52;
}

function rewriteArticHeaders(details, api) {
  if (!isExtensionInitiated(details, api)) {
    return {};
  }

  lastInjected = true;
  const drop = new Set(['origin', 'cookie', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']);
  const headers = (details.requestHeaders || []).filter(function(header) {
    return !drop.has(header.name.toLowerCase());
  });
  headers.push({ name: 'Referer', value: 'https://www.artic.edu/' });
  if (cachedCookieHeader) {
    headers.push({ name: 'Cookie', value: cachedCookieHeader });
  }
  return { requestHeaders: headers };
}

async function updateNetRequestRules(api, cookieHeader) {
  if (isFirefoxBrowser()) {
    return true;
  }
  if (!api.declarativeNetRequest) {
    return false;
  }

  const resourceTypes = ['image', 'xmlhttprequest', 'other', 'media', 'main_frame'];
  const requestScope = {
    initiatorDomains: [api.runtime.id],
    resourceTypes,
    urlFilter: '|https://www.artic.edu/iiif/2/',
  };
  const errors = [];
  const cookieOptions = {
    removeRuleIds: [cloudflareCookieRuleId],
    addRules: cookieHeader
      ? [{
        id: cloudflareCookieRuleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'cookie',
            operation: 'set',
            value: cookieHeader,
          }],
        },
        condition: requestScope,
      }]
      : [],
  };

  try {
    if (api.declarativeNetRequest.updateSessionRules) {
      await api.declarativeNetRequest.updateSessionRules(cookieOptions);
    }
    else {
      await api.declarativeNetRequest.updateDynamicRules(cookieOptions);
    }
    dnrCookieRuleInstalled = Boolean(cookieHeader);
  }
  catch (error) {
    dnrCookieRuleInstalled = false;
    errors.push(`DNR Cookie rule: ${String(error)}`);
  }

  const originOptions = {
    removeRuleIds: [cloudflareOriginRuleId],
    addRules: [{
      id: cloudflareOriginRuleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{
          header: 'origin',
          operation: 'remove',
        }],
      },
      condition: requestScope,
    }],
  };

  try {
    if (api.declarativeNetRequest.updateSessionRules) {
      await api.declarativeNetRequest.updateSessionRules(originOptions);
    }
    else {
      await api.declarativeNetRequest.updateDynamicRules(originOptions);
    }
    dnrOriginRuleInstalled = true;
  }
  catch (error) {
    dnrOriginRuleInstalled = false;
    errors.push(`DNR Origin rule: ${String(error)}`);
  }

  try {
    const rules = api.declarativeNetRequest.getSessionRules
      ? await api.declarativeNetRequest.getSessionRules()
      : await api.declarativeNetRequest.getDynamicRules();
    dnrCookieRuleInstalled = rules.some(rule => rule.id === cloudflareCookieRuleId);
    dnrOriginRuleInstalled = rules.some(rule => rule.id === cloudflareOriginRuleId);
  }
  catch (error) {
    errors.push(`DNR verification: ${String(error)}`);
  }

  if (errors.length > 0) {
    lastError = errors.join('; ');
  }

  return dnrOriginRuleInstalled && (!cookieHeader || dnrCookieRuleInstalled);
}

function installWebRequestListener(api) {
  if (!isFirefoxBrowser()) {
    return;
  }

  const webRequest = api?.webRequest
    || (typeof browser !== 'undefined' && browser.webRequest)
    || null;

  if (webRequestInstalled || !webRequest?.onBeforeSendHeaders) {
    return;
  }

  try {
    webRequest.onBeforeSendHeaders.addListener(
      details => rewriteArticHeaders(details, api),
      { urls: ['https://www.artic.edu/iiif/2/*'] },
      ['blocking', 'requestHeaders'],
    );
    webRequestInstalled = true;
  }
  catch (error) {
    lastError = `webRequest listener: ${String(error)}`;
    // Chrome MV3 rejects blocking webRequest listeners.
  }
}

async function performCloudflareSync(force) {
  const api = getExtensionApi();
  lastError = null;
  await checkHostAccess(api);
  installWebRequestListener(api);
  if (!api) {
    return syncInfo();
  }

  if (!force && hostAccess && Date.now() - lastSyncAt < cookieSyncMaxAgeMs) {
    return syncInfo();
  }

  const cookies = await getArticCookies(api);
  cachedCookieHeader = toCookieHeader(cookies);
  if (cachedCookieHeader !== lastConfiguredCookieHeader) {
    const configured = await updateNetRequestRules(api, cachedCookieHeader);
    if (configured) {
      lastConfiguredCookieHeader = cachedCookieHeader;
    }
  }
  lastSyncAt = Date.now();
  return syncInfo();
}

function syncCloudflareClearance(force = false) {
  if (!force && syncPromise) {
    return syncPromise;
  }

  const currentSync = syncQueue
    .catch(() => undefined)
    .then(() => performCloudflareSync(force));
  syncQueue = currentSync;
  syncPromise = currentSync;

  const clearCurrentSync = () => {
    if (syncPromise === currentSync) {
      syncPromise = null;
    }
  };
  currentSync.then(clearCurrentSync, clearCurrentSync);

  return currentSync;
}

async function fetchArticImage(url) {
  if (!isAllowedIIIFUrl(url)) {
    return {
      ok: false,
      ...syncInfo(),
      error: 'Rejected non-IIIF image URL',
    };
  }

  lastInjected = false;
  await syncCloudflareClearance();

  try {
    const response = await fetch(url, {
      credentials: 'include',
      // Reuse successful IIIF responses across new tabs and preloads. HTTP
      // cache directives still prevent Cloudflare challenge pages from being
      // retained when they are marked no-store.
      cache: 'default',
      redirect: 'follow',
    });
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const cfMitigated = (response.headers.get('cf-mitigated') || '').toLowerCase();
    const html = contentType.includes('text/html') || bytes[0] === 0x3c;
    const info = {
      ...syncInfo(),
      status: response.status,
      contentType,
      cloudflareChallenge: cfMitigated.includes('challenge')
        || (response.status === 403 && html),
    };

    console.info('[aic-art-tab] image fetch', { url, ...info });

    if (!response.ok || html || !looksLikeImage(bytes, contentType)) {
      return { ok: false, ...info };
    }

    return { ok: true, ...info };
  }
  catch (error) {
    lastError = `image fetch: ${String(error)}`;
    const info = syncInfo();
    console.warn('[aic-art-tab] image fetch failed', { url, ...info });
    return { ok: false, ...info };
  }
}

function watchCloudflareClearance() {
  const api = getExtensionApi();
  installWebRequestListener(api);
  if (!api || watchingCloudflareCookies) {
    return;
  }

  watchingCloudflareCookies = true;
  api.cookies.onChanged.addListener((changeInfo) => {
    if (!isArticDomain(changeInfo?.cookie?.domain)) {
      return;
    }
    syncCloudflareClearance(true);
  });
}

globalThis.fetchArticImage = fetchArticImage;
globalThis.syncCloudflareClearance = syncCloudflareClearance;
globalThis.watchCloudflareClearance = watchCloudflareClearance;
