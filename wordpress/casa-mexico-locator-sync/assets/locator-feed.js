(function () {
  'use strict';

  var DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbz8pQv5oekeeTT35zyE22mPqczBBeWI6facsR9vs62jUCzv-kC4eiDxKyYf43nvx9Faew/exec';

  if (!window.CMX_LOCATOR) {
    window.CMX_LOCATOR = {};
  }

  function isNovember2026Sheet(tabName) {
    if (!tabName) return false;
    var t = String(tabName).toLowerCase();
    return t.indexOf('november') !== -1 && t.indexOf('2026') !== -1;
  }

  function parseAndEmit(payload) {
    if (!payload || !Array.isArray(payload.locations)) {
      throw new Error('Locator feed has an invalid shape.');
    }
    // November 2026 filter: only keep locations from sheets containing "November" AND "2026"
    payload.locations = payload.locations.filter(function(loc) {
      return isNovember2026Sheet(loc.tabName);
    });
    payload.count = payload.locations.length;
    window.CMX_LOCATOR.locations = payload.locations;
    window.dispatchEvent(new CustomEvent('cmx:locations-ready', { detail: payload }));
    return payload;
  }

  window.CMX_LOCATOR.load = function () {
    var fetchUrl = window.CMX_LOCATOR.url || '';
    if (fetchUrl && fetchUrl.indexOf('_t=') === -1) {
      fetchUrl += (fetchUrl.indexOf('?') === -1 ? '?' : '&') + '_t=' + new Date().getTime();
    }
    var fetchOptions = {
      credentials: 'same-origin',
      cache: 'no-cache',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    };

    var directUrl = window.CMX_LOCATOR.directEndpoint || DEFAULT_ENDPOINT;
    if (directUrl && directUrl.indexOf('nocache=') === -1) {
      directUrl += (directUrl.indexOf('?') === -1 ? '?' : '&') + 'nocache=1';
    }

    function fetchDirectFallback() {
      return fetch(directUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('Direct endpoint HTTP ' + res.status);
          return res.json();
        });
    }

    if (!fetchUrl) {
      return fetchDirectFallback().then(parseAndEmit);
    }

    return fetch(fetchUrl, fetchOptions)
      .then(function (response) {
        if (!response.ok) {
          if (window.CMX_LOCATOR.restUrl) {
            var restUrl = window.CMX_LOCATOR.restUrl;
            if (restUrl.indexOf('_t=') === -1) {
              restUrl += (restUrl.indexOf('?') === -1 ? '?' : '&') + '_t=' + new Date().getTime();
            }
            return fetch(restUrl, fetchOptions)
              .then(function (restResp) {
                if (!restResp.ok) return fetchDirectFallback();
                return restResp.json();
              })
              .catch(function () {
                return fetchDirectFallback();
              });
          }
          return fetchDirectFallback();
        }
        return response.json();
      })
      .then(parseAndEmit)
      .catch(function () {
        return fetchDirectFallback().then(parseAndEmit);
      });
  };

  window.CMX_LOCATOR.load().catch(function (error) {
    window.dispatchEvent(new CustomEvent('cmx:locations-error', { detail: error }));
    if (window.console) console.error('Casa Mexico locator:', error);
  });
}());
