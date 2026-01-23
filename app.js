// --- CONFIGURATION ---
let alarms = []; 
let selectedDays = []; // Changed default: Empty means "Once" (Never) in UI
let timeFormat = "24h";
let currentAQIStandard = "US";
let locations = [];
let currentLocIndex = 0;
let tempSelectedLocation = null;

// Open-Meteo Endpoints
const API = {
    GEO: "https://geocoding-api.open-meteo.com/v1/search",
    AIR: "https://air-quality-api.open-meteo.com/v1/air-quality"
};

// --- INITIALIZATION ---
async function initData() {
    if (locations.length === 0) {
        await fetchAndAddLocation("Shanghai", true);
    }
}

// --- UTILITY: STANDARDS & CALCULATION ---
function getStandardMax(standard) {
    if (standard === 'UK') return 10;
    return 500;
}

function calculateAQI(pm25, standard = 'US') {
    const breakpoints = {
        'US': [[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,350.4,301,400],[350.5,500.4,401,500]],
        'CN': [[0,35,0,50],[35,75,51,100],[75,115,101,150],[115,150,151,200],[150,250,201,300],[250,350,301,400],[350,500,401,500]],
        'UK': [[0,11,1,1],[12,23,2,2],[24,35,3,3],[36,41,4,4],[42,47,5,5],[48,53,6,6],[54,58,7,7],[59,64,8,8],[65,70,9,9],[71,1000,10,10]],
        'IN': [[0,30,0,50],[31,60,51,100],[61,90,101,200],[91,120,201,300],[121,250,301,400],[250,999,401,500]]
    };

    const std = breakpoints[standard] || breakpoints['US'];
    for (let i = 0; i < std.length; i++) {
        const [cLow, cHigh, iLow, iHigh] = std[i];
        if (pm25 >= cLow && pm25 <= cHigh) {
            return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (pm25 - cLow) + iLow);
        }
    }
    return standard === 'UK' ? 10 : 500;
}

function getStatus(aqi, standard = 'US') {
    if (standard === 'UK') {
        if (aqi <= 3) return "Low";
        if (aqi <= 6) return "Moderate";
        if (aqi <= 9) return "High";
        return "Very High";
    }
    if (aqi <= 50) return "Good";
    if (aqi <= 100) return "Moderate";
    if (aqi <= 150) return "Unhealthy (Sens.)";
    if (aqi <= 200) return "Unhealthy";
    if (aqi <= 300) return "Very Unhealthy";
    return "Hazardous";
}

function getColor(aqi, standard = 'US') {
    if (standard === 'UK') {
        if (aqi <= 3) return "var(--success-color)";
        if (aqi <= 6) return "var(--aqi-unhealthy)";
        if (aqi <= 9) return "var(--danger-color)";
        return "#8f3f97";
    }
    if (aqi <= 50) return "var(--success-color)";
    if (aqi <= 100) return "var(--aqi-moderate)";
    if (aqi <= 150) return "var(--aqi-unhealthy)";
    if (aqi <= 200) return "var(--danger-color)";
    if (aqi <= 300) return "#8f3f97";
    return "#7e0023";
}

// --- DATA FETCHING ---
async function fetchAndAddLocation(name, isCurrent, lat = null, lon = null) {
    try {
        if (lat === null || lon === null) {
            const geoRes = await fetch(`${API.GEO}?name=${name}&count=1&language=en&format=json`);
            const geoData = await geoRes.json();
            if (!geoData.results || geoData.results.length === 0) return;
            lat = geoData.results[0].latitude;
            lon = geoData.results[0].longitude;
            name = geoData.results[0].name;
        }

        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const airRes = await fetch(`${API.AIR}?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,ozone&hourly=pm2_5&timezone=${userTimezone}&timeformat=unixtime`);
        const airData = await airRes.json();

        // Data Extraction
        const rawCurrentPM25 = airData.current.pm2_5;
        const rawForecastPM25 = airData.hourly.pm2_5;
        const dateObj = new Date(airData.current.time * 1000);
        const formattedTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: (timeFormat === '12h') });

        const currentHourIndex = new Date().getHours(); 
        const forecastData = [];
        for (let i = 0; i < 24; i++) {
            const idx = currentHourIndex + i;
            if (idx < rawForecastPM25.length) {
                forecastData.push({
                    rawVal: rawForecastPM25[idx],
                    hour: (currentHourIndex + i) % 24
                });
            }
        }

        const newLoc = {
            name: name,
            rawCurrentPM25: rawCurrentPM25,
            rawForecast: forecastData,
            pollutant: "PM2.5",
            time: formattedTime,
            isCurrent: isCurrent,
            lat: lat,
            lon: lon
        };

        if(isCurrent) locations.unshift(newLoc);
        else locations.push(newLoc);

        if (!isCurrent) currentLocIndex = locations.length - 1;
        
        renderDashboard();

    } catch (e) {
        console.error("API Error", e);
    }
}

