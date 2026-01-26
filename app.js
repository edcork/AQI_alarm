// --- CONFIGURATION ---
let alarms = []; 
let selectedDays = []; 
let timeFormat = "24h";
let currentAQIStandard = "US";
let currentTheme = "dark"; 
let locations = [];
let currentLocIndex = 0;
let tempSelectedLocation = null;
let editingAlarmIndex = null; 

let isAlarmLocationSearch = false;
let adHocLocations = new Set(); 
let lastDropdownIndex = 0;

// Track what is ringing for Snooze
let currentRingingAlarm = null;

// --- API CONFIGURATION ---
const WAQI_TOKEN = "da26d3ac784af6fd3950dd9958e7a1df4e8f12b6"; 
const API = {
    GEO: "https://geocoding-api.open-meteo.com/v1/search",
    AIR_METEO: "https://air-quality-api.open-meteo.com/v1/air-quality",
    AIR_WAQI: "https://api.waqi.info/feed"
};

// --- SOUND ENGINE (Web Audio API) ---
class SoundEngine {
    constructor() {
        this.ctx = null;
        this.osc = null;
        this.interval = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    play(type) {
        this.stop(); 
        this.init(); 
        
        switch (type) {
            case 'radar': this.playRadar(); break;
            case 'beacon': this.playBeacon(); break;
            case 'chime': this.playChime(); break;
            case 'siren': this.playSiren(); break;
            default: this.playRadar();
        }
    }

    stop() {
        if (this.osc) {
            try { this.osc.stop(); } catch(e) {}
            this.osc = null;
        }
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    playRadar() {
        const beep = () => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
            osc.type = 'square';
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.1);
        };
        beep();
        let count = 0;
        this.interval = setInterval(() => {
            count++;
            if (count % 8 === 0 || count % 8 === 1 || count % 8 === 2) beep();
        }, 150);
    }

    playBeacon() {
        const ping = () => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(440, this.ctx.currentTime);
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5);
            osc.start();
            osc.stop(this.ctx.currentTime + 1.5);
        };
        ping();
        this.interval = setInterval(ping, 2000);
    }

    playChime() {
        const chord = () => {
            [330, 440, 554].forEach(freq => { 
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'triangle';
                gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2);
                osc.start();
                osc.stop(this.ctx.currentTime + 2);
            });
        };
        chord();
        this.interval = setInterval(chord, 3000);
    }

    playSiren() {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        gain.gain.value = 0.1;
        osc.start();
        this.osc = osc;
        
        let up = true;
        this.interval = setInterval(() => {
            if (up) {
                osc.frequency.linearRampToValueAtTime(800, this.ctx.currentTime + 0.5);
                setTimeout(()=> up=false, 500);
            } else {
                osc.frequency.linearRampToValueAtTime(400, this.ctx.currentTime + 0.5);
                setTimeout(()=> up=true, 500);
            }
        }, 600);
    }
}

const audio = new SoundEngine();

// --- INITIALIZATION ---
async function initData() {
    if (locations.length === 0) {
        await fetchAndAddLocation("Shanghai", true);
    }
    setInterval(checkAlarms, 1000);
}

// --- UTILITY ---
function getStandardMax(standard) {
    if (standard === 'UK') return 10;
    return 500;
}

