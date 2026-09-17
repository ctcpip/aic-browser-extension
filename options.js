import {
  artworkCacheKeys,
  filterFields,
  getJsonData,
  getSettings,
  noDepartmentTerm,
  saveSettings,
  settingsRevisionKey,
} from './lib.js';

const contemporaryArt = 'Contemporary Art';
const preloadClaimsLock = 'aic-art-tab-preload-claims';

const baseQuery = {
  resources: 'artworks',
  size: 0,
  aggregations: {},
};

const departmentQuery = Object.assign({}, baseQuery);
departmentQuery.aggregations = { departments: { terms: { field: filterFields.department } } };

const settings = getSettings();

document.querySelector('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;

const selectDaily = document.querySelector('#daily');
selectDaily.value = settings.dailyMode;

selectDaily.addEventListener('change', (e) => {
  settings.dailyMode = e.target.value === 'true';
  save();
});

const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
const lastFetchedMoreThanAWeekAgo = (Date.now() - settings.departmentOptions.lastFetched) > oneWeekMs;

if (settings.departmentOptions.options.length === 0 || lastFetchedMoreThanAWeekAgo) {
  const departmentData = await getJsonData(departmentQuery);
  const departmentOptions = departmentData.aggregations.departments.buckets
    .map((b) => b.key)
    .filter(o => o !== contemporaryArt) // for some reason, filtering on contemporary art yields zero results, despite there being many artworks with that department
    .sort();
  departmentOptions.push(noDepartmentTerm);
  settings.departmentOptions.options = departmentOptions;
  settings.departmentOptions.lastFetched = Date.now();
  save();
}

const divDepartments = document.getElementById('departments');

for (const o of settings.departmentOptions.options) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  label.className = 'checkbox';
  input.type = 'checkbox';
  input.value = o;
  label.append(input, document.createTextNode(o));
  divDepartments.append(label);
}

async function updateDepartment() {
  settings.departmentOptions.selected = Array.from(divDepartments.querySelectorAll('input:checked')).map(
    (i) => i.value,
  );
  save();
  // clear cached artwork data so that preferences are respected immediately
  await navigator.locks.request(preloadClaimsLock, function() {
    localStorage.setItem(settingsRevisionKey, crypto.randomUUID());
    Object.values(artworkCacheKeys).forEach(k => localStorage.removeItem(k));
    const preloadClaimPrefix = `${artworkCacheKeys.preloadingImagesKey}:claim:`;
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(preloadClaimPrefix)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem(`${artworkCacheKeys.preloadingImagesKey}:claims`);
  });
}

if (settings.departmentOptions.selected.length === 0) {
  divDepartments.querySelectorAll('input').forEach((i) => (i.checked = true));
}
else {
  settings.departmentOptions.selected.forEach((o) => {
    const option = [...divDepartments.querySelectorAll('input')].find(input => input.value === o);
    // guard against options disappearing or being renamed
    if (option) {
      option.checked = true;
    }
  });
}

divDepartments.querySelectorAll('input').forEach((i) => i.addEventListener('change', updateDepartment));

function save() {
  saveSettings();
}