async function refreshAllLocations() {
    const spinner = document.getElementById('refresh-spinner');
    spinner.classList.add('visible');

    const oldLocations = [...locations];
    locations = []; 
    
    for (let loc of oldLocations) {
        await fetchAndAddLocation(loc.name, loc.isCurrent, loc.lat, loc.lon);
    }

    setTimeout(() => {
        spinner.classList.remove('visible');
    }, 500);
}

// --- RENDER DASHBOARD ---
function renderDashboard() {
    const slider = document.getElementById('dashboard-slider');
    const dots = document.getElementById('dots-container');
    
    if (locations.length === 0) {
        slider.innerHTML = "<div class='dashboard-slide' style='justify-content:center'>Loading...</div>";
        return;
    }

    slider.innerHTML = locations.map(loc => {
        const currentAQI = calculateAQI(loc.rawCurrentPM25, currentAQIStandard);
        const status = getStatus(currentAQI, currentAQIStandard);
        const color = getColor(currentAQI, currentAQIStandard);
        
        const iconHtml = loc.isCurrent 
            ? `<svg class="location-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path></svg>` 
            : '';

        const maxVal = getStandardMax(currentAQIStandard);

        const barsHtml = loc.rawForecast.map((d, i) => {
            const val = calculateAQI(d.rawVal, currentAQIStandard);
            const col = getColor(val, currentAQIStandard);
            const h = Math.min((val / maxVal) * 100, 100);

            let timeLabel = "";
            if (i % 4 === 0) { 
                if (timeFormat === '24h') {
                    timeLabel = (d.hour < 10 ? '0' : '') + d.hour + ":00";
                } else {
                    const suffix = d.hour >= 12 ? 'PM' : 'AM';
                    const h12 = d.hour % 12 || 12;
                    timeLabel = h12 + "" + suffix;
                }
            }

            const hasActiveAlarm = alarms.some(a => a.active && parseInt(a.time.split(':')[0]) === d.hour);
            const markerHtml = hasActiveAlarm 
                ? `<svg class="alarm-marker-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z"/></svg>` 
                : '';

            return `
                <div class="forecast-column">
                    <div class="forecast-icon-area">${markerHtml}</div>
                    <div class="forecast-bar-area">
                        <div class="forecast-bar" style="height: ${h}%; background-color: ${col};"></div>
                    </div>
                    <div class="forecast-time">
                        ${timeLabel ? `<span>${timeLabel}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
        <div class="dashboard-slide">
            <div class="aqi-location-row">${iconHtml}<div class="aqi-location">${loc.name}</div></div>
            <div class="aqi-value" style="color: ${color}">${currentAQI}</div>
            <div class="aqi-status" style="color: ${color}">${status}</div>
            <div class="aqi-details">
                <span>Major pollutant: ${loc.pollutant}</span><span>•</span><span>Last updated: ${loc.time}</span>
            </div>
            <div class="forecast-title">24H FORECAST</div>
            <div class="forecast-container">
                ${barsHtml}
            </div>
        </div>
    `}).join('');

    dots.innerHTML = locations.map((_, i) => `<div class="dot ${i === currentLocIndex ? 'active' : ''}"></div>`).join('');
    slider.style.transform = `translateX(-${currentLocIndex * 100}%)`;
    
    updateLocationDropdown();
    renderSettingsLocations();
}

// --- UI HELPERS ---
function updateLocationDropdown() {
    const select = document.getElementById('new-location-select');
    if (!select) return;
    
    if (locations.length === 0) {
        select.innerHTML = '<option disabled>Loading locations...</option>';
        return;
    }

    select.innerHTML = locations.map(loc => {
        const label = loc.isCurrent ? `${loc.name} (Current)` : loc.name;
        return `<option value="${loc.name}">${label}</option>`;
    }).join('');
}

function updateAQIStandard(newStd) {
    currentAQIStandard = newStd;
    renderDashboard(); 
}

function updateTimeFormat(val) {
    timeFormat = val;
    refreshAllLocations();
}

// --- TOUCH HANDLING ---
let touchStartY = 0;
let isRefreshing = false;
const dashArea = document.getElementById('aqi-area');

dashArea.addEventListener('touchstart', (e) => { 
    if (dashArea.scrollTop === 0) {
        touchStartY = e.touches[0].clientY; 
    }
    carouselStartX = e.touches[0].clientX;
});

dashArea.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    if (touchStartY > 0 && y > touchStartY + 50 && !isRefreshing && dashArea.scrollTop === 0) {
        isRefreshing = true;
        refreshAllLocations().then(() => {
            isRefreshing = false;
            touchStartY = 0;
        });
    }
});

let carouselStartX = 0;
dashArea.addEventListener('touchend', (e) => {
    if (isRefreshing) return;
    const diff = e.changedTouches[0].clientX - carouselStartX;
    if (diff > 50 && currentLocIndex > 0) { currentLocIndex--; renderDashboard(); }
    else if (diff < -50 && currentLocIndex < locations.length - 1) { currentLocIndex++; renderDashboard(); }
});

// --- SEARCH & MENU ---
let searchTimeout;
function handleSearch(e) {
    const val = e.target.value;
    const resultsDiv = document.getElementById('search-results');
    tempSelectedLocation = null; 
    clearTimeout(searchTimeout);
    if (val.length < 3) { resultsDiv.innerHTML = ""; return; }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API.GEO}?name=${val}&count=5&language=en&format=json`);
            const data = await res.json();
            if(data.results) {
                resultsDiv.innerHTML = data.results.map((city, index) => `
                    <div id="search-item-${index}" class="search-item" onclick="selectLocation(${index}, '${city.name.replace(/'/g, "\\'")}', ${city.latitude}, ${city.longitude})">
                        <div class="search-item-city">${city.name}</div>
                        <div class="search-item-country">${city.country}</div>
                    </div>
                `).join('');
            }
        } catch(e) { console.log(e); }
    }, 500);
}