function convertAQIToRaw(aqi) {
    if (aqi <= 50) return (aqi / 50) * 12;
    if (aqi <= 100) return 12 + ((aqi - 50) / 50) * (35.4 - 12);
    if (aqi <= 150) return 35.5 + ((aqi - 100) / 50) * (55.4 - 35.5);
    if (aqi <= 200) return 55.5 + ((aqi - 150) / 50) * (150.4 - 55.5);
    if (aqi <= 300) return 150.5 + ((aqi - 200) / 100) * (250.4 - 150.5);
    if (aqi <= 400) return 250.5 + ((aqi - 300) / 100) * (350.4 - 250.5);
    return 350.5 + ((aqi - 400) / 100) * (500.4 - 350.5);
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

        const [waqiResult, meteoResult] = await Promise.allSettled([
            fetch(`${API.AIR_WAQI}/geo:${lat};${lon}/?token=${WAQI_TOKEN}`),
            fetch(`${API.AIR_METEO}?latitude=${lat}&longitude=${lon}&current=pm2_5&hourly=pm2_5&timezone=${userTimezone}&timeformat=unixtime`)
        ]);

        let rawCurrentPM25 = 0;
        let lastUpdatedTime = new Date();
        let forecastData = [];
        let waqiSuccess = false;
        
        if (waqiResult.status === 'fulfilled') {
            const waqiData = await waqiResult.value.json();
            if (waqiData.status === 'ok' && waqiData.data.iaqi && waqiData.data.iaqi.pm25) {
                rawCurrentPM25 = waqiData.data.iaqi.pm25.v;
                waqiSuccess = true;
                if (waqiData.data.time && waqiData.data.time.s) {
                    lastUpdatedTime = new Date(waqiData.data.time.s); 
                }
            }
        }

        if (meteoResult.status === 'fulfilled') {
            const meteoData = await meteoResult.value.json();
            if (!waqiSuccess && meteoData.current) {
                rawCurrentPM25 = meteoData.current.pm2_5;
                lastUpdatedTime = new Date(meteoData.current.time * 1000);
            }
            const rawForecastPM25 = meteoData.hourly.pm2_5;
            const currentHourIndex = new Date().getHours(); 
            for (let i = 0; i < 24; i++) {
                const idx = currentHourIndex + i;
                if (idx < rawForecastPM25.length) {
                    forecastData.push({
                        rawVal: rawForecastPM25[idx],
                        hour: (currentHourIndex + i) % 24
                    });
                }
            }
        }

        const formattedTime = lastUpdatedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: (timeFormat === '12h') });

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
        console.error("Critical API Error", e);
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
    setTimeout(() => { spinner.classList.remove('visible'); }, 500);
}

// --- ALARM CHECK LOGIC ---
let lastCheckedMinute = null; 

function checkAlarms() {
    const now = new Date();
    const currentMinuteStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); 
    
    if (lastCheckedMinute === currentMinuteStr) return;
    lastCheckedMinute = currentMinuteStr;

    const dayName = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][now.getDay()];

    alarms.forEach((alarm, index) => {
        if (!alarm.active) return;

        if (alarm.time !== currentMinuteStr) return;
        if (!alarm.repeat.includes("Never") && !alarm.repeat.includes(dayName)) return;

        let locData = null;
        if (alarm.location.includes("Current")) {
            locData = locations.find(l => l.isCurrent);
        } else {
            locData = locations.find(l => l.name === alarm.location);
        }

        if (!locData) return;

        const currentAQI = calculateAQI(locData.rawCurrentPM25, currentAQIStandard);
        const threshold = parseInt(alarm.conditions[0].value);
        const op = alarm.conditions[0].operator; 

        let conditionMet = false;
        if (op === 'lt' && currentAQI < threshold) conditionMet = true;
        if (op === 'gt' && currentAQI > threshold) conditionMet = true;

        if (conditionMet) {
            triggerAlarm(alarm, currentAQI, locData.name);
            
            if (alarm.repeat.includes("Never")) {
                alarm.active = false;
                renderAlarms(); 
            }
        }
    });
}

function triggerAlarm(alarm, aqiVal, locName) {
    currentRingingAlarm = alarm; // Save for snooze logic
    audio.play(alarm.sound);

    const overlay = document.getElementById('ring-overlay');
    document.getElementById('ring-label').innerText = alarm.label || "Alarm";
    document.getElementById('ring-condition').innerText = `AQI is ${aqiVal}`;
    document.getElementById('ring-location').innerText = locName;
    document.getElementById('ring-time').innerText = alarm.time;
    
    const badge = document.getElementById('ring-aqi-badge');
    badge.innerText = getStatus(aqiVal, currentAQIStandard);
    badge.style.backgroundColor = getColor(aqiVal, currentAQIStandard);

    // Show/Hide Snooze Button based on config
    const snoozeBtn = document.getElementById('btn-snooze');
    // If undefined (legacy alarms), default to enabled/false? Let's default to disabled if missing
    if (alarm.snoozeEnabled) {
        snoozeBtn.style.display = 'block';
    } else {
        snoozeBtn.style.display = 'none';
    }

    overlay.style.display = 'flex';
}

