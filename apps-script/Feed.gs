function doGet(e) {
  try {
    var expectedToken = getFeedToken_();
    if (expectedToken) {
      var providedToken = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';
      if (providedToken !== expectedToken) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized token' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    var bypassCache = false;
    if (e && e.parameter) {
      var p = e.parameter;
      if (p.refresh === '1' || p.refresh === 'true' || p.nocache === '1' || p.nocache === 'true' || p.fresh === '1' || p.fresh === 'true' || p.bypass === '1') {
        bypassCache = true;
      }
    }

    var payload = getLocatorPayload_(bypassCache);
    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: err.message || 'Server error',
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getLocatorPayload_(bypassCache) {
  var cache = CacheService.getScriptCache();
  if (bypassCache) {
    try {
      cache.remove('locator-feed-v1');
    } catch (e) {}
  } else {
    var cached = cache.get('locator-feed-v1');
    if (cached) return JSON.parse(cached);
  }

  var spreadsheet = getSpreadsheet_();
  var sheets = spreadsheet.getSheets();
  
  var allLocations = [];
  var seenIds = {};
  var totalSkipped = { notReady: 0, invalidCoordinates: 0, duplicate: 0 };

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (sheet.isSheetHidden()) continue;
    
    var sheetName = sheet.getName();
    
    // November 2026 filter: only process sheets containing "November" AND "2026"
    var sheetNameLower = sheetName.toLowerCase();
    if (sheetNameLower.indexOf('november') === -1 || sheetNameLower.indexOf('2026') === -1) continue;
    
    var sheetGid = sheet.getSheetId ? sheet.getSheetId() : '';
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) continue;

    var result = normalizeSheetRows_(values, sheetName, seenIds, sheetGid);
    allLocations = allLocations.concat(result.locations);
    totalSkipped.notReady += result.skipped.notReady;
    totalSkipped.invalidCoordinates += result.skipped.invalidCoordinates;
    totalSkipped.duplicate += result.skipped.duplicate;
  }

  var payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    spreadsheetId: spreadsheet.getId(),
    count: allLocations.length,
    skipped: totalSkipped,
    locations: allLocations
  };

  try {
    var str = JSON.stringify(payload);
    if (str.length < 95000) {
      cache.put('locator-feed-v1', str, LOCATOR_CONFIG.cacheSeconds);
    }
  } catch (e) {
    // Ignore cache write errors
  }

  return payload;
}

var STATE_COORDINATES_ = {
  AL: [32.3182, -86.9023], AK: [63.5887, -154.4931], AZ: [34.0489, -111.0937], AR: [35.2010, -91.8318],
  CA: [36.7783, -119.4179], CO: [39.5501, -105.7821], CT: [41.6032, -73.0877], DE: [38.9108, -75.5277],
  FL: [27.6648, -81.5158], GA: [32.1656, -82.9001], HI: [19.8987, -155.6659], ID: [44.0682, -114.7420],
  IL: [40.6331, -89.3985], IN: [40.2672, -86.1349], IA: [41.8780, -93.0977], KS: [38.5266, -96.7265],
  KY: [37.8393, -84.2700], LA: [30.9843, -91.9623], ME: [45.2538, -69.4455], MD: [39.0458, -76.6413],
  MA: [42.4072, -71.3824], MI: [44.3148, -85.6024], MN: [46.7296, -94.6859], MS: [32.3547, -89.3985],
  MO: [37.9643, -91.8318], MT: [46.8797, -110.3626], NE: [41.4925, -99.9018], NV: [38.8026, -116.4194],
  NH: [43.1939, -71.5724], NJ: [40.0583, -74.4057], NM: [34.5199, -105.8701], NY: [40.7128, -74.0060],
  NC: [35.7596, -79.0193], ND: [47.5515, -101.0020], OH: [40.4173, -82.9071], OK: [35.0078, -97.0929],
  OR: [43.8041, -120.5542], PA: [41.2033, -77.1945], RI: [41.5801, -71.4774], SC: [33.8361, -81.1637],
  SD: [44.2998, -99.4388], TN: [35.5175, -86.5804], TX: [31.9686, -99.9018], UT: [39.3210, -111.0937],
  VT: [44.5588, -72.5778], VA: [37.4316, -78.6569], WA: [47.7511, -120.7401], WV: [38.5976, -80.4549],
  WI: [43.7844, -88.7879], WY: [43.0759, -107.2903]
};

// Valid USPS state codes (50 states + DC). Anything else (DFW, ST, US, region names) is NOT a state.
var US_STATE_CODES_ = Object.keys(STATE_COORDINATES_).concat(['DC']);