function selectLocation(index, name, lat, lon) {
    document.querySelectorAll('.search-item').forEach(el => el.classList.remove('selected'));
    document.getElementById(`search-item-${index}`).classList.add('selected');
    tempSelectedLocation = { name, lat, lon };
}

async function confirmAddLocation() {
    if (!tempSelectedLocation) { alert("Please select a location first."); return; }
    await fetchAndAddLocation(tempSelectedLocation.name, false, tempSelectedLocation.lat, tempSelectedLocation.lon);
    closeLocationSearch();
}

function closeLocationSearch() { document.getElementById('location-modal').style.display = 'none'; }
function openSettings() { renderSettingsLocations(); document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function openAddMenu() { document.getElementById('menu-modal').style.display = 'block'; }
function closeAddMenu() { document.getElementById('menu-modal').style.display = 'none'; }
function selectMenuOption(opt) { closeAddMenu(); opt === 'alarm' ? openAddAlarm() : openLocationSearch(); }

function openAddAlarm() {
    // 1. Reset Arrays & UI
    selectedDays = []; 
    // Reset buttons
    document.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));
    
    updateLocationDropdown();
    
    document.getElementById('new-time').value = "07:00";
    document.getElementById('new-label').value = ""; 
    document.getElementById('new-aqi').value = "100";
    document.getElementById('new-aqi-op').value = "lt"; 
    document.getElementById('new-sound').value = "radar";
    
    const locSelect = document.getElementById('new-location-select');
    if (locSelect.options.length > 0) locSelect.selectedIndex = 0;

    document.getElementById('add-modal').style.display = 'flex';
}

