
alert("BETA Build 3.1A - Locations are only accurate to country level, markers are jittered for visibility.");
console.log("Build 3.1A BETA TEST DEMO")
// Initialize map
const map = L.map("map").setView([31, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Custom Benchy icon
const benchyIcon = L.icon({
    iconUrl: "assets/benchyRedv2.png",
    iconSize: [34.42, 32],
    iconAnchor: [20, 33.5], // bottom center of icon
    popupAnchor: [0, -30], // slightly above the icon
});

// Reusable hover label element
let hoverLabel = null;
let hideTimer = null;

function ensureHoverLabel(){
    if (!hoverLabel) {
        hoverLabel = document.createElement("div");
        hoverLabel.className="pinLabel";
        document.body.appendChild(hoverLabel);
    }
}

// Track whether mouse is currently over the label
let hoveringLabel = false;
// Store user position when available
let userPosition = null;
// Printer data & markers
let printerData = [];
let printerMarkers = [];
// Nearest highlight layer reference
let nearestHighlightLayer = null;
// Marker whose label is pinned (won't auto-hide on mouseout)
let pinnedMarker = null;

// Active filters
let activeFilters = {
    materials: [], // selected materials (must all be present unless OTHER specified)
    color: '',     // single selected color
    minLargestSide: 0, // minimum largest dimension in mm
    otherMaterialTerms: [], // parsed custom other material terms
    otherColorTerms: [] // parsed custom other color terms
};

// Threshold beyond which we consider the nearest printer "far" for user messaging
const FAR_DISTANCE_KM = 600; // adjust as needed

function showNoResultsPopup(message){
    let el = document.getElementById('noResultsPopup');
    if (!el) return;
    el.innerHTML = `<strong>No Matches</strong><br>${message}<br><button class="closePopupBtn" type="button" onclick="hideNoResultsPopup()">Dismiss</button>`;
    el.style.display = 'block';
}
function hideNoResultsPopup(){
    const el = document.getElementById('noResultsPopup');
    if (el) el.style.display = 'none';
}

function filtersAreActive(){
    return (activeFilters.materials.length > 0 ||
            !!activeFilters.color ||
            activeFilters.minLargestSide > 0 ||
            activeFilters.otherMaterialTerms.length > 0 ||
            activeFilters.otherColorTerms.length > 0);
}

function printerMatchesActiveFilters(printer){
    // If no filters active, show all printers
    if (!filtersAreActive()) return true;
    
    // If printer has no filament data, exclude it when material/color filters are active
    if ((activeFilters.materials.length > 0 || activeFilters.color) && !printer.filaments) {
        return false;
    }
    
    const knownMaterials = ['PLA','ABS','PETG','TPU'];
    const requiredMaterials = activeFilters.materials.filter(m => m !== 'OTHER');
    const hasOtherMaterialFilter = activeFilters.materials.includes('OTHER');
    const printerMaterials = getPrinterMaterials(printer.filaments);
    const printerColors = getPrinterColors(printer.filaments);
    const filamentPairs = getFilamentPairs(printer.filaments); // [{material,color}]

    if (requiredMaterials.length > 0) {
        if (!requiredMaterials.every(m => printerMaterials.includes(m))) return false;
    }
    if (hasOtherMaterialFilter) {
        if (activeFilters.otherMaterialTerms.length > 0) {
            const lower = printerMaterials.map(m=>m.toLowerCase());
            const matchesTerm = activeFilters.otherMaterialTerms.some(term => lower.includes(term.toLowerCase()));
            if (!matchesTerm) return false;
        } else {
            if (!printerMaterials.some(m => !knownMaterials.includes(m))) return false;
        }
    }
    if (activeFilters.color) {
        const knownColors = ['Black','White','Red','Orange','Blue','Green','Yellow','Purple','Gray','Clear'];
        const hasSpecificMaterials = requiredMaterials.length > 0;
        if (activeFilters.color === 'Other') {
            if (activeFilters.otherColorTerms.length > 0) {
                // Must match one of otherColorTerms; if material filter active restrict to those materials
                const termsLower = activeFilters.otherColorTerms.map(t=>t.toLowerCase());
                const anyMatch = filamentPairs.some(fp => (!hasSpecificMaterials || requiredMaterials.includes(fp.material)) && fp.color && termsLower.includes(fp.color.toLowerCase()));
                if (!anyMatch) return false;
            } else {
                // Any non-known color; restrict to material intersection if materials selected
                const anyOther = filamentPairs.some(fp => (!hasSpecificMaterials || requiredMaterials.includes(fp.material)) && fp.color && !knownColors.includes(fp.color));
                if (!anyOther) return false;
            }
        } else {
            if (hasSpecificMaterials) {
                // Require at least one filament pair where both material and color match
                const hasPair = filamentPairs.some(fp => requiredMaterials.includes(fp.material) && fp.color === activeFilters.color);
                if (!hasPair) return false;
            } else {
                // No material intersection required, fall back to color presence anywhere
                if (!printerColors.includes(activeFilters.color)) return false;
            }
        }
    }
    if (activeFilters.minLargestSide > 0 && Array.isArray(printer.printSize)) {
        const largest = Math.max(...printer.printSize);
        if (largest < activeFilters.minLargestSide) return false;
    }
    return true;
}

function toggleMaterialFilter(material) {
    const idx = activeFilters.materials.indexOf(material);
    if (idx > -1) {
        activeFilters.materials.splice(idx, 1);
    } else {
        activeFilters.materials.push(material);
    }
    // Update UI
    const btn = document.querySelector(`[data-filter="${material}"]`);
    if (btn) btn.classList.toggle('active');
    updateOtherInputs();
    applyFilters();
}

function clearFilters() {
    activeFilters.materials = [];
    activeFilters.color = '';
    activeFilters.minLargestSide = 0;
    activeFilters.otherMaterialTerms = [];
    activeFilters.otherColorTerms = [];
    document.querySelectorAll('#materialFilters .filterChip').forEach(c => c.classList.remove('active'));
    const sideEl = document.getElementById('largestSideFilter');
    if (sideEl) sideEl.value = '0';
    const colorSel = document.getElementById('colorFilter');
    if (colorSel) colorSel.value = '';
    const om = document.getElementById('otherMaterialInput');
    const oc = document.getElementById('otherColorInput');
    if (om) om.value='';
    if (oc) oc.value='';
    updateOtherInputs();
    updateColorPreview();
    applyFilters();
}

function applyFilters() {
    // Update largest side filter
    const sideSelect = document.getElementById('largestSideFilter');
    if (sideSelect) activeFilters.minLargestSide = parseInt(sideSelect.value) || 0;
    const colorSelect = document.getElementById('colorFilter');
    if (colorSelect) activeFilters.color = colorSelect.value || '';

    const knownMaterials = ['PLA','ABS','PETG','TPU'];
    const hasOtherMaterialFilter = activeFilters.materials.includes('OTHER');
    const requiredMaterials = activeFilters.materials.filter(m => m !== 'OTHER');

    // Parse custom other specs
    const om = document.getElementById('otherMaterialInput');
    const oc = document.getElementById('otherColorInput');
    activeFilters.otherMaterialTerms = (om && om.value.trim()) ? om.value.split(/[,]/).map(s=>s.trim()).filter(Boolean) : [];
    activeFilters.otherColorTerms = (oc && oc.value.trim()) ? oc.value.split(/[,]/).map(s=>s.trim()).filter(Boolean) : [];

    printerMarkers.forEach(marker => {
        const show = printerMatchesActiveFilters(marker.metadata);
        if (show) {
            if (!map.hasLayer(marker)) marker.addTo(map);
        } else if (map.hasLayer(marker)) {
            map.removeLayer(marker);
            if (pinnedMarker === marker) {
                pinnedMarker = null;
                hideLabel(true);
            }
        }
    });
    if (userPosition) {
        const nearest = findNearestPrinter(userPosition.lat, userPosition.lng);
        if (nearest) {
            const marker = printerMarkers.find(m => m.metadata === nearest.printer);
            if (marker) highlightMarker(marker);
            if (typeof x !== 'undefined' && x) {
                if (filtersAreActive() && nearest.distanceKm > FAR_DISTANCE_KM) {
                    x.innerHTML = `⚠️ Nearest matching printer is far (${nearest.distanceKm.toFixed(1)} km: ${nearest.printer.name}). Consider reducing filters to increase yield.`;
                } else {
                    x.innerHTML = `✅ Nearest printer: ${nearest.printer.name} (${nearest.printer.printerModel}) – ${nearest.distanceKm.toFixed(1)} km away`;
                }
            }
            hideNoResultsPopup();
        } else if (typeof x !== 'undefined' && x) {
            if (filtersAreActive()) {
                x.innerHTML = '❌ No matching printers found.';
                showNoResultsPopup('No printers match your current filters. Try reducing filters to increase results.');
            } else {
                x.innerHTML = 'No printers loaded yet.';
                hideNoResultsPopup();
            }
        }
    }
}

function getPrinterMaterials(filaments) {
    if (!filaments) return [];
    if (typeof filaments === 'object' && !Array.isArray(filaments)) {
        return Object.keys(filaments);
    }
    if (Array.isArray(filaments)) {
        return filaments.map(f => {
            if (typeof f === 'string') return f.split(/[:|-]/)[0];
            return f.material;
        }).filter(Boolean);
    }
    return [];
}

function getPrinterColors(filaments) {
    const colors = [];
    if (!filaments) return colors;
    if (typeof filaments === 'object' && !Array.isArray(filaments)) {
        Object.values(filaments).forEach(val => {
            if (Array.isArray(val)) {
                val.forEach(c => colors.push(c));
            } else if (typeof val === 'string') {
                colors.push(val);
            }
        });
    } else if (Array.isArray(filaments)) {
        filaments.forEach(entry => {
            if (typeof entry === 'string') {
                const parts = entry.split(/[:|-]/);
                if (parts[1]) colors.push(parts[1]);
            } else if (entry && typeof entry === 'object') {
                if (entry.color) colors.push(entry.color);
            }
        });
    }
    return colors;
}

function getFilamentPairs(filaments){
    const pairs = [];
    if (!filaments) return pairs;
    if (typeof filaments === 'object' && !Array.isArray(filaments)) {
        Object.entries(filaments).forEach(([material, value]) => {
            if (Array.isArray(value)) {
                value.forEach(color => pairs.push({material, color}));
            } else if (typeof value === 'string') {
                pairs.push({material, color: value});
            }
        });
    } else if (Array.isArray(filaments)) {
        filaments.forEach(entry => {
            if (typeof entry === 'string') {
                const [material, color] = entry.split(/[:|-]/);
                pairs.push({material, color});
            } else if (entry && typeof entry === 'object') {
                pairs.push({material: entry.material, color: entry.color});
            }
        });
    }
    return pairs;
}

function colorToHex(name){
    const map = {
        Black: '#000000', White: '#ffffff', Red: '#dc2626', Orange: '#f97316', Blue: '#2563eb', Green: '#16a34a', Yellow: '#facc15', Purple: '#7e22ce', Gray: '#6b7280', Clear: 'linear-gradient(45deg,#ffffff,#d1d5db)'
    };
    return map[name] || 'linear-gradient(45deg,#374151,#1f2937)';
}

function updateColorPreview(){
    const preview = document.getElementById('colorPreview');
    const sel = document.getElementById('colorFilter');
    if (!preview || !sel) return;
    const value = sel.value;
    if (!value){
        preview.style.background = 'linear-gradient(45deg,#374151,#1f2937)';
        preview.style.borderColor = 'rgba(255,255,255,0.25)';
    } else if (value === 'Other') {
        // Pattern for other colors
        preview.style.background = 'repeating-linear-gradient(45deg,#4b5563 0 6px,#9ca3af 6px 12px)';
        preview.style.borderColor = 'rgba(255,255,255,0.4)';
    } else {
        const hex = colorToHex(value);
        preview.style.background = hex;
        preview.style.borderColor = 'rgba(255,255,255,0.35)';
    }
}

function updateOtherInputs(){
    const otherMatDiv = document.getElementById('otherMaterialSpec');
    const otherColDiv = document.getElementById('otherColorSpec');
    const colorSel = document.getElementById('colorFilter');
    const otherMatActive = activeFilters.materials.includes('OTHER');
    if (otherMatDiv) otherMatDiv.style.display = otherMatActive ? 'flex' : 'none';
    if (otherColDiv && colorSel) otherColDiv.style.display = (colorSel.value === 'Other') ? 'flex' : 'none';
}

// Initialize visibility once DOM ready (simple defer assumption)
setTimeout(updateOtherInputs, 0);

function hideLabel(force=false){
    if (!hoverLabel) return;
    if (force || !hoveringLabel) hoverLabel.style.display = 'none';
}

function highlightMarker(marker){
    if (!marker) return;
    // Remove previous highlight circle
    if (nearestHighlightLayer) {
        try { map.removeLayer(nearestHighlightLayer); } catch(e) {}
        nearestHighlightLayer = null;
    }

    // Bring marker forward visually
    if (marker.setZIndexOffset) marker.setZIndexOffset(1000);
    // Pin and show label
    pinnedMarker = marker;
    drawLabel(marker.metadata, { latlng: marker.getLatLng() });
    // Zoom and center smoothly on the marker
    try {
        map.flyTo(marker.getLatLng(), 9, { duration: 1.1, easeLinearity: 0.25 });
    } catch (e) {
        map.setView(marker.getLatLng(), 9);
    }
}

function renderFilaments(filaments){
    if (!filaments) return '<div class="pinCard-meta">No filament data</div>';
    let items = [];
    // Object form {PLA:"Orange", ABS:["Black","White"]}
    if (typeof filaments === 'object' && !Array.isArray(filaments)) {
        Object.entries(filaments).forEach(([material, value]) => {
            if (Array.isArray(value)) {
                value.forEach(color => {
                    items.push({material, color});
                });
            } else if (typeof value === 'string') {
                items.push({material, color: value});
            }
        });
    } else if (Array.isArray(filaments)) {
        // Array of objects [{material, color, hex}] or strings "PLA:Orange"
        filaments.forEach(entry => {
            if (typeof entry === 'string') {
                const [material, color] = entry.split(/[:|-]/); // supports PLA:Orange or PLA-Orange
                items.push({material, color});
            } else if (entry && typeof entry === 'object') {
                items.push({material: entry.material, color: entry.color, hex: entry.hex});
            }
        });
    }
    if (!items.length) return '<div class="pinCard-meta">No filament data</div>';
    const lis = items.map(({material, color, hex}) => {
        const chipColor = hex || (color || '#555');
        return `<li class="filamentItem"><span class="chip" style="background:${chipColor}"></span><span class="materialName">${material}</span>&nbsp;–&nbsp;<span>${color || chipColor}</span></li>`;
    }).join('');
    return `<ul class="filamentList">${lis}</ul>`;
}

function drawLabel(metadata, e){
    ensureHoverLabel();
    const { name = "Unknown", contact = "N/A", printerModel, city, country, gramsPrinted = 0, printSize, printVolume, filaments } = metadata || {};
    // const msg = `${name} | ${contact} | ${printerModel} | Printed: ${timesPrinted}`;
    // console.log(msg);

    // Position label anchored near the marker, not the mouse, so it doesn't move
    const pt = map.latLngToContainerPoint(e.latlng);
    const offsetX = window.innerWidth * 0.17; // 15% of viewport width
    const offsetY = window.innerHeight * 0.02; // 2% of viewport height
    const x = pt.x + offsetX;
    const y = pt.y - offsetY;
        const userId = metadata?.slackId || metadata?.slak || metadata?.contact || '';
        const teamId = metadata?.teamId || '';
        const subdomain = metadata?.workspaceSubdomain || 'hackclub';
        const deepLink = (teamId && userId) ? `slack://user?team=${teamId}&id=${userId}` : '';
        const universal = (teamId && userId) ? `https://slack.com/app_redirect?team=${teamId}&user=${userId}` : `https://${subdomain}.slack.com/app_redirect?channel=${userId}`;
        const webHref = `https://${(metadata?.website || 'hackclub.com').replace(/^https?:\/\//, '')}`;
        const volume = (printSize || printVolume);
        const volumeHtml = volume && Array.isArray(volume) && volume.length === 3
            ? `<div class="printVolume">Max Volume: ${volume[0]}×${volume[1]}×${volume[2]} mm</div>`
            : '<div class="printVolume">Max Volume: No volume data</div>';
        const printerModelHtml = (printerModel && printerModel.trim()) ? `<div class="pinCard-meta">${printerModel}</div>` : '<div class="pinCard-meta">No printer model data</div>';
        const hasBio = metadata?.bio && metadata.bio.trim();
        const bioSectionHtml = hasBio ? `
            <div class="bioSection">
                <button class="bioToggle" type="button" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                    <i class="fa-solid fa-chevron-right"></i> Bio
                </button>
                <div class="bioContent">${metadata.bio}</div>
            </div>` : '';
        const cityDisplay = (city && city.trim()) ? city : 'Unknown city';
        const countryDisplay = (country && country.trim()) ? country : 'Unknown';
        const cityHtml = `<div class="pinCard-meta">Location: ${cityDisplay}, ${countryDisplay}</div>`;
        const filamentHtml = filaments ? renderFilaments(filaments) : '<div class="pinCard-meta">No filament data</div>';
        const gramsHtml = `<div class="pinCard-meta">Grams Printed: ${gramsPrinted || 0}g</div>`;
        let distanceHtml = '';
        let farWarnHtml = '';
        if (userPosition && Number.isFinite(userPosition.lat) && Number.isFinite(userPosition.lng)) {
            const km = calcDistance(userPosition.lat, userPosition.lng, e.latlng.lat, e.latlng.lng);
            distanceHtml = `<div class="pinCard-meta">Distance: ${km.toFixed(1)} km</div>`;
            if (filtersAreActive() && km > FAR_DISTANCE_KM) {
                farWarnHtml = `<div class="farWarning">Far match – consider reducing filters</div>`;
            }
        }
        hoverLabel.innerHTML = `
            <div class="pinCard">
                <div class="pinCard-header">
                    <div class="avatar" style="background-image: url('${metadata?.profilePic || ''}'); background-size: cover; background-position: center;">${metadata?.profilePic ? '' : '🏷️'}</div>
                    <div>
                        <div><strong>${name}</strong></div>
                        ${printerModelHtml}
                    </div>
                </div>
                <div class="pinCard-body">
                    ${cityHtml}
                    ${distanceHtml}
                    ${gramsHtml}
                    ${volumeHtml}
                    ${filamentHtml}
                    ${farWarnHtml}
                </div>
                ${bioSectionHtml}
                <div class="pinCard-actions">
                    <button class="btn" type="button" id="msgSlackBtn"><i class="fa-brands fa-slack"></i>  Message on Slack</button>
                    <button class="btn" type="button" id="viewProfileBtn"><i class="fa-solid fa-globe"></i>  Website</button>
                </div>
            </div>`;
    hoverLabel.style.left = x + "px";
    hoverLabel.style.top = y + "px";
    hoverLabel.style.display = "block";

    // Allow interaction without disappearing (bind once)
    if (!hoverLabel._bound) {
        hoverLabel.addEventListener('mouseenter', () => {
            hoveringLabel = true;
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        });
        hoverLabel.addEventListener('mouseleave', () => {
            hoveringLabel = false;
            hideTimer = setTimeout(() => {
                if (!hoveringLabel) hoverLabel.style.display = 'none';
            }, 120);
        });
        hoverLabel._bound = true;
    }

    const msgSlackBtn = document.getElementById('msgSlackBtn');
    const viewProfileBtn = document.getElementById('viewProfileBtn');
    if (msgSlackBtn) {
        msgSlackBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!userId) {
                window.open(webHref, '_blank');
                return;
            }
            const url = `https://hackclub.slack.com/app_redirect?channel=${userId}`;
            window.open(url, '_blank');
        };
    }
    if (viewProfileBtn) {
        viewProfileBtn.onclick = (ev) => {
            ev.preventDefault();
            window.open(webHref, '_blank');
        };
    }
}