function stopAlarm() {
    audio.stop();
    currentRingingAlarm = null;
    document.getElementById('ring-overlay').style.display = 'none';
}

// --- NEW SNOOZE LOGIC ---
function snoozeAlarm() {
    if (!currentRingingAlarm) return;

    // Get Duration (default 9)
    const duration = currentRingingAlarm.snoozeDuration ? parseInt(currentRingingAlarm.snoozeDuration) : 9;
    const now = new Date();
    now.setMinutes(now.getMinutes() + duration);
    const snoozeTimeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    // Conditional vs Unconditional
    // If Retain Settings is true: Copy existing conditions
    // If Retain Settings is false: Force trigger (AQI > -1)
    let newConditions = [];
    if (currentRingingAlarm.snoozeRetainSettings) {
        newConditions = [...currentRingingAlarm.conditions];
    } else {
        newConditions = [{ metric: 'aqi', operator: 'gt', value: -1 }];
    }

    const snoozeAlarmObj = {
        time: snoozeTimeStr,
        label: "Snoozing: " + (currentRingingAlarm.label || "Alarm"),
        location: currentRingingAlarm.location,
        conditions: newConditions,
        repeat: ["Never"],
        sound: currentRingingAlarm.sound,
        active: true,
        snoozeEnabled: true, // Allow re-snoozing
        snoozeDuration: duration,
        snoozeRetainSettings: currentRingingAlarm.snoozeRetainSettings
    };

    alarms.push(snoozeAlarmObj);
    renderAlarms();
    stopAlarm(); 
}

// --- UI HELPER FOR SNOOZE OPTIONS ---
function toggleSnoozeOptions() {
    const toggle = document.getElementById('new-snooze-toggle');
    const options = document.getElementById('snooze-options');
    if (toggle.checked) {
        options.style.display = 'block';
    } else {
        options.style.display = 'none';
    }
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
    renderSettingsLocations();
}

// --- UI HELPERS ---
function updateLocationDropdown() {
    const select = document.getElementById('new-location-select');
    if (!select) return;
    let html = '';
    html += locations.map(loc => {
        const label = loc.isCurrent ? `${loc.name} (Current)` : loc.name;
        return `<option value="${loc.name}">${label}</option>`;
    }).join('');
    adHocLocations.forEach(name => {
        const exists = locations.some(l => l.name === name);
        if (!exists) {
            html += `<option value="${name}">${name}</option>`;
        }
    });
    html += `<option value="search_new" style="font-weight:bold; color:var(--accent-color);">+ Search New Location</option>`;
    select.innerHTML = html;
}

function handleLocationSelectChange(select) {
    if (select.value === 'search_new') {
        lastDropdownIndex = select.options.length - 1; 
        isAlarmLocationSearch = true;
        openLocationSearch();
    } else {
        lastDropdownIndex = select.selectedIndex;
    }
}

function updateTheme(isDark) {
    if (isDark) {
        currentTheme = "dark";
        document.documentElement.removeAttribute('data-theme');
    } else {
        currentTheme = "light";
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

function updateAQIStandard(newStd) {
    currentAQIStandard = newStd;
    renderDashboard(); 
}

function updateTimeFormat(val) {
    timeFormat = val;
    refreshAllLocations();
}

let touchStartY = 0;
let isRefreshing = false;
const dashArea = document.getElementById('aqi-area');

dashArea.addEventListener('touchstart', (e) => { 
    if (dashArea.scrollTop === 0) { touchStartY = e.touches[0].clientY; }
    carouselStartX = e.touches[0].clientX;
});

dashArea.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    if (touchStartY > 0 && y > touchStartY + 50 && !isRefreshing && dashArea.scrollTop === 0) {
        isRefreshing = true;
        refreshAllLocations().then(() => { isRefreshing = false; touchStartY = 0; });
    }
});