function closeAddAlarm() { document.getElementById('add-modal').style.display = 'none'; }
function openLocationSearch() {
    document.getElementById('loc-search-input').value = ""; document.getElementById('search-results').innerHTML = "";
    document.getElementById('location-modal').style.display = 'flex';
}
function removeLocation(index) {
    const realIndex = index + 1; 
    if (realIndex >= locations.length) return;
    locations.splice(realIndex, 1);
    if (currentLocIndex >= locations.length) currentLocIndex = locations.length - 1;
    renderDashboard();
}
function renderSettingsLocations() {
    const container = document.getElementById('settings-location-list');
    const removableLocs = locations.slice(1);
    if (removableLocs.length === 0) {
        container.innerHTML = `<div class="settings-row" style="color: var(--text-secondary); font-size: 14px;">No added locations</div>`;
    } else {
        container.innerHTML = removableLocs.map((loc, i) => `
            <div class="settings-row">
                <span class="settings-label">${loc.name}</span>
                <button class="settings-delete-btn" onclick="removeLocation(${i})">Remove</button>
            </div>
        `).join('');
    }
}
function saveAlarm() {
    alarms.push({ 
        time: document.getElementById('new-time').value, 
        label: document.getElementById('new-label').value, 
        location: document.getElementById('new-location-select').value, 
        conditions: [{ metric: 'aqi', operator: document.getElementById('new-aqi-op').value, value: document.getElementById('new-aqi').value }], 
        repeat: selectedDays.length === 0 ? ["Never"] : [...selectedDays], // Fix empty array = Never
        sound: document.getElementById('new-sound').value,
        active: true 
    });
    renderAlarms(); 
    renderDashboard(); 
    closeAddAlarm();
}
function toggleAlarm(index) { alarms[index].active = !alarms[index].active; renderDashboard(); }

// --- NEW DAY TOGGLE LOGIC ---
function toggleDay(btn) {
    const day = btn.getAttribute('data-day');
    if (selectedDays.includes(day)) {
        selectedDays = selectedDays.filter(d => d !== day);
        btn.classList.remove('selected');
    } else {
        selectedDays.push(day);
        btn.classList.add('selected');
    }
}

function renderAlarms() {
    const listContainer = document.getElementById('alarm-list-container');
    listContainer.innerHTML = alarms.map((alarm, index) => {
        const cond = alarm.conditions[0];
        const op = cond.operator === 'gt' ? '>' : '<';
        return `
        <div class="alarm-container">
            <div class="alarm-delete-bg" onclick="deleteAlarm(${index})">Delete</div>
            <div class="alarm-row-content" id="row-${index}"
                    ontouchstart="handleTouchStart(event, ${index})"
                    ontouchmove="handleTouchMove(event, ${index})"
                    ontouchend="handleTouchEnd(event, ${index})">
                <div class="alarm-info">
                    <div class="alarm-top-line"><span class="alarm-time">${alarm.time}</span><span class="alarm-condition">AQI ${op} ${cond.value}</span></div>
                    ${alarm.label ? `<div class="alarm-label">${alarm.label}</div>` : ''}
                    <div class="alarm-details">${alarm.location} • ${formatDays(alarm.repeat)}</div>
                </div>
                <label class="switch">
                    <input type="checkbox" ${alarm.active ? 'checked' : ''} onchange="toggleAlarm(${index})">
                    <span class="slider"></span>
                </label>
            </div>
        </div>
    `}).join('');
}
function deleteAlarm(index) { alarms.splice(index, 1); renderAlarms(); renderDashboard(); }
function formatDays(days) { return days.includes("Never") ? "Once" : (days.length === 7 ? "Daily" : days.map(d => d.slice(0, 3)).join(", ")); }

initData();
renderAlarms();