function drawMarker(lat, lng, metadata){
    const marker = L.marker([lat, lng], { icon: benchyIcon }).addTo(map);
    // Attach metadata directly to marker instance
    marker.metadata = metadata;
    printerMarkers.push(marker);
    let labelShown = false;
    // Use normal function to preserve 'this' = marker in handler
    marker.on('mouseover', function(e){
        if (!labelShown) {
            drawLabel(this.metadata, e);
            labelShown = true;
        }
    });
    marker.on('mouseout', function(){
        ensureHoverLabel();
        labelShown = false;
        if (this === pinnedMarker) return; // do not hide pinned label
        if (hideTimer) { clearTimeout(hideTimer); }
        hideTimer = setTimeout(() => {
            if (!hoveringLabel) hideLabel();
        }, 100);
    });
    return marker;
}

// Demo marker with metadata stored on the marker



// Simple country/region to lat/lng mapping for initial positioning
const countryCoords = {
    'United Kingdom': {lat: 51.5074, lng: -0.1278},
    'Canada': {lat: 56.1304, lng: -106.3468},
    'United States': {lat: 37.0902, lng: -95.7129},
    'Austria': {lat: 47.5162, lng: 14.5501},
    'Germany': {lat: 51.1657, lng: 10.4515},
    'Australia': {lat: -25.2744, lng: 133.7751},
    'Netherlands': {lat: 52.1326, lng: 5.2913},
    'India': {lat: 20.5937, lng: 78.9629},
    'Brazil': {lat: -14.2350, lng: -51.9253},
    'France': {lat: 46.2276, lng: 2.2137},
    'Spain': {lat: 40.4637, lng: -3.7492},
    'Italy': {lat: 41.8719, lng: 12.5674},
    'Japan': {lat: 36.2048, lng: 138.2529},
    'China': {lat: 35.8617, lng: 104.1954},
    'South Korea': {lat: 35.9078, lng: 127.7669},
    'Mexico': {lat: 23.6345, lng: -102.5528},
    'Argentina': {lat: -38.4161, lng: -63.6167},
    'Chile': {lat: -35.6751, lng: -71.5430},
    'Colombia': {lat: 4.5709, lng: -74.2973},
    'Peru': {lat: -9.1900, lng: -75.0152},
    'Singapore': {lat: 1.3521, lng: 103.8198},
    'New Zealand': {lat: -40.9006, lng: 174.8860},
    'South Africa': {lat: -30.5595, lng: 22.9375},
    'Egypt': {lat: 26.8206, lng: 30.8025},
    'Nigeria': {lat: 9.0820, lng: 8.6753},
    'Russia': {lat: 61.5240, lng: 105.3188},
    'Poland': {lat: 51.9194, lng: 19.1451},
    'Sweden': {lat: 60.1282, lng: 18.6435},
    'Norway': {lat: 60.4720, lng: 8.4689},
    'Denmark': {lat: 56.2639, lng: 9.5018},
    'Finland': {lat: 61.9241, lng: 25.7482},
    'Belgium': {lat: 50.5039, lng: 4.4699},
    'Switzerland': {lat: 46.8182, lng: 8.2275},
    'Portugal': {lat: 39.3999, lng: -8.2245},
    'Greece': {lat: 39.0742, lng: 21.8243},
    'Turkey': {lat: 38.9637, lng: 35.2433},
    'UAE': {lat: 23.4241, lng: 53.8478},
    'Saudi Arabia': {lat: 23.8859, lng: 45.0792},
    'Israel': {lat: 31.0461, lng: 34.8516},
    'Thailand': {lat: 15.8700, lng: 100.9925},
    'Vietnam': {lat: 14.0583, lng: 108.2772},
    'Philippines': {lat: 12.8797, lng: 121.7740},
    'Indonesia': {lat: -0.7893, lng: 113.9213},
    'Malaysia': {lat: 4.2105, lng: 101.9758},
    'Pakistan': {lat: 30.3753, lng: 69.3451},
    'Bangladesh': {lat: 23.6850, lng: 90.3563},
    'Ireland': {lat: 53.4129, lng: -8.2439},
    'Czech Republic': {lat: 49.8175, lng: 15.4730},
    'Hungary': {lat: 47.1625, lng: 19.5033},
    'Romania': {lat: 45.9432, lng: 24.9668},
    'Ukraine': {lat: 48.3794, lng: 31.1656},
    'Scotland': {lat: 56.4907, lng: -4.2026},
    'Wales': {lat: 52.1307, lng: -3.7837},
    'England': {lat: 52.3555, lng: -1.1743}
};

