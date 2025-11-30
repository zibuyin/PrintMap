

// Initialize map
const map = L.map("map").setView([51, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Custom Benchy icon
const benchyIcon = L.icon({
    iconUrl: "assets/benchy.png",
    iconSize: [40, 33.5],
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
    const { name = "Unknown", contact = "N/A", printerModel = "N/A", city ="N/A", timesPrinted = 0, printSize, printVolume, filaments } = metadata || {};
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
            : '<div class="printVolume">Max Volume: N/A</div>';
        const filamentHtml = renderFilaments(filaments);
        let distanceHtml = '';
        if (userPosition && Number.isFinite(userPosition.lat) && Number.isFinite(userPosition.lng)) {
            const km = calcDistance(userPosition.lat, userPosition.lng, e.latlng.lat, e.latlng.lng);
            distanceHtml = `<div class="pinCard-meta">Distance: ${km.toFixed(1)} km</div>`;
        }
        hoverLabel.innerHTML = `
            <div class="pinCard">
                <div class="pinCard-header">
                    <div class="avatar">🏷️</div>
                    <div>
                        <div><strong>${name}</strong></div>
                        <div class="pinCard-meta">${printerModel}</div>
                    </div>
                </div>
                <div class="pinCard-body">
                    <div>Times Printed: ${timesPrinted}</div>
                    <div class="pinCard-meta">Location: ${city}</div>
                    ${distanceHtml}
                    ${volumeHtml}
                    <div class="pinCard-meta" style="margin-top:4px;">Filaments:</div>
                    ${filamentHtml}
                </div>
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
    // Use normal function to preserve 'this' = marker in handler
    marker.on('mouseover', function(e){
        drawLabel(this.metadata, e);
    });
    marker.on('mouseout', function(){
        ensureHoverLabel();
        if (hideTimer) { clearTimeout(hideTimer); }
        hideTimer = setTimeout(() => {
            if (!hoveringLabel) hoverLabel.style.display = 'none';
        }, 100);
    });
    return marker;
}

// Demo marker with metadata stored on the marker



drawMarker(51, 0, {
    name: 'Nathan Yin',
    slackId: 'D08HYM1KGRG', // The Slack ID of the printer
    printerModel: 'BambuLab X1C',
    city: 'Cambridge',
    website: 'google.com',
    printSize: [255, 255, 255], // X,Y,Z max size in mm
    filaments: {
        'PLA': ['Orange', 'White', 'Black'],
        'ABS': 'Orange',
        'PETG': ['Red']
    },
    timesPrinted: 1
});


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

}

function error() {
    x.innerHTML = "⛔️ Location services are blocked"
}