var US_STATE_NAMES_ = {
  'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA', 'COLORADO': 'CO',
  'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
  'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA',
  'MAINE': 'ME', 'MARYLAND': 'MD', 'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
  'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD',
  'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA',
  'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC'
};

// Market / city keywords that appear in tab names, title rows or region rows but are not states.
var MARKET_STATE_HINTS_ = {
  'DFW': 'TX', 'DALLAS': 'TX', 'FORT WORTH': 'TX', 'HOUSTON': 'TX', 'AUSTIN': 'TX', 'SAN ANTONIO': 'TX', 'EL PASO': 'TX',
  'NASHVILLE': 'TN', 'MEMPHIS': 'TN', 'CHATTANOOGA': 'TN', 'CHATANOOGA': 'TN', 'KNOXVILLE': 'TN',
  'LOUISVILLE': 'KY', 'LEXINGTON': 'KY', 'ATLANTA': 'GA', 'SAVANNAH': 'GA', 'CHICAGO': 'IL',
  'MIAMI': 'FL', 'TAMPA': 'FL', 'ORLANDO': 'FL', 'JACKSONVILLE': 'FL', 'BOSTON': 'MA', 'PROVIDENCE': 'RI',
  'LAS VEGAS': 'NV', 'PHOENIX': 'AZ', 'SCOTTSDALE': 'AZ', 'DENVER': 'CO', 'WICHITA': 'KS', 'ST. LOUIS': 'MO', 'ST LOUIS': 'MO',
  'MILWAUKEE': 'WI', 'OKLAHOMA CITY': 'OK', 'TULSA': 'OK', 'LOS ANGELES': 'CA', 'SAN DIEGO': 'CA', 'SAN FRANCISCO': 'CA',
  'MANHATTAN': 'NY', 'BROOKLYN': 'NY', 'NEWARK': 'NJ', 'JERSEY CITY': 'NJ'
};

function isValidStateCode_(code) {
  return US_STATE_CODES_.indexOf(String(code || '').trim().toUpperCase()) !== -1;
}

// Converts a cell value to a real state code ("tx", "Texas" -> "TX"). Returns '' for anything else (DFW, ST, US, store names).
function normalizeStateCode_(raw) {
  var str = String(raw || '').trim().toUpperCase().replace(/\./g, '');
  if (!str) return '';
  if (str.length === 2 && isValidStateCode_(str)) return str;
  if (US_STATE_NAMES_[str]) return US_STATE_NAMES_[str];
  return '';
}

function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds a state in free text (tab name, title rows, city). allowCodes=true also accepts whole-word
// UPPERCASE state codes (e.g. "Depletions TX July 2026", "MA-RI Summary"); title rows use names/markets only.
function inferStateFromText_(text, allowCodes) {
  var str = String(text || '');
  if (!str.trim()) return '';
  var upper = str.toUpperCase();

  var overrides = (LOCATOR_CONFIG && LOCATOR_CONFIG.stateOverrides) || {};
  for (var key in overrides) {
    if (key && upper.indexOf(String(key).toUpperCase()) !== -1 && isValidStateCode_(overrides[key])) {
      return String(overrides[key]).toUpperCase();
    }
  }

  if (allowCodes) {
    var tokens = str.split(/[^A-Za-z]+/);
    for (var t = 0; t < tokens.length; t++) {
      if (tokens[t].length === 2 && tokens[t] === tokens[t].toUpperCase() && isValidStateCode_(tokens[t])) {
        return tokens[t];
      }
    }
  }

  var padded = ' ' + upper.replace(/[^A-Z.]+/g, ' ') + ' ';
  for (var name in US_STATE_NAMES_) {
    if (padded.indexOf(' ' + name + ' ') !== -1) return US_STATE_NAMES_[name];
  }
  for (var market in MARKET_STATE_HINTS_) {
    if (new RegExp('(^|[^A-Z])' + escapeRegex_(market) + '([^A-Z]|$)').test(upper)) return MARKET_STATE_HINTS_[market];
  }
  return '';
}