// Parse bio text to extract printer info
function parseBio(bio) {
    if (!bio) return {};
    const bioLower = bio.toLowerCase();
    const lines = bio.split('\\n');
    
    // Extract materials and colors from bio
    const materials = [];
    const filaments = {};
    
    if (bioLower.includes('pla')) materials.push('PLA');
    if (bioLower.includes('abs')) materials.push('ABS');
    if (bioLower.includes('petg')) materials.push('PETG');
    if (bioLower.includes('tpu')) materials.push('TPU');
    if (bioLower.includes('nylon')) materials.push('Nylon');
    if (bioLower.includes('asa')) materials.push('ASA');
    if (bioLower.includes('resin')) materials.push('Resin');
    
    // Extract colors
    const colors = [];
    const colorMap = {
        'black': 'Black', 'white': 'White', 'red': 'Red', 'blue': 'Blue',
        'green': 'Green', 'yellow': 'Yellow', 'orange': 'Orange', 'purple': 'Purple',
        'gray': 'Gray', 'grey': 'Gray', 'pink': 'Pink', 'clear': 'Clear',
        'transparent': 'Clear', 'translucent': 'Clear'
    };
    
    for (const [key, value] of Object.entries(colorMap)) {
        if (bioLower.includes(key)) {
            if (!colors.includes(value)) colors.push(value);
        }
    }
    
    // Build filaments object
    if (materials.length > 0) {
        materials.forEach(mat => {
            if (colors.length > 0) {
                filaments[mat] = colors;
            } else {
                filaments[mat] = ['Black']; // default
            }
        });
    }
    
    // Extract printer model from first line
    let printerModel = 'Unknown';
    if (lines[0] && lines[0].length < 80) {
        printerModel = lines[0].trim();
    }
    
    return { printerModel, filaments, materials, colors };
}

