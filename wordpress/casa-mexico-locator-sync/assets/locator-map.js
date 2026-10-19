(function () {
  'use strict';

  var map = null;
  var markersGroup = null;
  var allLocations = [];
  var locationMarkers = [];
  var currentViewMode = 'map'; // 'map', 'sales', or 'table'
  var currentPage = 1;
  var itemsPerPage = 25;
  var selectedTypeFilter = '';
  var userLocation = null;

  function initLocatorMap() {
    // Hide Astra / WP default theme page title header so title + view tabs flex side-by-side cleanly
    var wrap = document.querySelector('.cmx-locator-wrap');
    if (wrap) {
      var articleHeader = wrap.closest('article') ? wrap.closest('article').querySelector('.entry-header, header.entry-header') : null;
      var outerHeader = articleHeader || document.querySelector('.entry-header, header.entry-header');
      if (outerHeader) {
        outerHeader.style.display = 'none';
      }
    }

    var canvas = document.getElementById('cmx-map-canvas');
    if (canvas && window.L) {
      map = L.map('cmx-map-canvas', {
        zoomControl: true,
        scrollWheelZoom: true
      }).setView([39.8283, -98.5795], 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      markersGroup = L.featureGroup().addTo(map);
    }

    // Bind event listeners for search, filters, sort, and view toggles
    var searchInput = document.getElementById('cmx-search-input');
    var tabSelect = document.getElementById('cmx-tab-select');
    var stateSelect = document.getElementById('cmx-state-select');
    var typeSelect = document.getElementById('cmx-type-select');
    var sortSelect = document.getElementById('cmx-sort-select');
    var viewMapBtn = document.getElementById('cmx-view-map-btn');
    var viewSalesBtn = document.getElementById('cmx-view-sales-btn');
    var viewTableBtn = document.getElementById('cmx-view-table-btn');
    var useLocBtn = document.getElementById('cmx-use-location-btn');

    function resetAndRender() {
      currentPage = 1;
      renderMapAndSidebar();
    }

    if (searchInput) searchInput.addEventListener('input', resetAndRender);
    if (tabSelect) tabSelect.addEventListener('change', resetAndRender);
    if (stateSelect) stateSelect.addEventListener('change', resetAndRender);
    if (typeSelect) {
      typeSelect.addEventListener('change', function() {
        selectedTypeFilter = this.value;
        syncTypePills(this.value);
        resetAndRender();
      });
    }
    if (sortSelect) sortSelect.addEventListener('change', resetAndRender);

    // Bind Premise Type Pills (ALL, RETAIL, BAR & RESTAURANT)
    var typePills = document.querySelectorAll('.cmx-type-pill');
    typePills.forEach(function(pill) {
      pill.addEventListener('click', function() {
        typePills.forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        selectedTypeFilter = this.getAttribute('data-type') || '';
        if (typeSelect) typeSelect.value = selectedTypeFilter;
        resetAndRender();
      });
    });

    function syncTypePills(val) {
      typePills.forEach(function(p) {
        if ((p.getAttribute('data-type') || '') === (val || '')) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    }

    // Geolocation USE MY LOCATION handler
    if (useLocBtn) {
      useLocBtn.addEventListener('click', function() {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser.');
          return;
        }
        useLocBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> LOCATING...';
        navigator.geolocation.getCurrentPosition(function(pos) {
          useLocBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> USE MY LOCATION';
          userLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          };
          renderMapAndSidebar(true);
        }, function(err) {
          useLocBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> USE MY LOCATION';
          alert('Unable to retrieve your location. Please ensure location services are enabled.');
        }, { timeout: 10000 });
      });
    }

    if (viewMapBtn) {
      viewMapBtn.addEventListener('click', function () {
        currentViewMode = 'map';
        setActiveViewBtn(viewMapBtn);
        showViewContainer('cmx-split-view');
        if (map) setTimeout(function () { map.invalidateSize(); }, 100);
        renderMapAndSidebar();
      });
    }

    if (viewSalesBtn) {
      viewSalesBtn.addEventListener('click', function () {
        currentViewMode = 'sales';
        setActiveViewBtn(viewSalesBtn);
        showViewContainer('cmx-sales-view');
        renderMapAndSidebar();
      });
    }

    if (viewTableBtn) {
      viewTableBtn.addEventListener('click', function () {
        currentViewMode = 'table';
        setActiveViewBtn(viewTableBtn);
        showViewContainer('cmx-table-view');
        renderMapAndSidebar();
      });
    }

    function setActiveViewBtn(activeBtn) {
      [viewMapBtn, viewSalesBtn, viewTableBtn].forEach(function (btn) {
        if (btn) btn.classList.remove('cmx-active');
      });
      if (activeBtn) activeBtn.classList.add('cmx-active');
    }

    function showViewContainer(containerId) {
      ['cmx-split-view', 'cmx-sales-view', 'cmx-table-view'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = (id === containerId) ? (id === 'cmx-split-view' ? 'flex' : 'block') : 'none';
      });
    }

    // Load locations feed with bulletproof fallback
    var fallbackEndpoint = (window.CMX_LOCATOR && window.CMX_LOCATOR.directEndpoint) || 'https://script.google.com/macros/s/AKfycbz8pQv5oekeeTT35zyE22mPqczBBeWI6facsR9vs62jUCzv-kC4eiDxKyYf43nvx9Faew/exec';

    function tryDirectEndpoint() {
      if (allLocations && allLocations.length > 0) return;
      var directUrl = fallbackEndpoint + (fallbackEndpoint.indexOf('?') === -1 ? '?' : '&') + 'nocache=1';
      fetch(directUrl)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.locations && data.locations.length > 0) {
            setLocationsData(data.locations);
          }
        })
        .catch(function (err) {
          console.warn('Direct fallback load attempt:', err);
        });
    }

    if (window.CMX_LOCATOR && window.CMX_LOCATOR.locations && window.CMX_LOCATOR.locations.length > 0) {
      setLocationsData(window.CMX_LOCATOR.locations);
    } else if (window.CMX_LOCATOR && typeof window.CMX_LOCATOR.load === 'function') {
      window.CMX_LOCATOR.load().then(function (payload) {
        if (payload && payload.locations) setLocationsData(payload.locations);
      }).catch(function (err) {
        console.warn('Casa Mexico map feed error, trying direct endpoint:', err);
        tryDirectEndpoint();
      });
    } else {
      tryDirectEndpoint();
    }

    // Safety timeout to ensure data is never stuck on "Loading..."
    setTimeout(function () {
      if (!allLocations || allLocations.length === 0) {
        tryDirectEndpoint();
      }
    }, 1500);

    window.addEventListener('cmx:locations-ready', function (e) {
      if (e.detail && e.detail.locations) {
        setLocationsData(e.detail.locations);
      }
    });

    function triggerMapResize() {
      if (map && currentViewMode === 'map') {
        map.invalidateSize();
      }
    }

    [100, 300, 600, 1000, 2000].forEach(function (ms) {
      setTimeout(triggerMapResize, ms);
    });

    window.addEventListener('load', triggerMapResize);
    window.addEventListener('resize', triggerMapResize);
    window.addEventListener('orientationchange', triggerMapResize);
  }

  function getDistanceMiles(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function getTabName(loc) {
    if (loc.tabName) return loc.tabName;
    if (loc.territory) {
      var terr = String(loc.territory).toUpperCase();
      if (terr.indexOf('NY') !== -1 || terr.indexOf('NJ') !== -1) return 'July 2026 NY-NJ';
      if (terr.indexOf('FL') !== -1) return 'Depletions FL';
      if (terr.indexOf('TX') !== -1) return 'Depletions TX July 2026';
      if (terr.indexOf('KY') !== -1) return 'Casa Mexico Rolling 12 KY';
      if (terr.indexOf('MA') !== -1 || terr.indexOf('RI') !== -1) return 'MA-RI Summary';
      if (terr.indexOf('AZ') !== -1) return 'AZ Accounts';
      if (terr.indexOf('CA') !== -1) return 'CA Accounts';
      if (terr.indexOf('IL') !== -1) return 'IL Espiritus';
      return loc.territory + ' Tab';
    }
    if (loc.id && loc.id.indexOf('CMT-') === 0) {
      var match = loc.id.match(/^CMT-([A-Za-z0-9]+)-/);
      if (match && match[1]) return match[1] + ' Tab';
    }
    return 'Store Locator';
  }

  function isNovember2026Sheet(tabName) {
    if (!tabName) return false;
    var t = String(tabName).toLowerCase();
    return t.indexOf('november') !== -1 && t.indexOf('2026') !== -1;
  }

  function setLocationsData(locations) {
    if (!Array.isArray(locations)) return;

    // November 2026 filter: only display locations from sheets containing "November" AND "2026"
    locations = locations.filter(function(loc) {
      return isNovember2026Sheet(loc.tabName);
    });

    // Attach resolved tab names
    locations.forEach(function (loc) {
      loc._cleanTabName = getTabName(loc);
    });

    allLocations = locations;
    populateTabSelect(locations);
    populateStateSelect(locations);
    renderMapAndSidebar();
  }

  function populateTabSelect(locations) {
    var tabSelect = document.getElementById('cmx-tab-select');
    if (!tabSelect) return;

    var currentVal = tabSelect.value;
    var tabsMap = {};

    locations.forEach(function (loc) {
      var tName = loc._cleanTabName || getTabName(loc);
      tabsMap[tName] = (tabsMap[tName] || 0) + 1;
    });

    var tabs = Object.keys(tabsMap).sort();
    var html = '<option value="">All Sheet Tabs (' + tabs.length + ' Tabs • ' + locations.length + ' Stores)</option>';
    tabs.forEach(function (t) {
      html += '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + ' (' + tabsMap[t] + ')</option>';
    });
    tabSelect.innerHTML = html;
    if (currentVal && tabsMap[currentVal]) tabSelect.value = currentVal;
  }

  var US_STATE_CODES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  function populateStateSelect(locations) {
    var stateSelect = document.getElementById('cmx-state-select');
    if (!stateSelect) return;

    var currentVal = stateSelect.value;
    var statesSet = {};

    locations.forEach(function (loc) {
      var st = loc.state ? String(loc.state).trim().toUpperCase() : '';
      if (US_STATE_CODES.indexOf(st) !== -1) { // real US states only (no DFW, ST, US)
        statesSet[st] = true;
      }
    });

    var states = Object.keys(statesSet).sort();
    var html = '<option value="">All States (' + states.length + ' States)</option>';
    states.forEach(function (st) {
      html += '<option value="' + escapeHtml(st) + '">' + escapeHtml(st) + '</option>';
    });
    stateSelect.innerHTML = html;
    if (currentVal && statesSet[currentVal]) stateSelect.value = currentVal;
  }

  function renderMapAndSidebar(isGeolocationTriggered) {
    var searchVal = (document.getElementById('cmx-search-input') ? document.getElementById('cmx-search-input').value : '').toLowerCase().trim();
    var tabVal = document.getElementById('cmx-tab-select') ? document.getElementById('cmx-tab-select').value : '';
    var stateVal = document.getElementById('cmx-state-select') ? document.getElementById('cmx-state-select').value.toUpperCase() : '';
    var typeVal = selectedTypeFilter || (document.getElementById('cmx-type-select') ? document.getElementById('cmx-type-select').value : '');
    var sortVal = document.getElementById('cmx-sort-select') ? document.getElementById('cmx-sort-select').value : 'name-asc';

    var tokens = searchVal.split(/\s+/).filter(Boolean);

    function isTotalSummaryRow(str) {
      if (!str) return false;
      var s = String(str).trim().toLowerCase();
      if (s === 'total' || s === 'grand total' || s === 'subtotal' || s === 'total sales' || s === 'total volume') return true;
      if (/^(total|subtotal|grand total)\s*[:\-\_]/i.test(s)) return true;
      if (/^(total|subtotal|grand total)\s+for\b/i.test(s)) return true;
      if (/^(total|subtotal|grand total)\s+with\b/i.test(s)) return true;
      return false;
    }

    var filtered = allLocations.filter(function (loc) {
      var rawName = String(loc.name || '').trim();
      if (isTotalSummaryRow(rawName)) {
        return false;
      }

      var tabNameResolved = loc._cleanTabName || getTabName(loc);
      var fullText = [
        loc.name,
        loc.address,
        loc.city,
        loc.state,
        loc.postalCode,
        loc.bottlings,
        loc.type,
        loc.distributor,
        loc.territory,
        tabNameResolved
      ].join(' ').toLowerCase();

      var matchesSearch = tokens.length === 0 || tokens.every(function (t) {
        return fullText.indexOf(t) !== -1;
      });

      var matchesTab = !tabVal || tabNameResolved === tabVal;
      var matchesState = !stateVal || (loc.state && String(loc.state).trim().toUpperCase() === stateVal);
      var matchesType = !typeVal || loc.type === typeVal;

      return matchesSearch && matchesTab && matchesState && matchesType;
    });

    // Handle user location distances
    if (userLocation) {
      filtered.forEach(function(loc) {
        var lat = parseFloat(loc.latitude);
        var lng = parseFloat(loc.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          loc._distance = getDistanceMiles(userLocation.lat, userLocation.lng, lat, lng);
        } else {
          loc._distance = 999999;
        }
      });
      filtered.sort(function(a, b) {
        return (a._distance || 0) - (b._distance || 0);
      });
    } else {
      // Apply standard sorting
      filtered.sort(function (a, b) {
        if (sortVal === 'name-desc') {
          return String(b.name || '').localeCompare(String(a.name || ''));
        } else if (sortVal === 'cases-desc') {
          var cA = Number(a.cases) || 0;
          var cB = Number(b.cases) || 0;
          return cB - cA;
        } else if (sortVal === 'city-asc') {
          return String(a.city || '').localeCompare(String(b.city || ''));
        } else {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
      });
    }

    // Update count badge (SHOWING X OF Y STORES format matching Screenshot 4)
    var countBadge = document.getElementById('cmx-count-badge');
    if (countBadge) {
      countBadge.textContent = 'SHOWING ' + filtered.length + ' OF ' + allLocations.length + ' STORES';
    }

    // Geolocation Nearest Banner logic
    var nearestBanner = document.getElementById('cmx-nearest-banner');
    if (nearestBanner) {
      if (userLocation && filtered.length > 0) {
        var closest = filtered[0];
        var distMi = Math.round(closest._distance || 0);
        var distKm = Math.round(distMi * 1.60934);
        var formattedDistMi = distMi.toLocaleString('en-US');
        var formattedDistKm = distKm.toLocaleString('en-US');

        var isNear = distMi < 50;
        var bannerMsg = isNear
          ? 'Nearest Casa México is <strong>' + formattedDistMi + ' mi</strong> away.'
          : 'No stores found near you<br><span style="font-size:0.85rem; color:#6E6762; font-weight:400;">Nearest Casa México is <strong>' + formattedDistMi + ' mi (' + formattedDistKm + ' km)</strong> away.</span>';

        var cleanName = escapeHtml(closest.name || 'Store Location');
        var cityStateStr = [closest.city, closest.state].filter(function(x) { return x && x !== 'N/A' && x !== 'US'; }).join(', ') + (closest.postalCode ? ' ' + escapeHtml(closest.postalCode) : '');
        var directionsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(cleanName + ' ' + (closest.address || cityStateStr || ''));

        nearestBanner.style.display = 'block';
        nearestBanner.innerHTML =
          '<div class="cmx-nearest-title">' + bannerMsg + '</div>' +
          '<div class="cmx-nearest-card">' +
            '<div class="cmx-nearest-name">' + cleanName + '</div>' +
            '<div class="cmx-nearest-addr">' + (cityStateStr || escapeHtml(closest.address || '')) + '</div>' +
            '<div class="cmx-nearest-actions">' +
              '<button type="button" class="cmx-nearest-btn-map" id="cmx-btn-view-nearest"><i class="fa-solid fa-location-dot"></i> VIEW ON MAP</button>' +
              '<a href="' + directionsUrl + '" target="_blank" rel="noopener" class="cmx-nearest-btn-dir"><i class="fa-solid fa-diamond-turn-right"></i> GET DIRECTIONS</a>' +
            '</div>' +
          '</div>';

        var viewNearestBtn = document.getElementById('cmx-btn-view-nearest');
        if (viewNearestBtn && map) {
          viewNearestBtn.addEventListener('click', function() {
            var lat = parseFloat(closest.latitude);
            var lng = parseFloat(closest.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              map.setView([lat, lng], 14, { animate: true });
              var found = locationMarkers.find(function (m) { return m.id === (closest.id || 0); });
              if (found && found.marker) found.marker.openPopup();
            }
          });
        }
      } else {
        nearestBanner.style.display = 'none';
        nearestBanner.innerHTML = '';
      }
    }

    if (currentViewMode === 'table') {
      renderTable(filtered);
    } else if (currentViewMode === 'sales') {
      renderSalesMetrics(filtered);
    } else {
      renderMapAndCards(filtered);
    }
  }

  function renderSalesMetrics(filtered) {
    var volEl = document.getElementById('cmx-sales-vol');
    var topEl = document.getElementById('cmx-sales-top-prod');
    var marketsEl = document.getElementById('cmx-sales-markets');
    var container = document.getElementById('cmx-sales-breakdown');

    var totalVol = 0;
    var productMap = {};
    var territoryMap = {};

    filtered.forEach(function (loc) {
      if (loc.cases) totalVol += Number(loc.cases);
      var prod = loc.bottlings || 'Casa Mexico Tequila';
      productMap[prod] = (productMap[prod] || 0) + (Number(loc.cases) || 1);
      var terr = loc.territory || loc.state || 'US';
      territoryMap[terr] = (territoryMap[terr] || 0) + (Number(loc.cases) || 1);
    });

    var topProd = 'Casa Mexico Reposado';
    var maxCases = 0;
    Object.keys(productMap).forEach(function (p) {
      if (productMap[p] > maxCases) {
        maxCases = productMap[p];
        topProd = p;
      }
    });

    if (volEl) volEl.textContent = totalVol ? totalVol + ' Cases' : filtered.length + ' Stores';
    if (topEl) topEl.textContent = topProd;
    if (marketsEl) marketsEl.textContent = Object.keys(territoryMap).length + ' Markets';

    if (container) {
      if (filtered.length === 0) {
        container.innerHTML = '<div class="cmx-no-results">No sales records matching search criteria.</div>';
        return;
      }

      var html = '';
      Object.keys(territoryMap).sort().forEach(function (terr) {
        html += '<div class="cmx-sales-card">' +
          '<div class="cmx-sales-card-title"><i class="fa-solid fa-location-dot"></i> Territory: ' + escapeHtml(terr) + '</div>' +
          '<div class="cmx-sales-card-vol"><i class="fa-solid fa-box"></i> Volume: <strong>' + territoryMap[terr] + '</strong> units / cases</div>' +
          '</div>';
      });
      container.innerHTML = html;
    }
  }

  // Custom Warm Brown Leaflet Teardrop Pin Marker Icon matching Image 3 & 4!
  function createWarmPinMarkerIcon() {
    if (!window.L) return null;
    return L.divIcon({
      className: 'cmx-custom-pin-marker',
      html: '<div class="cmx-marker-pin"><svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.163 0 0 7.163 0 16C0 28 16 42 16 42C16 42 32 28 32 16C32 7.163 24.837 0 16 0Z" fill="#B37A4C"/><circle cx="16" cy="15" r="5" fill="#FFFFFF"/></svg></div>',
      iconSize: [32, 42],
      iconAnchor: [16, 42],
      popupAnchor: [0, -38]
    });
  }

  function renderMapAndCards(filtered) {
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();
    locationMarkers = [];

    var sidebarContainer = document.getElementById('cmx-sidebar-list');
    if (sidebarContainer) sidebarContainer.innerHTML = '';

    if (filtered.length === 0) {
      if (sidebarContainer) {
        sidebarContainer.innerHTML = '<div class="cmx-no-results">No stores found matching your search.</div>';
      }
      return;
    }

    var bounds = L.latLngBounds();
    var pinIcon = createWarmPinMarkerIcon();

    function formatLocationAddress(loc) {
      var addr = loc.address ? escapeHtml(loc.address) : '';
      var cityStateParts = [];
      if (loc.city && loc.city !== 'N/A' && loc.city !== loc.address) cityStateParts.push(escapeHtml(loc.city));
      if (loc.state && loc.state !== 'US') cityStateParts.push(escapeHtml(loc.state));
      var cityState = cityStateParts.join(', ') + (loc.postalCode ? ' ' + escapeHtml(loc.postalCode) : '');

      if (addr && cityState && addr !== cityState) {
        return addr + ' (' + cityState + ')';
      } else if (addr) {
        return addr;
      } else if (cityState) {
        return cityState;
      } else {
        return escapeHtml(loc.territory || loc.tabName || 'Available in Market');
      }
    }

    function buildDirectionsUrl(loc, fallbackName) {
      var nameToUse = fallbackName || loc.name;
      var parts = [nameToUse];
      if (loc.address && loc.address !== 'N/A') parts.push(loc.address);
      else if (loc.city && loc.city !== 'N/A') parts.push(loc.city);
      if (loc.state && loc.state !== 'US') parts.push(loc.state);
      return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(parts.join(', '));
    }

    function isTotalSummaryRow(str) {
      if (!str) return false;
      var s = String(str).trim().toLowerCase();
      if (s === 'total' || s === 'grand total' || s === 'subtotal' || s === 'total sales' || s === 'total volume') return true;
      if (/^(total|subtotal|grand total)\s*[:\-\_]/i.test(s)) return true;
      if (/^(total|subtotal|grand total)\s+for\b/i.test(s)) return true;
      if (/^(total|subtotal|grand total)\s+with\b/i.test(s)) return true;
      return false;
    }

    filtered.forEach(function (loc, index) {
      var lat = parseFloat(loc.latitude);
      var lng = parseFloat(loc.longitude);
      var latLng = (!isNaN(lat) && !isNaN(lng)) ? [lat, lng] : null;
      var addressHtml = formatLocationAddress(loc);
      
      var cleanName = escapeHtml(loc.name || '').replace(/\s*#\d+/g, '').trim();
      if (!cleanName || /^\d+(\.\d+)?$/.test(cleanName) || isTotalSummaryRow(cleanName)) {
        if (loc.bottlings && loc.bottlings !== 'Casa Mexico Tequila') {
          cleanName = escapeHtml(loc.bottlings);
        } else if (loc.territory || loc.tabName) {
          cleanName = escapeHtml(loc.territory || loc.tabName);
        } else {
          cleanName = 'Casa Mexico Location';
        }
      }

      var directionsUrl = buildDirectionsUrl(loc, cleanName);
      var typeLabel = loc.type === 'retail' ? 'RETAIL' : 'BAR & RESTAURANT';

      if (latLng) {
        bounds.extend(latLng);

        var markerOptions = { title: cleanName };
        if (pinIcon) markerOptions.icon = pinIcon;

        var marker = L.marker(latLng, markerOptions);
        var popupHtml = '<div class="cmx-leaflet-popup">' +
          '<div class="cmx-popup-title">' + cleanName + '</div>' +
          '<div class="cmx-popup-address">' + addressHtml + '</div>' +
          (loc.bottlings ? '<div class="cmx-bottlings-tag"><i class="fa-solid fa-glass-martini-alt"></i> <strong>Product:</strong> ' + escapeHtml(loc.bottlings) + '</div>' : '') +
          (loc.cases ? '<div class="cmx-cases-badge"><i class="fa-solid fa-box"></i> <strong>Sales Volume:</strong> ' + loc.cases + ' Cases</div>' : '') +
          '<a href="' + directionsUrl + '" target="_blank" rel="noopener" class="cmx-popup-btn"><i class="fa-solid fa-diamond-turn-right"></i> GET DIRECTIONS</a>' +
          '</div>';

        marker.bindPopup(popupHtml);
        markersGroup.addLayer(marker);
        locationMarkers.push({ id: loc.id || index, marker: marker, location: loc });
      }

      // Render Store Card matching Screenshot 4 format with Font Awesome icons!
      if (sidebarContainer) {
        var card = document.createElement('div');
        card.className = 'cmx-store-card';
        card.setAttribute('data-index', index);

        var typeIconHtml = loc.type === 'retail'
          ? '<i class="fa-regular fa-bookmark"></i> '
          : '<i class="fa-solid fa-utensils"></i> ';

        card.innerHTML =
          '<div class="cmx-card-main">' +
            '<div class="cmx-card-title">' + cleanName + '</div>' +
            '<div class="cmx-card-address">' + addressHtml + '</div>' +
          '</div>' +
          '<div class="cmx-card-footer">' +
            '<span class="cmx-card-type">' + typeIconHtml + typeLabel + '</span>' +
            '<a href="' + directionsUrl + '" target="_blank" rel="noopener" class="cmx-card-dir"><i class="fa-solid fa-diamond-turn-right"></i> GET DIRECTIONS</a>' +
          '</div>';

        if (latLng) {
          card.addEventListener('click', function () {
            document.querySelectorAll('.cmx-store-card').forEach(function (c) { c.classList.remove('cmx-active'); });
            card.classList.add('cmx-active');
            map.setView(latLng, 15, { animate: true });
            var found = locationMarkers.find(function (m) { return m.id === (loc.id || index); });
            if (found && found.marker) found.marker.openPopup();
          });
        }

        sidebarContainer.appendChild(card);
      }
    });

    setTimeout(function () {
      if (map) {
        map.invalidateSize();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [25, 25], maxZoom: 14 });
        }
      }
    }, 150);
  }

  function renderTable(filtered) {
    var tableBody = document.getElementById('cmx-table-body');
    var tableWrap = document.getElementById('cmx-table-view');
    if (!tableBody) return;

    var existingPagination = document.getElementById('cmx-table-pagination');
    if (existingPagination) existingPagination.remove();

    if (filtered.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="cmx-no-results">No store records matching search criteria.</td></tr>';
      return;
    }

    var totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIndex = (currentPage - 1) * itemsPerPage;
    var endIndex = startIndex + itemsPerPage;
    var pageItems = filtered.slice(startIndex, endIndex);

    var html = '';
    pageItems.forEach(function (loc) {
      var typeBadgeClass = loc.type === 'retail' ? 'cmx-badge-retail' : 'cmx-badge-bar-restaurant';
      var typeBadgeLabel = loc.type === 'retail' ? 'RETAIL' : 'BAR & RESTAURANT';
      var parts = [loc.name];
      if (loc.address && loc.address !== 'N/A') parts.push(loc.address);
      else if (loc.city && loc.city !== 'N/A') parts.push(loc.city);
      if (loc.state && loc.state !== 'US') parts.push(loc.state);
      var directionsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(parts.join(', '));
      var tName = loc._cleanTabName || getTabName(loc);
      var cityStateStr = [loc.city, loc.state].filter(function(x) { return x && x !== 'N/A' && x !== 'US'; }).join(', ') + (loc.postalCode ? ' ' + escapeHtml(loc.postalCode) : '');

      html += '<tr>' +
        '<td><strong>' + escapeHtml(loc.name) + '</strong></td>' +
        '<td>' + escapeHtml(loc.address || '—') + '</td>' +
        '<td>' + (cityStateStr ? escapeHtml(cityStateStr) : '—') + '</td>' +
        '<td><span class="cmx-badge ' + typeBadgeClass + '">' + typeBadgeLabel + '</span></td>' +
        '<td><span class="cmx-bottlings-tag">' + escapeHtml(loc.bottlings || 'N/A') + '</span></td>' +
        '<td>' + (loc.cases ? '<strong><i class="fa-solid fa-box"></i> ' + loc.cases + '</strong>' : '-') + '</td>' +
        '<td><span class="cmx-tab-pill">' + escapeHtml(tName) + '</span></td>' +
        '<td><a href="' + directionsUrl + '" target="_blank" rel="noopener" class="cmx-table-btn"><i class="fa-solid fa-diamond-turn-right"></i> Directions</a></td>' +
        '</tr>';
    });

    tableBody.innerHTML = html;

    // Render Perfect Pagination Bar
    if (tableWrap) {
      var pagBar = document.createElement('div');
      pagBar.id = 'cmx-table-pagination';
      pagBar.className = 'cmx-pagination-bar';
      pagBar.innerHTML =
        '<div class="cmx-pagination-info">Showing Page <strong>' + currentPage + '</strong> of <strong>' + totalPages + '</strong> (' + filtered.length + ' stores)</div>' +
        '<div class="cmx-pagination-controls">' +
          '<div class="cmx-per-page-wrap"><label for="cmx-per-page-select">Per Page:</label>' +
          '<select id="cmx-per-page-select" class="cmx-page-size-select">' +
            '<option value="15"' + (itemsPerPage === 15 ? ' selected' : '') + '>15</option>' +
            '<option value="25"' + (itemsPerPage === 25 ? ' selected' : '') + '>25</option>' +
            '<option value="50"' + (itemsPerPage === 50 ? ' selected' : '') + '>50</option>' +
            '<option value="100"' + (itemsPerPage === 100 ? ' selected' : '') + '>100</option>' +
          '</select></div>' +
          '<div class="cmx-page-btns">' +
            '<button type="button" id="cmx-prev-btn" class="cmx-page-btn"' + (currentPage <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i> Previous</button>' +
            '<button type="button" id="cmx-next-btn" class="cmx-page-btn"' + (currentPage >= totalPages ? ' disabled' : '') + '>Next <i class="fa-solid fa-chevron-right"></i></button>' +
          '</div>' +
        '</div>';
      tableWrap.appendChild(pagBar);

      var prevBtn = document.getElementById('cmx-prev-btn');
      var nextBtn = document.getElementById('cmx-next-btn');
      var perPageSelect = document.getElementById('cmx-per-page-select');

      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (currentPage > 1) {
            currentPage--;
            renderMapAndSidebar();
          }
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (currentPage < totalPages) {
            currentPage++;
            renderMapAndSidebar();
          }
        });
      }

      if (perPageSelect) {
        perPageSelect.addEventListener('change', function () {
          itemsPerPage = parseInt(this.value, 10) || 25;
          currentPage = 1;
          renderMapAndSidebar();
        });
      }
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLocatorMap);
  } else {
    initLocatorMap();
  }
}());