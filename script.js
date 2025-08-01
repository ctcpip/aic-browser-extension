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
  let viewer;

  document.addEventListener('DOMContentLoaded', function() {
    tombstoneElement = document.getElementById('tombstone');
    titleElement = document.getElementById('title');
    artistElement = document.getElementById('artist');
    artworkContainer = document.getElementById('artwork-container');

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

    loadNewArtwork(false);

    const reloadLink = document.getElementById('reload-link');
    reloadLink.addEventListener('click', handleReload);
    reloadLink.addEventListener('keypress', handleReload);
  });

  function handleReload(e) {
    // handle keyboard interaction
    if (e.type === 'click' || (e.type === 'keypress' && (e.key === 'Enter' || e.key === ' '))) {
      e.preventDefault();
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

  function updatePage(artwork) {
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

    // Work-around for saving canvas images with white borders
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

    viewer.removeAllHandlers('tile-load-failed');

    viewer.addHandler('tile-load-failed', function(/* e */) {
      // console.debug(e);

      // if load failed, it's probably due to 403 Forbidden: Requests for scales in excess of 100% are not allowed.
      // so remove the largest scale level and try again
      levels.pop();
      addTiledImage(artwork, isPreload, levels);
    });

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
              addTiledImage(nextArtwork, true);
            }
          }
        });
      },
      error: function(event) {
        console.error(event);
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