// Load printer data from API
function loadPrinters(){
    // Use CORS proxy to avoid CORS issues
    const apiUrl = 'https://printlegion.hackclub.com/api/printers';
    const corsProxy = 'https://corsproxy.io/?';
    return fetch(corsProxy + encodeURIComponent(apiUrl))
        .then(r => r.json())
        .then(data => {
            printerData = data.map((p, idx) => {
                // Use city if provided, fallback to country
                const locationField = (p.city && p.city.trim()) ? p.city : p.country;
                const coords = countryCoords[locationField] || countryCoords[p.country] || {lat: 0, lng: 0};
                // Add small random offset to spread markers in same country
                const latOffset = (Math.random() - 0.3) * 8;
                const lngOffset = (Math.random() - 0.3) * 8;
                
                return {
                    name: p.nickname || 'Anonymous',
                    slackId: p.slack_id,
                    printerModel: (p.printerModel && p.printerModel.trim()) ? p.printerModel : null,
                    city: (p.city && p.city.trim()) ? p.city : null,
                    country: p.country || null,
                    website: p.website || 'hackclub.com',
                    profilePic: p.profile_pic,
                    bio: p.bio,
                    printSize: null,
                    filaments: (p.filaments && (Array.isArray(p.filaments) ? p.filaments.length > 0 : Object.keys(p.filaments).length > 0)) ? p.filaments : null,
                    lat: coords.lat + latOffset,
                    lng: coords.lng + lngOffset,
                    // gramsPrinted: Math.floor(Math.random() * 5000) + 500 // Random 500-5500g
                    gramsPrinted: 0,
                };
            });
            
            countPrinters();
            printerData.forEach(p => {
                drawMarker(p.lat, p.lng, p);
            });
        })
        .catch(err => console.error('Failed to load printer data from API', err));
}