let carouselStartX = 0;
dashArea.addEventListener('touchend', (e) => {
    if (isRefreshing) return;
    const diff = e.changedTouches[0].clientX - carouselStartX;
    if (diff > 50 && currentLocIndex > 0) { currentLocIndex--; renderDashboard(); }
    else if (diff < -50 && currentLocIndex < locations.length - 1) { currentLocIndex++; renderDashboard(); }
});

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
    
    if (isAlarmLocationSearch) {
        const name = tempSelectedLocation.name;
        adHocLocations.add(name);
        updateLocationDropdown();
        const select = document.getElementById('new-location-select');
        select.value = name;
        isAlarmLocationSearch = false;
        closeLocationSearch();
    } else {
        await fetchAndAddLocation(tempSelectedLocation.name, false, tempSelectedLocation.lat, tempSelectedLocation.lon);
        closeLocationSearch();
    }
}

function closeLocationSearch() { 
    document.getElementById('location-modal').style.display = 'none'; 
    if (isAlarmLocationSearch) {
        const select = document.getElementById('new-location-select');
        if (select) select.selectedIndex = 0;
        isAlarmLocationSearch = false;
    }
}

function openSettings() { renderSettingsLocations(); document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function openAddMenu() { document.getElementById('menu-modal').style.display = 'block'; }
function closeAddMenu() { document.getElementById('menu-modal').style.display = 'none'; }
function selectMenuOption(opt) { 
    closeAddMenu(); 
    if (opt === 'alarm') openAddAlarm(); 
    else {
        isAlarmLocationSearch = false;
        openLocationSearch();
    }
}

function openAddAlarm() {
    selectedDays = []; 
    editingAlarmIndex = null;
    document.getElementById('modal-title').innerText = "New Alarm";
    document.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));
    
    audio.init();

    updateLocationDropdown();
    
    document.getElementById('new-time').value = "07:00";
    document.getElementById('new-label').value = ""; 
    document.getElementById('new-aqi').value = "100";
    document.getElementById('new-aqi-op').value = "lt"; 
    document.getElementById('new-sound').value = "radar";
    
    // Reset Snooze Fields
    document.getElementById('new-snooze-toggle').checked = false;
    document.getElementById('new-snooze-duration').value = "9";
    document.getElementById('new-snooze-retain').checked = true;
    toggleSnoozeOptions();

    const locSelect = document.getElementById('new-location-select');
    if (locSelect.options.length > 0) locSelect.selectedIndex = 0;

    document.getElementById('add-modal').style.display = 'flex';
}

function openEditAlarm(index) {
    editingAlarmIndex = index;
    const alarm = alarms[index];
    document.getElementById('modal-title').innerText = "Edit Alarm";
    
    audio.init();

    const locExists = locations.some(l => l.name === alarm.location);
    if (!locExists) {
        adHocLocations.add(alarm.location);
    }
    updateLocationDropdown();

    document.getElementById('new-time').value = alarm.time;
    document.getElementById('new-label').value = alarm.label;
    document.getElementById('new-location-select').value = alarm.location;
    document.getElementById('new-aqi-op').value = alarm.conditions[0].operator;
    document.getElementById('new-aqi').value = alarm.conditions[0].value;
    document.getElementById('new-sound').value = alarm.sound;

    // Populate Snooze Fields
    document.getElementById('new-snooze-toggle').checked = !!alarm.snoozeEnabled;
    document.getElementById('new-snooze-duration').value = alarm.snoozeDuration || 9;
    document.getElementById('new-snooze-retain').checked = (alarm.snoozeRetainSettings !== false); // Default true
    toggleSnoozeOptions();

    selectedDays = alarm.repeat.includes("Never") ? [] : [...alarm.repeat];
    document.querySelectorAll('.day-btn').forEach(btn => {
        const day = btn.getAttribute('data-day');
        if (selectedDays.includes(day)) btn.classList.add('selected');
        else btn.classList.remove('selected');
    });

    closeAddMenu();
    document.getElementById('add-modal').style.display = 'flex';
}