function normalizeSheetRows_(values, sheetName, seenIds, sheetGid) {
  var locations = [];
  var skipped = { notReady: 0, invalidCoordinates: 0, duplicate: 0 };
  if (!values || values.length < 1) return { locations: locations, skipped: skipped };

  var cleanGid = sheetGid !== undefined && sheetGid !== null ? String(sheetGid) : '';

  // Infer default state from sheet name if missing in row
  // ("Casa Mexico Rolling 12 (24) KY" -> KY, "July 2026 NY-NJ" -> NY, "Depletions Nashville August 2026" -> TN)
  var inferredState = inferStateFromText_(sheetName, true);

  // Multiplier check for MA/RI per client email note (whole words only, so "Summary"/"Cristalino" don't match)
  var isMaRi = /\b(MA|RI)\b/.test(sheetName);

  // Find header row (search first 10 rows)
  var headerRowIdx = -1;
  for (var h = 0; h < Math.min(10, values.length); h++) {
    var rowText = (values[h] || []).join(' ').toLowerCase();
    if (rowText.indexOf('account') !== -1 || rowText.indexOf('store') !== -1 || rowText.indexOf('address') !== -1 || rowText.indexOf('retailer') !== -1 || rowText.indexOf('customer') !== -1 || rowText.indexOf('transaction') !== -1 || rowText.indexOf('description') !== -1 || rowText.indexOf('quantity') !== -1 || rowText.indexOf('item') !== -1 || rowText.indexOf('cases') !== -1 || rowText.indexOf('brand') !== -1 || rowText.indexOf('company') !== -1 || rowText.indexOf('name') !== -1 || rowText.indexOf('sold') !== -1 || rowText.indexOf('client') !== -1 || rowText.indexOf('buyer') !== -1 || rowText.indexOf('date') !== -1 || rowText.indexOf('city') !== -1) {
      headerRowIdx = h;
      break;
    }
  }

  // No state in the tab name: look at title rows above the header (e.g. "Athens Nashville") for a state/market name
  if (!inferredState) {
    var titleLimit = headerRowIdx !== -1 ? headerRowIdx : Math.min(5, values.length);
    for (var tr = 0; tr < titleLimit && !inferredState; tr++) {
      inferredState = inferStateFromText_((values[tr] || []).join(' '), false);
    }
  }

  var colMap = {};
  if (headerRowIdx !== -1) {
    var headers = values[headerRowIdx].map(function(h) { return String(h).trim(); });
    Object.keys(LOCATOR_CONFIG.headerAliases).forEach(function(key) {
      colMap[key] = findCol_(headers, LOCATOR_CONFIG.headerAliases[key]);
    });
  }

  // Fallbacks if no header row found or column indices not matched
  var startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
  var currentProduct = 'Casa Mexico Tequila';

  for (var i = startRow; i < values.length; i++) {
    var row = values[i];
    if (!row || row.length === 0) continue;

    var filledCells = row.map(function(c) { return String(c).trim(); }).filter(function(c) { return c !== ''; });
    if (filledCells.length === 0) continue;

    // Standalone section header check (e.g. single cell row containing "Casa Mexico...")
    if (filledCells.length === 1 && /casa\s*mexico/i.test(filledCells[0])) {
      currentProduct = filledCells[0];
      continue;
    }

    // Skip summary / total rows where all filled cells are pure numbers
    var hasTextCell = filledCells.some(function(c) {
      var cleaned = c.replace(/[$,%\s]/g, '');
      return cleaned !== '' && isNaN(Number(cleaned));
    });
    if (!hasTextCell) continue;

    var rawColA = String(row[0] || '').trim();
    var rawColB = String(row[1] || '').trim();
    var rawColC = String(row[2] || '').trim();

    var name = '';
    var address = '';
    var cityRaw = '';
    var bottlings = currentProduct;
    var dateVal = '';

    if (colMap.name !== undefined && colMap.name !== -1) {
      name = cellAlias_(row, colMap.name);
    }
    if (colMap.address !== undefined && colMap.address !== -1) {
      address = cellAlias_(row, colMap.address);
    }
    if (colMap.city !== undefined && colMap.city !== -1) {
      cityRaw = cellAlias_(row, colMap.city);
    }
    if (colMap.bottlings !== undefined && colMap.bottlings !== -1) {
      var customBottlings = cellAlias_(row, colMap.bottlings);
      if (customBottlings) bottlings = customBottlings;
    }
    if (colMap.date !== undefined && colMap.date !== -1) {
      dateVal = cellAlias_(row, colMap.date);
    }

    // Heuristic fallback for tabs where Col A = Product, Col B = Store Name, Col C = City/Item
    if (/casa\s*mexico/i.test(rawColA) && rawColB !== '') {
      bottlings = rawColA;
      name = rawColB;
      if (!cityRaw) cityRaw = rawColC;
    } else if (!name || /^\d+(\.\d+)?$/.test(name.trim())) {
      // If Col A looks like a date (e.g. 08/04/2026), use Col B as name
      if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(rawColA)) {
        name = rawColB;
        if (!dateVal) dateVal = rawColA;
      } else if (rawColB && !/^\d+(\.\d+)?$/.test(rawColB.trim())) {
        name = rawColB;
        if (/^\d+$/.test(rawColA) && (!bottlings || bottlings === 'Casa Mexico Tequila')) {
          bottlings = rawColB + ' (Item #' + rawColA + ')';
        }
      } else if (bottlings && bottlings !== 'Casa Mexico Tequila') {
        name = bottlings;
      } else if (rawColA && !/^\d+(\.\d+)?$/.test(rawColA.trim())) {
        name = rawColA;
      }
    }

    var stateRaw = colMap.state !== undefined && colMap.state !== -1 ? cellAlias_(row, colMap.state) : '';
    // Only real US state codes are accepted; DFW / ST / US / region / salesman text falls back to the tab's state.
    // Rows with no identifiable state get '' (shown under "All States" only, never as a fake state option).
    var cleanState = normalizeStateCode_(stateRaw);
    var state = cleanState || inferredState || inferStateFromText_(cityRaw, false) || '';

    var postalCode = colMap.postalCode !== undefined && colMap.postalCode !== -1 ? cellAlias_(row, colMap.postalCode) : '';
    var premiseType = colMap.premiseType !== undefined && colMap.premiseType !== -1 ? cellAlias_(row, colMap.premiseType) : '';
    var status = colMap.status !== undefined && colMap.status !== -1 ? cellAlias_(row, colMap.status) : '';
    var lat = colMap.latitude !== undefined && colMap.latitude !== -1 ? Number(cellAlias_(row, colMap.latitude)) : NaN;
    var lng = colMap.longitude !== undefined && colMap.longitude !== -1 ? Number(cellAlias_(row, colMap.longitude)) : NaN;
    var placeId = colMap.placeId !== undefined && colMap.placeId !== -1 ? cellAlias_(row, colMap.placeId) : '';
    var phone = colMap.phone !== undefined && colMap.phone !== -1 ? cellAlias_(row, colMap.phone) : '';
    var website = colMap.website !== undefined && colMap.website !== -1 ? cellAlias_(row, colMap.website) : '';

    var nameLower = String(name).toLowerCase();

    // Skip header text rows or summary totals (e.g. "Total", "Total for Casa Mexico...", "Total for Blanco...")
    if (!name || /^\d+(\.\d+)?$/.test(name.trim()) || isTotalSummaryName_(name) || String(address).toLowerCase() === 'total' || nameLower === 'mexcor florida' || nameLower === 'store name' || nameLower === 'retailer' || nameLower === 'customer full name' || nameLower === 'account name' || nameLower === 'customer name' || nameLower === 'customer nan' || nameLower === 'blanco' || nameLower === 'reposado' || nameLower === 'anejo' || nameLower === 'item' || nameLower === 'description size') continue;

    if (status && !String(status).toLowerCase().startsWith('ready')) {
      skipped.notReady++;
      continue;
    }

    // Clean store / customer name
    var cleanName = String(name).replace(/\s*#\d+/g, '').trim();
    if (!cleanName || /^\d+(\.\d+)?$/.test(cleanName) || isTotalSummaryName_(cleanName)) continue;

    var uniqueId = placeId || ('CMT-' + sheetName.replace(/[^a-zA-Z0-9]/g, '') + '-' + String(i).padStart(3, '0'));
    if (seenIds[uniqueId]) {
      skipped.duplicate++;
      continue;
    }
    seenIds[uniqueId] = true;

    // Fully optional address & city handling - gracefully build clean address without forcing N/A
    var city = (cityRaw && cityRaw !== 'N/A') ? cityRaw : '';
    var displayAddress = (address && address !== 'N/A') ? address : '';

    var addrParts = [];
    if (displayAddress) addrParts.push(displayAddress);
    if (city && city !== displayAddress) addrParts.push(city);
    if (state && (!displayAddress || displayAddress.indexOf(state) === -1)) addrParts.push(state);
    if (postalCode) addrParts.push(postalCode);

    var fullAddress = addrParts.length > 0 ? addrParts.join(', ') : '';
    var normType = String(premiseType).toLowerCase();
    var type = (normType.indexOf('bar') !== -1 || normType.indexOf('restaurant') !== -1 || normType.indexOf('kitchen') !== -1) ? 'bar-restaurant' : 'retail';

    var casesRaw = colMap.cases !== undefined && colMap.cases !== -1 ? cellAlias_(row, colMap.cases) : '';
    var casesVal = Number(casesRaw);
    var cases = (casesRaw !== '' && !isNaN(casesVal)) ? casesVal : null;
    if (cases !== null && isMaRi) {
      cases = cases * 2; // Auto-apply client 2x multiplier for MA/RI
    }

    // Default coordinates fallback based on state centroid if exact lat/lng are missing
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
      var stateUpper = String(state).toUpperCase();
      if (STATE_COORDINATES_[stateUpper]) {
        lat = STATE_COORDINATES_[stateUpper][0];
        lng = STATE_COORDINATES_[stateUpper][1];
      } else {
        lat = 39.8283;
        lng = -98.5795;
      }
    }

    locations.push({
      id: uniqueId,
      name: cleanName,
      address: fullAddress,
      city: city,
      state: state,
      postalCode: String(postalCode || ''),
      type: type,
      latitude: lat,
      longitude: lng,
      placeId: uniqueId,
      phone: phone || '',
      website: website || '',
      distributor: (state || sheetName) + ' Distributor',
      territory: state || sheetName,
      tabName: sheetName,
      sheetGid: cleanGid,
      cases: cases,
      bottlings: bottlings,
      date: dateVal || ''
    });
  }

  return { locations: locations, skipped: skipped };
}