function countPrinters(){
    const countEl = document.getElementsByClassName('plsubtitle')[0];
    if (countEl) {
        // Preserve the icon and update only the count
        const iconHtml = '<i class="fa-solid fa-circle online-indicator"></i> ';
        countEl.innerHTML = `${iconHtml}Currently listing ${printerData.length.toLocaleString()} printers worldwide!`;
    }
}
loadPrinters();


// Draws the location of the current user
function drawUser(lat, lng){
    const marker = L.marker([lat, lng]).addTo(map);
}
// "slack://user?team=E09V59WQY1E&id="

// for(let i = 0; i < 180; i += 10){
//     drawMarker(0,i)
// }


// Calculate distance between user and printer
function calcDistance(userLat, userLng, printerLat, printerLng) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(printerLat - userLat);
  const dLng = toRad(printerLng - userLng);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(userLat)) * Math.cos(toRad(printerLat)) *
    Math.sin(dLng/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c)/1000; // km
}

function findNearestPrinter(userLat, userLng){
    if (!printerData.length) return null;
    let best = null;
    let bestDist = Infinity;
    const active = filtersAreActive();
    for (const p of printerData) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
        if (active && !printerMatchesActiveFilters(p)) continue;
        const d = calcDistance(userLat, userLng, p.lat, p.lng);
        if (d < bestDist) {
            bestDist = d;
            best = { printer: p, distanceKm: d };
        }
    }
    return best;
}

