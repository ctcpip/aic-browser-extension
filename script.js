import {
  artworkCacheKeys,
  filterFields,
  getJson,
  getStoredSettings,
  noDepartmentTerm,
} from './lib.js';

(function() {
  const {
    savedResponseKey,
    preloadedImagesKey,
    preloadingImagesKey,
    lastLoadedDateKey,
  } = artworkCacheKeys;

  // Settings for cache aggressiveness
  const artworksToPrefetch = 50;
  const imagesToPreload = 7;

  const imagesToPreloadPerSession = 3;
  let imagesPreloadedThisSession = 0;

  let tombstoneElement;
  let titleElement;
  let artistElement;
  let artworkContainer;
  let imageErrorElement;
  let imageErrorTitleElement;
  let imageErrorBodyElement;
  let imageAccessButton;
  let viewer;
  let imageLoadGeneration = 0;
  let lastCookieSync = null;
  let cloudflareReady = Promise.resolve();
  let diagnosisGeneration = null;
  let diagnosticRetryGeneration = null;
  const tileFailureHandlers = new Set();
  const preloadsStartedThisPage = new Set();

  document.addEventListener('DOMContentLoaded', function() {
    tombstoneElement = document.getElementById('tombstone');
    titleElement = document.getElementById('title');
    artistElement = document.getElementById('artist');
    artworkContainer = document.getElementById('artwork-container');
    imageErrorElement = document.getElementById('image-error');
    imageErrorTitleElement = document.getElementById('image-error-title');
    imageErrorBodyElement = document.getElementById('image-error-body');
    imageAccessButton = document.getElementById('image-access-button');
    imageAccessButton.addEventListener('click', handleImageAccessClick);

    viewer = OpenSeadragon({  // eslint-disable-line no-undef
      element: artworkContainer,
      xmlns: 'http://schemas.microsoft.com/deepzoom/2008',
      prefixUrl: '//openseadragon.github.io/openseadragon/images/',
      homeFillsViewer: false,
      mouseNavEnabled: false,
      springStiffness: 15,
      visibilityRatio: 1,
      zoomPerScroll: 1.2,
      zoomPerClick: 1.3,
      immediateRender: true,
      constrainDuringPan: true,
      animationTime: 1.5,
      minZoomLevel: 0,
      minZoomImageRatio: 0.8,
      maxZoomPixelRatio: 1.0,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { scrollToZoom: true },
      showZoomControl: false,
      showHomeControl: false,
      showFullPageControl: false,
      showRotationControl: false,
      showSequenceControl: false,
    });

    cloudflareReady = syncCloudflareCookies();
    loadNewArtwork(false);

    const reloadLink = document.getElementById('reload-link');
    reloadLink.addEventListener('click', handleReload);
    reloadLink.addEventListener('keypress', handleReload);
  });

  async function ensureArticHostAccess() {
    const extensionApi = typeof browser !== 'undefined' ? browser : chrome;
    if (!extensionApi?.permissions?.request) {
      return true;
    }

    const origins = ['https://www.artic.edu/*', 'https://artic.edu/*'];
    try {
      const granted = await extensionApi.permissions.request({ origins });
      if (!granted) {
        throw new Error('The browser denied the artic.edu site-access request');
      }
      return true;
    }
    catch (error) {
      console.warn('[aic-art-tab] site access request failed', error);
      return {
        granted: false,
        error: String(error),
      };
    }
  }

  async function handleImageAccessClick(e) {
    e.preventDefault();
    e.stopPropagation();
    imageAccessButton.disabled = true;

    const permission = await ensureArticHostAccess();
    if (permission !== true) {
      imageAccessButton.disabled = false;
      showImageError('permission', {
        hostAccess: false,
        error: permission.error,
      });
      return;
    }

    cloudflareReady = syncCloudflareCookies(true);
    await cloudflareReady;
    loadNewArtwork(false);
  }

  async function sendBackgroundMessage(message) {
    const runtime = typeof browser !== 'undefined' ? browser : chrome;
    if (!runtime?.runtime?.sendMessage) {
      return null;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await runtime.runtime.sendMessage(message);
        if (result !== undefined) {
          return result;
        }
      }
      catch (error) {
        lastError = error;
      }
      await new Promise(function(resolve) {
        setTimeout(resolve, 150 * (attempt + 1));
      });
    }

    console.warn('[aic-art-tab] background message failed', lastError);
    return null;
  }

  async function syncCloudflareCookies(force = false) {
    lastCookieSync = await sendBackgroundMessage({ type: 'syncCloudflareCookies', force });
    return lastCookieSync;
  }

  async function diagnoseImageFailure(artwork, url, generation) {
    if (diagnosisGeneration === generation) {
      return;
    }
    diagnosisGeneration = generation;
    const details = await sendBackgroundMessage({ type: 'fetchArticImage', url });
    if (diagnosisGeneration === generation) {
      diagnosisGeneration = null;
    }
    if (generation !== imageLoadGeneration) {
      return;
    }
    lastCookieSync = details || lastCookieSync;
    if (details?.ok && diagnosticRetryGeneration !== generation) {
      diagnosticRetryGeneration = generation;
      hideImageError();
      addTiledImage(artwork, false);
      return;
    }
    showImageFailure(lastCookieSync);
  }

  function handleImageFailure(artwork, url, generation) {
    if (diagnosticRetryGeneration === generation) {
      showImageError('generic', {
        ...lastCookieSync,
        error: 'Image display failed after a successful diagnostic fetch',
      });
      return;
    }
    diagnoseImageFailure(artwork, url, generation);
  }

  function releasePreload(imageId) {
    if (!preloadsStartedThisPage.delete(imageId)) {
      return;
    }

    const preloadingImages = JSON.parse(localStorage.getItem(preloadingImagesKey)) || [];
    localStorage.setItem(
      preloadingImagesKey,
      JSON.stringify(preloadingImages.filter(item => item !== imageId)),
    );
  }

  function releasePagePreloads() {
    [...preloadsStartedThisPage].forEach(releasePreload);
  }

  async function handleReload(e) {
    // handle keyboard interaction
    if (e.type === 'click' || (e.type === 'keypress' && (e.key === 'Enter' || e.key === ' '))) {
      e.preventDefault();
      cloudflareReady = syncCloudflareCookies(true);
      await cloudflareReady;
      loadNewArtwork(true);
    }
  }

  function loadNewArtwork(forceNew) {
    // https://developer.mozilla.org/en-US/docs/Web/API/Storage/getItem
    // ...returns `null` if not found. JSON.parsing `null` also returns `null`
    const savedResponse = JSON.parse(localStorage.getItem(savedResponseKey));

    if (savedResponse !== null) {
      if (savedResponse.data.length > 0) {
        return processResponse(savedResponse, forceNew);
      }
    }

    getJson(getQuery(), processResponse, forceNew);
  }

  /**
     * Remove one artwork from the response and save it to LocalStorage.
     */
  function processResponse(response, forceNew) {
    let artwork = response.data[0];

    const dateNow = new Date().toLocaleDateString();
    const lastLoaded = localStorage.getItem(lastLoadedDateKey);

    if (!getStoredSettings().dailyMode || forceNew || lastLoaded !== dateNow) {
      if (response.data.length === 1) {
        // we were already displaying the last artwork in our data, so we need to get new data
        response.data = [];
        localStorage.setItem(savedResponseKey, JSON.stringify(response));
        loadNewArtwork(forceNew);
        return;
      }
      localStorage.setItem(lastLoadedDateKey, new Date().toLocaleDateString());
      response.data = response.data.slice(1);
      artwork = response.data[0];
    }
    else {
      // artwork was loaded on today's date, don't load a new one
    }

    localStorage.setItem(savedResponseKey, JSON.stringify(response));

    // Remove any artwork not in left-over response from preloaded trackers
    const imageIdsInResponse = response.data.map(function(item) {
      return item.image_id;
    });

    let preloadedImages = JSON.parse(localStorage.getItem(preloadedImagesKey)) || [];
    let preloadingImages = JSON.parse(localStorage.getItem(preloadingImagesKey)) || [];

    preloadedImages = preloadedImages.filter(function(item) {
      return imageIdsInResponse.includes(item);
    });

    preloadingImages = preloadingImages.filter(function(item) {
      return imageIdsInResponse.includes(item);
    });

    localStorage.setItem(preloadingImagesKey, JSON.stringify(preloadingImages));
    localStorage.setItem(preloadedImagesKey, JSON.stringify(preloadedImages));

    updatePage(artwork);
  }

  function hideImageError() {
    if (imageErrorElement) {
      imageErrorElement.hidden = true;
    }
  }

  function showImageError(kind, details) {
    if (!imageErrorElement) {
      return;
    }

    console.warn('[aic-art-tab] image error', { kind, ...details });
    imageAccessButton.hidden = details?.hostAccess !== false;
    imageAccessButton.disabled = false;

    if (kind === 'permission') {
      imageErrorTitleElement.textContent = 'Image access is required';
      imageErrorBodyElement.textContent = 'Allow access to images on artic.edu, then try again.';
    }
    else if (kind === 'cloudflare-no-cookie') {
      imageErrorTitleElement.textContent = 'Image blocked by Cloudflare';
      imageErrorBodyElement.textContent = 'Complete the Cloudflare check in a regular tab on artic.edu, then reload this page.';
    }
    else if (kind === 'cloudflare') {
      imageErrorTitleElement.textContent = 'Image blocked by Cloudflare';
      imageErrorBodyElement.textContent = details?.hasClearance
        ? 'The image server still returned a security challenge. Try visiting artic.edu again, then reload this tab.'
        : 'The museum’s image server returned a security challenge instead of the artwork. Try loading a new piece, or open this work on artic.edu.';
    }
    else {
      imageErrorTitleElement.textContent = 'Image couldn\'t be loaded';
      imageErrorBodyElement.textContent = 'Something went wrong while fetching this artwork. Try loading a new piece, or open this work on artic.edu.';
    }

    imageErrorElement.hidden = false;
  }

  function showImageFailure(details) {
    if (details?.hostAccess === false) {
      showImageError('permission', details);
    }
    else if (details?.cloudflareChallenge) {
      showImageError(details.hasClearance ? 'cloudflare' : 'cloudflare-no-cookie', details);
    }
    else {
      showImageError('generic', details);
    }
  }

  async function updatePage(artwork) {
    releasePagePreloads();
    imageLoadGeneration += 1;
    const generation = imageLoadGeneration;
    tileFailureHandlers.forEach(function(handler) {
      viewer.removeHandler('tile-load-failed', handler);
    });
    tileFailureHandlers.clear();
    hideImageError();

    const artistPrint = [artwork?.artist_title, artwork?.date_display]
      .filter(function(el) {
        return el !== null;
      })
      .join(', ');

    const titlePrint = artwork.title ? artwork.title : '';

    const linkToArtwork = `https://www.artic.edu/artworks/${artwork.id}/${slugify(titlePrint)}`;

    artistElement.textContent = artistPrint;
    titleElement.textContent = titlePrint;
    tombstoneElement.setAttribute('href', linkToArtwork);

    const downloadUrl = `https://www.artic.edu/iiif/2/${artwork.image_id}/full/3000,/0/default.jpg`;

    document.getElementById('download-link').setAttribute('href', downloadUrl);

    document.getElementById('download-link').setAttribute('download', `${titlePrint}.jpg`);

    document.getElementById('artwork-url').setAttribute('href', linkToArtwork);

    await cloudflareReady;
    if (generation !== imageLoadGeneration) {
      return;
    }

    document
      .getElementById('artwork-save-overlay')
      .setAttribute('src', `https://www.artic.edu/iiif/2/${artwork.image_id}/full/843,/0/default.jpg`);
    addTiledImage(artwork, false);
  }

  /**
     * Work-around to encourage cache collision.
     *
     * https://openseadragon.github.io/examples/tilesource-legacy/
     */
  function getIIIFLevel(artwork, displayWidth) {
    return {
      url: `https://www.artic.edu/iiif/2/${artwork.image_id}/full/${displayWidth},/0/default.jpg`,
      width: displayWidth,
      height: Math.floor((artwork.thumbnail.height * displayWidth) / artwork.thumbnail.width),
    };
  }

  function addTiledImage(artwork, isPreload, levels) {
    // Save this so we can add it to our preload log
    const currentImageId = artwork.image_id;
    const generation = imageLoadGeneration;

    if (!isPreload) {
      // clear out any previous
      viewer.world.removeAll();
    }

    levels = levels || [
      getIIIFLevel(artwork, 200),
      getIIIFLevel(artwork, 400),
      getIIIFLevel(artwork, 843),
      getIIIFLevel(artwork, 1686),
    ];

    if (generation !== imageLoadGeneration) {
      if (isPreload) {
        releasePreload(currentImageId);
      }
      return;
    }

    const levelUrls = new Set(levels.map(level => level.url));
    const tileFailureHandler = function(event) {
      if (generation !== imageLoadGeneration) {
        viewer.removeHandler('tile-load-failed', tileFailureHandler);
        tileFailureHandlers.delete(tileFailureHandler);
        event?.tiledImage?.destroy();
        if (isPreload) {
          releasePreload(currentImageId);
        }
        return;
      }
      if (event?.tile?.url && !levelUrls.has(event.tile.url)) {
        return;
      }

      viewer.removeHandler('tile-load-failed', tileFailureHandler);
      tileFailureHandlers.delete(tileFailureHandler);
      event?.tiledImage?.destroy();
      if (levels.length > 1) {
        addTiledImage(artwork, isPreload, levels.slice(0, -1));
      }
      else if (isPreload) {
        releasePreload(currentImageId);
      }
      else {
        handleImageFailure(artwork, levels[0].url, generation);
      }
    };
    viewer.addHandler('tile-load-failed', tileFailureHandler);
    tileFailureHandlers.add(tileFailureHandler);

    // https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html#addTiledImage
    viewer.addTiledImage({
      tileSource: {
        type: 'legacy-image-pyramid',
        levels,
      },
      opacity: isPreload ? 0 : 1,
      preload: isPreload ? true : false,
      success: function(event) {
        // https://openseadragon.github.io/docs/OpenSeadragon.TiledImage.html#.event:fully-loaded-change
        event.item.addHandler('fully-loaded-change', function(callbackObject) {
          const tiledImage = callbackObject.eventSource;

          // We don't want this to fire on every zoom and pan
          tiledImage.removeAllHandlers('fully-loaded-change');
          viewer.removeHandler('tile-load-failed', tileFailureHandler);
          tileFailureHandlers.delete(tileFailureHandler);

          if (generation !== imageLoadGeneration) {
            tiledImage.destroy();
            if (isPreload) {
              releasePreload(currentImageId);
            }
            return;
          }

          if (!isPreload) {
            hideImageError();
          }

          // We want to check LocalStorage each time in case multiple new tabs are preloading
          const preloadedImages = JSON.parse(localStorage.getItem(preloadedImagesKey)) || [];
          let preloadingImages = JSON.parse(localStorage.getItem(preloadingImagesKey)) || [];

          // Be sure to exclude the current image from preloading!
          const excludedImages = preloadedImages.concat(preloadingImages, [currentImageId]);

          if (isPreload) {
            if (!preloadedImages.includes(currentImageId)) {
              preloadedImages.push(currentImageId);
            }

            preloadingImages = preloadingImages.filter(function(item) {
              return item !== currentImageId;
            });

            localStorage.setItem(preloadingImagesKey, JSON.stringify(preloadingImages));
            localStorage.setItem(preloadedImagesKey, JSON.stringify(preloadedImages));
            preloadsStartedThisPage.delete(currentImageId);

            tiledImage.destroy(); // don't load more tiles during zoom and pan

            imagesPreloadedThisSession++;
          }

          // Exit early if we have enough images preloaded
          if (
            excludedImages.length > imagesToPreload ||
            imagesPreloadedThisSession >= imagesToPreloadPerSession
          ) {
            return;
          }

          // We want the freshest data to determine what to cache next
          const savedResponse = JSON.parse(localStorage.getItem(savedResponseKey));

          // TODO: Preload next API response here if there's too few items remaining?
          if (savedResponse !== null && savedResponse.data.length > 0) {
            const nextArtwork = savedResponse.data.find(function(item) {
              return !excludedImages.includes(item.image_id);
            });

            if (nextArtwork) {
              preloadingImages.push(nextArtwork.image_id);
              localStorage.setItem(preloadingImagesKey, JSON.stringify(preloadingImages));
              preloadsStartedThisPage.add(nextArtwork.image_id);
              addTiledImage(nextArtwork, true);
            }
          }
        });
      },
      error: function(event) {
        viewer.removeHandler('tile-load-failed', tileFailureHandler);
        tileFailureHandlers.delete(tileFailureHandler);
        console.error(event);
        if (isPreload) {
          releasePreload(currentImageId);
        }
        else if (generation === imageLoadGeneration) {
          handleImageFailure(artwork, levels[0].url, generation);
        }
      },
    });
  }

  function getQuery() {
    const query = {
      resources: 'artworks',
      fields: [
        'id',
        'title',
        'artist_title',
        'image_id',
        'date_display',
        'thumbnail',
        'department_title',
      ],
      boost: false,
      limit: artworksToPrefetch,
      query: {
        function_score: {
          query: {
            bool: {
              filter: [
                { term: { is_public_domain: true } },
                { exists: { field: 'image_id' } },
                { exists: { field: 'thumbnail.width' } },
                { exists: { field: 'thumbnail.height' } },
              ],
            },
          },
          boost_mode: 'replace',
          random_score: {
            field: 'id',
            seed: getSeed(),
          },
        },
      },
    };

    getSpecificArtWork(query);

    const settings = getStoredSettings();

    if (settings.departmentOptions.selected.length > 0) {
      const filter = { bool: { should: [] } };
      settings.departmentOptions.selected.forEach((o) => {
        if (o === noDepartmentTerm) {
          filter.bool.should.push({ bool: { must_not: [{ exists: { field: 'department_title.keyword' } }] } });
        }
        else {
          const term = { term: {} };
          term.term[filterFields.department] = o;
          filter.bool.should.push(term);
        }
      });
      query.query.function_score.query.bool.filter.push(filter);
    }

    return query;
  }

  /**
     * Using millisecond for seed lowers chance of collision. Since we prefetch
     * API results and images, we don't depend on serverside collision.
     */
  function getSeed() {
    return Date.now();
  }

  /**
     * Use this for artwork slugs to prevent a redirect.
     * @link https://gist.github.com/mathewbyrne/1280286
     */
  function slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .replace(/\s+/g, '-') // Replace spaces with -
      .replace(/[^\w-]+/g, '') // Remove all non-word chars
      .replace(/--+/g, '-') // Replace multiple - with single -
      .replace(/^-+/, '') // Trim - from start of text
      .replace(/-+$/, ''); // Trim - from end of text
  }
})();

function getSpecificArtWork(query) {
  // used for taking screenshots featuring specific art
  // must not be committed without the early `return`

  return;

  query.query = { // eslint-disable-line no-unreachable
    bool: {
      must: [
        { match: { title: 'La Grande Jatte' } },
        { match: { artist_title: 'Seurat' } },
      ],
      filter: [
        { term: { is_public_domain: true } },
        { exists: { field: 'image_id' } },
        { exists: { field: 'thumbnail.width' } },
        { exists: { field: 'thumbnail.height' } },
      ],
    },
  };
}