function isTotalSummaryName_(s) {
  if (!s) return false;
  var str = String(s).trim().toLowerCase();
  if (str === 'total' || str === 'grand total' || str === 'subtotal' || str === 'total sales' || str === 'total volume') return true;
  if (/^(total|subtotal|grand total)\s*[:\-\_]/i.test(str)) return true;
  if (/^(total|subtotal|grand total)\s+for\b/i.test(str)) return true;
  if (/^(total|subtotal|grand total)\s+with\b/i.test(str)) return true;
  return false;
}

function normalizeRows_(values) {
  return normalizeSheetRows_(values, 'Store Locator', {}, '0');
}

function findCol_(headers, aliases) {
  if (!headers || !aliases) return -1;
  // 1. Exact match (case-insensitive & alphanumeric)
  for (var i = 0; i < aliases.length; i++) {
    var aliasClean = String(aliases[i]).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var j = 0; j < headers.length; j++) {
      var hClean = String(headers[j]).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (hClean && hClean === aliasClean) return j;
    }
  }
  // 2. Whole phrase match (header contains full alias string)
  //    Short aliases (<= 3 chars like "ST", "ID", "Lat") must match a whole word, otherwise
  //    "ST" matches "cuSTomer" and the Customer Name column gets read as the State column.
  for (var i = 0; i < aliases.length; i++) {
    var aliasNorm = String(aliases[i]).toLowerCase().trim();
    if (!aliasNorm) continue;
    for (var j = 0; j < headers.length; j++) {
      var hNorm = String(headers[j]).toLowerCase().trim();
      if (!hNorm) continue;
      if (aliasNorm.length <= 3) {
        if (hNorm.split(/[^a-z0-9]+/).indexOf(aliasNorm) !== -1) return j;
      } else if (hNorm === aliasNorm || hNorm.indexOf(aliasNorm) !== -1) {
        return j;
      }
    }
  }
  return -1;
}

function cellAlias_(row, colIndex) {
  if (colIndex === -1 || colIndex >= row.length) return '';
  return String(row[colIndex]).trim();
}

function validateRequiredHeaders_(headers) {
  var missing = [];
  LOCATOR_CONFIG.requiredHeaders.forEach(function(req) {
    var aliases = LOCATOR_CONFIG.headerAliases;
    var found = false;
    for (var key in aliases) {
      if (aliases[key].indexOf(req) !== -1 || aliases[key].some(function(alias) { return headers.indexOf(alias) !== -1; })) {
        found = true;
        break;
      }
    }
    if (headers.indexOf(req) !== -1) found = true;
    if (!found) missing.push(req);
  });

  // Flexible header check - only require store/customer name
  var hasName = headers.some(function(h) { 
    var hNorm = String(h).toLowerCase();
    return LOCATOR_CONFIG.headerAliases.name.some(function(alias) { return String(alias).toLowerCase() === hNorm; }) || hNorm.indexOf('customer') !== -1 || hNorm.indexOf('store') !== -1 || hNorm.indexOf('account') !== -1;
  });
  if (!hasName && headers.length === 0) {
    throw new Error('Sheet missing valid data columns.');
  }
}