function closeAddAlarm() { document.getElementById('add-modal').style.display = 'none'; }
function openLocationSearch() {
    document.getElementById('loc-search-input').value = ""; 
    document.getElementById('search-results').innerHTML = "";
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
    const timeVal = document.getElementById('new-time').value;
    const aqiVal = document.getElementById('new-aqi').value;
    const locVal = document.getElementById('new-location-select').value;

    if (!timeVal || !aqiVal) {
        alert("Please set a time and AQI threshold.");
        return;
    }
    
    if (locVal === 'search_new') {
        alert("Please select a valid location.");
        return;
    }

    const alarmData = { 
        time: timeVal, 
        label: document.getElementById('new-label').value, 
        location: locVal, 
        conditions: [{ metric: 'aqi', operator: document.getElementById('new-aqi-op').value, value: aqiVal }], 
        repeat: selectedDays.length === 0 ? ["Never"] : [...selectedDays], 
        sound: document.getElementById('new-sound').value,
        active: true,
        // Save New Snooze Config
        snoozeEnabled: document.getElementById('new-snooze-toggle').checked,
        snoozeDuration: parseInt(document.getElementById('new-snooze-duration').value) || 9,
        snoozeRetainSettings: document.getElementById('new-snooze-retain').checked
    };

    if (editingAlarmIndex !== null) {
        alarms[editingAlarmIndex] = alarmData;
    } else {
        alarms.push(alarmData);
    }

    renderAlarms(); 
    renderDashboard(); 
    closeAddAlarm();
}

function toggleAlarm(index) { alarms[index].active = !alarms[index].active; renderDashboard(); }

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
            <div class="alarm-swipe-actions">
                <button class="swipe-btn edit" onclick="openEditAlarm(${index})">Edit</button>
                <button class="swipe-btn delete" onclick="deleteAlarm(${index})">
                    <svg class="trash-icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
            <div class="alarm-row-content" id="row-${index}"
                    ontouchstart="handleAlarmTouchStart(event, ${index})"
                    ontouchmove="handleAlarmTouchMove(event, ${index})"
                    ontouchend="handleAlarmTouchEnd(event, ${index})">
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

let alarmTouchStartX = 0;
let alarmCurrentSwipeIndex = -1;

function handleAlarmTouchStart(e, index) {
    alarmTouchStartX = e.touches[0].clientX;
    alarmCurrentSwipeIndex = index;
    document.querySelectorAll('.alarm-row-content').forEach(row => {
        if(row.id !== `row-${index}`) row.style.transform = `translateX(0px)`;
    });
}

function handleAlarmTouchMove(e, index) {
    if (alarmCurrentSwipeIndex !== index) return;
    const diff = e.touches[0].clientX - alarmTouchStartX;
    const row = document.getElementById(`row-${index}`);
    if (diff < 0 && diff > -160) {
        row.style.transform = `translateX(${diff}px)`;
    }
}

function handleAlarmTouchEnd(e, index) {
    const row = document.getElementById(`row-${index}`);
    const diff = e.changedTouches[0].clientX - alarmTouchStartX;
    if (diff < -60) {
        row.style.transform = `translateX(-150px)`; 
    } else {
        row.style.transform = `translateX(0px)`; 
    }
}

function deleteAlarm(index) { 
    alarms.splice(index, 1); 
    renderAlarms(); 
    renderDashboard(); 
}

function formatDays(days) { return days.includes("Never") ? "Once" : (days.length === 7 ? "Daily" : days.map(d => d.slice(0, 3)).join(", ")); }

initData();
renderAlarms();