// Get user location
const x = document.getElementsByClassName("locationWarning")[0];
function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(success, error);
    } else { 
        x.innerHTML = "⚠️ Location services are not supported by your browser"
    }
}

function success(position) {
    x.innerHTML = "✅ Location services enabled! Finding nearest printer..."
    let lat = position.coords.latitude
    let lng = position.coords.longitude
    userPosition = { lat, lng };
    drawUser(lat, lng)
    const nearest = findNearestPrinter(lat, lng);
    if (nearest) {
        if (filtersAreActive() && nearest.distanceKm > FAR_DISTANCE_KM) {
            x.innerHTML = `⚠️ Nearest matching printer is far (${nearest.distanceKm.toFixed(1)} km: ${nearest.printer.name}). Consider reducing filters to increase yield.`;
        } else {
            x.innerHTML = `✅ Nearest printer: ${nearest.printer.name} (${nearest.printer.printerModel}) – ${nearest.distanceKm.toFixed(1)} km away`;
        }
        // Find its marker and highlight
        const marker = printerMarkers.find(m => m.metadata === nearest.printer);
        highlightMarker(marker);
        hideNoResultsPopup();
    } else {
        if (filtersAreActive()) {
            x.innerHTML = '❌ No matching printers found.';
            showNoResultsPopup('No printers match your current filters. Try reducing filters to increase results.');
        } else {
            x.innerHTML = 'No printers loaded yet.';
            hideNoResultsPopup();
        }
    }

}

// Keep pinned label aligned after zoom/pan animations
map.on('moveend', () => {
    if (pinnedMarker) {
        drawLabel(pinnedMarker.metadata, { latlng: pinnedMarker.getLatLng() });
    }
});

// Clicking elsewhere on map unpins and hides label
map.on('click', (e) => {
    if (pinnedMarker) {
        const pm = pinnedMarker.getLatLng();
        const diff = Math.abs(pm.lat - e.latlng.lat) + Math.abs(pm.lng - e.latlng.lng);
        if (diff > 0.0005) { // clicked somewhere not exactly on the pinned marker
            pinnedMarker = null;
            hideLabel(true);
        }
    }
});

function error() {
    x.innerHTML = "⛔️ Location services are blocked"
}


