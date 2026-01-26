// --- CONFIGURATION ---
let alarms = []; 
let selectedDays = []; 
let timeFormat = "24h";
let currentAQIStandard = "US";
let currentTheme = "dark"; 
let primaryIndex = "aqi"; // Default to overall AQI
let unitSystem = "metric"; // 'metric' or 'imperial'
let locations = [];
let currentLocIndex = 0;
let tempSelectedLocation = null;
let editingAlarmIndex = null; 

let isAlarmLocationSearch = false;
let adHocLocations = new Set(); 
let lastDropdownIndex = 0;
let currentRingingAlarm = null;

const WAQI_TOKEN = "da26d3ac784af6fd3950dd9958e7a1df4e8f12b6"; 
const API = {
    GEO: "https://geocoding-api.open-meteo.com/v1/search",
    AIR_METEO: "https://air-quality-api.open-meteo.com/v1/air-quality",
    WEATHER_METEO: "https://api.open-meteo.com/v1/forecast", 
    AIR_WAQI: "https://api.waqi.info/feed"
};

// --- SOUND ENGINE ---
class SoundEngine {
    constructor() { this.ctx = null; this.osc = null; this.interval = null; }
    init() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    play(type) {
        this.stop(); this.init(); 
        switch (type) {
            case 'radar': this.playRadar(); break;
            case 'beacon': this.playBeacon(); break;
            case 'chime': this.playChime(); break;
            case 'siren': this.playSiren(); break;
            default: this.playRadar();
        }
    }
    stop() {
        if (this.osc) { try { this.osc.stop(); } catch(e) {} this.osc = null; }
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
    }
    playRadar() {
        const beep = () => {
            const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(1200, this.ctx.currentTime); osc.type = 'square';
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
            osc.start(); osc.stop(this.ctx.currentTime + 0.1);
        };
        beep(); let count = 0;
        this.interval = setInterval(() => { count++; if (count % 8 === 0 || count % 8 === 1 || count % 8 === 2) beep(); }, 150);
    }
    playBeacon() {
        const ping = () => {
            const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(440, this.ctx.currentTime); osc.type = 'sine';
            gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5);
            osc.start(); osc.stop(this.ctx.currentTime + 1.5);
        };
        ping(); this.interval = setInterval(ping, 2000);
    }
    playChime() {
        const chord = () => {
            [330, 440, 554].forEach(freq => { 
                const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.frequency.value = freq; osc.type = 'triangle';
                gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2);
                osc.start(); osc.stop(this.ctx.currentTime + 2);
            });
        };
        chord(); this.interval = setInterval(chord, 3000);
    }
    playSiren() {
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth'; gain.gain.value = 0.1;
        osc.start(); this.osc = osc;
        let up = true;
        this.interval = setInterval(() => {
            if (up) { osc.frequency.linearRampToValueAtTime(800, this.ctx.currentTime + 0.5); setTimeout(()=> up=false, 500); } 
            else { osc.frequency.linearRampToValueAtTime(400, this.ctx.currentTime + 0.5); setTimeout(()=> up=true, 500); }
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

// --- UTILITY: DATA NORMALIZATION & DISPLAY ---
function getMetricDisplay(metric, val) {
    if (val === undefined || val === null) return { val: '-', unit: '', label: metric, color: '#888' };
    
    // Convert for Display
    let displayVal = val;
    let unit = '';
    
    if (metric === 'temp') {
        if (unitSystem === 'imperial') {
            displayVal = (val * 9/5) + 32;
            unit = '°F';
        } else {
            unit = '°C';
        }
    } else if (metric === 'wind') {
        if (unitSystem === 'imperial') {
            displayVal = val * 2.23694; // m/s to mph
            unit = 'mph';
        } else {
            unit = 'm/s';
        }
    }

    // Units Label Map
    const meta = {
        'aqi': { unit: '', label: 'AQI' },
        'pm25': { unit: 'PM2.5', label: 'PM2.5' },
        'pm10': { unit: 'PM10', label: 'PM10' },
        'no2': { unit: 'NO₂', label: 'NO₂' },
        'so2': { unit: 'SO₂', label: 'SO₂' },
        'o3': { unit: 'O₃', label: 'Ozone' },
        'co': { unit: 'CO', label: 'CO' },
        'temp': { unit: unit, label: 'Temp' }, 
        'wind': { unit: unit, label: 'Wind' },
        'humidity': { unit: '%', label: 'Humidity' }
    }[metric] || { unit: '', label: metric };

    // Get Color (Pass raw metric value for calculation logic)
    const color = getConditionColor(metric, val);

    return { val: Math.round(displayVal), unit: meta.unit, label: meta.label, color: color };
}

// --- NEW: CONDITION COLOR LOGIC (IDEAL RANGES) ---
function getConditionColor(metric, val) {
    if (['aqi', 'pm25', 'pm10', 'no2', 'so2', 'o3', 'co'].includes(metric)) {
        let v = val;
        if (metric !== 'aqi') v = calculateAQI(val); 
        return getColor(v, 'US'); 
    }
    
    if (metric === 'temp') {
        if (val >= 15 && val <= 25) return "var(--success-color)";
        if ((val >= 5 && val < 15) || (val > 25 && val <= 32)) return "var(--aqi-moderate)";
        return "var(--danger-color)";
    }
    
    if (metric === 'humidity') {
        if (val >= 40 && val <= 60) return "var(--success-color)";
        if ((val >= 30 && val < 40) || (val > 60 && val <= 80)) return "var(--aqi-moderate)";
        return "var(--danger-color)";
    }
    
    if (metric === 'wind') {
        if (val <= 5) return "var(--success-color)";
        if (val <= 10) return "var(--aqi-moderate)";
        return "var(--danger-color)";
    }

    return '#0A84FF'; 
}

function calculateAQI(pm25, standard = 'US') {
    if (pm25 === undefined || pm25 === null) return 0;
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
    if (aqi <= 50) return "Good";
    if (aqi <= 100) return "Moderate";
    if (aqi <= 150) return "Unhealthy (S)";
    if (aqi <= 200) return "Unhealthy";
    return "Hazardous";
}

function getColor(aqi, standard = 'US') {
    if (aqi <= 50) return "var(--success-color)";
    if (aqi <= 100) return "var(--aqi-moderate)";
    if (aqi <= 150) return "var(--aqi-unhealthy)";
    if (aqi <= 200) return "var(--danger-color)";
    return "#7e0023";
}

// --- DATA FETCHING (TRIPLE SOURCE) ---
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

        // Fetch 3 sources
        const [waqiRes, meteoAirRes, meteoWeatherRes] = await Promise.allSettled([
            fetch(`${API.AIR_WAQI}/geo:${lat};${lon}/?token=${WAQI_TOKEN}`),
            fetch(`${API.AIR_METEO}?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide&hourly=pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide&timezone=${userTimezone}&timeformat=unixtime`),
            fetch(`${API.WEATHER_METEO}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=${userTimezone}&timeformat=unixtime`)
        ]);

        let data = {
            name: name,
            isCurrent: isCurrent,
            lat: lat,
            lon: lon,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: (timeFormat === '12h')}),
            current: { aqi: 0 }, 
            forecast: {}
        };

        // 1. Process WAQI (Current Reality)
        if (waqiRes.status === 'fulfilled') {
            const w = await waqiRes.value.json();
            if (w.status === 'ok' && w.data.iaqi) {
                // Pollutants
                if(w.data.iaqi.pm25) data.current.pm25 = w.data.iaqi.pm25.v;
                if(w.data.iaqi.pm10) data.current.pm10 = w.data.iaqi.pm10.v;
                if(w.data.iaqi.no2) data.current.no2 = w.data.iaqi.no2.v;
                if(w.data.iaqi.so2) data.current.so2 = w.data.iaqi.so2.v;
                if(w.data.iaqi.o3) data.current.o3 = w.data.iaqi.o3.v;
                if(w.data.iaqi.co) data.current.co = w.data.iaqi.co.v;
                
                // Weather (Standardize to Metric internally: C, m/s)
                if(w.data.iaqi.t) data.current.temp = w.data.iaqi.t.v; // WAQI is C
                if(w.data.iaqi.w) data.current.wind = w.data.iaqi.w.v; // WAQI is m/s
                if(w.data.iaqi.h) data.current.humidity = w.data.iaqi.h.v;
            }
        }

        // 2. Process Meteo Air (Forecast)
        if (meteoAirRes.status === 'fulfilled') {
            const m = await meteoAirRes.value.json();
            // Fallback Current
            if(data.current.pm25 === undefined && m.current) data.current.pm25 = m.current.pm2_5;
            
            // Forecasts
            data.forecast.pm25 = m.hourly.pm2_5;
            data.forecast.pm10 = m.hourly.pm10;
            data.forecast.no2 = m.hourly.nitrogen_dioxide;
            data.forecast.so2 = m.hourly.sulphur_dioxide;
            data.forecast.o3 = m.hourly.ozone;
            data.forecast.co = m.hourly.carbon_monoxide;
            
            if (m.hourly.pm2_5) {
                data.forecast.aqi = m.hourly.pm2_5.map(v => calculateAQI(v, currentAQIStandard));
            }
        }

        // 3. Process Meteo Weather (Forecast)
        if (meteoWeatherRes.status === 'fulfilled') {
            const mw = await meteoWeatherRes.value.json();
            // Fallback Current
            if(data.current.temp === undefined && mw.current) data.current.temp = mw.current.temperature_2m;
            if(data.current.wind === undefined && mw.current) data.current.wind = mw.current.wind_speed_10m / 3.6; // Convert km/h to m/s
            if(data.current.humidity === undefined && mw.current) data.current.humidity = mw.current.relative_humidity_2m;

            // Forecasts
            data.forecast.temp = mw.hourly.temperature_2m;
            data.forecast.wind = mw.hourly.wind_speed_10m.map(v => v / 3.6); 
            data.forecast.humidity = mw.hourly.relative_humidity_2m;
        }

        // Calculate AQI
        if (data.current.pm25 !== undefined) {
            data.current.aqi = calculateAQI(data.current.pm25, currentAQIStandard);
        }

        if(isCurrent) locations.unshift(data);
        else locations.push(data);

        if (!isCurrent) currentLocIndex = locations.length - 1;
        renderDashboard();

    } catch (e) { console.error("API Error", e); }
}

async function refreshAllLocations() {
    const spinner = document.getElementById('refresh-spinner');
    if(spinner) spinner.classList.add('visible');
    
    const oldLocations = [...locations];
    locations = []; 
    for (let loc of oldLocations) {
        await fetchAndAddLocation(loc.name, loc.isCurrent, loc.lat, loc.lon);
    }
    if(spinner) setTimeout(() => { spinner.classList.remove('visible'); }, 500);
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
        const valObj = loc.current[primaryIndex] !== undefined ? loc.current[primaryIndex] : loc.current['aqi']; 
        const disp = getMetricDisplay(primaryIndex, valObj);
        
        const iconHtml = loc.isCurrent 
            ? `<svg class="location-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path></svg>` 
            : '';

        const forecastArr = loc.forecast[primaryIndex] || loc.forecast['aqi'] || [];
        
        let maxVal = 100; 
        if(primaryIndex === 'aqi') maxVal = 500;
        else if(primaryIndex === 'temp') maxVal = 40; 
        else if(primaryIndex === 'humidity') maxVal = 100;
        else if(primaryIndex === 'wind') maxVal = 20; 
        else if (forecastArr.length > 0) maxVal = Math.max(...forecastArr) || 100;

        const currentHourIndex = new Date().getHours(); 
        const barsHtml = [];
        
        for (let i = 0; i < 24; i++) {
            const idx = currentHourIndex + i;
            if (idx < forecastArr.length) {
                const val = forecastArr[idx];
                const h = Math.min((Math.max(val,0) / maxVal) * 100, 100); 
                
                const barColor = getConditionColor(primaryIndex, val);
                
                let timeLabel = "";
                const hour = (currentHourIndex + i) % 24;
                if (i % 4 === 0) { 
                    if (timeFormat === '24h') timeLabel = (hour < 10 ? '0' : '') + hour + ":00";
                    else { const suffix = hour >= 12 ? 'PM' : 'AM'; const h12 = hour % 12 || 12; timeLabel = h12 + "" + suffix; }
                }

                const hasActiveAlarm = alarms.some(a => a.active && parseInt(a.time.split(':')[0]) === hour);
                const markerHtml = hasActiveAlarm 
                    ? `<svg class="alarm-marker-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z"/></svg>` 
                    : '';

                barsHtml.push(`
                    <div class="forecast-column">
                        <div class="forecast-icon-area">${markerHtml}</div>
                        <div class="forecast-bar-area">
                            <div class="forecast-bar" style="height: ${h}%; background-color: ${barColor};"></div>
                        </div>
                        <div class="forecast-time">${timeLabel ? `<span>${timeLabel}</span>` : ''}</div>
                    </div>
                `);
            }
        }

        return `
        <div class="dashboard-slide">
            <div class="aqi-location-row">${iconHtml}<div class="aqi-location">${loc.name}</div></div>
            <div class="aqi-value" style="color: ${disp.color}">${disp.val}<span style="font-size:30px; margin-left:5px;">${disp.unit}</span></div>
            <div class="aqi-status" style="color: ${disp.color}">${disp.label}</div>
            <div class="aqi-details">
                <span>Last updated: ${loc.time}</span>
            </div>
            <div class="forecast-title">24H FORECAST</div>
            <div class="forecast-container">
                ${barsHtml.join('')}
            </div>
        </div>
    `}).join('');

    dots.innerHTML = locations.map((_, i) => `<div class="dot ${i === currentLocIndex ? 'active' : ''}"></div>`).join('');
    slider.style.transform = `translateX(-${currentLocIndex * 100}%)`;
    renderSettingsLocations();
}

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

function updateTempUnit(val) {
    unitSystem = val;
    renderDashboard();
}

function updatePrimaryIndex(val) {
    primaryIndex = val;
    renderDashboard();
}

// --- TOUCH & UI BOILERPLATE ---
let touchStartX = 0;
let touchStartY = 0;
let isRefreshing = false;
const dashArea = document.getElementById('aqi-area');
const slider = document.getElementById('dashboard-slider'); 

const refreshContainer = document.createElement('div');
refreshContainer.className = 'refresh-container';
refreshContainer.innerHTML = '<svg viewBox="0 0 50 50" class="spinner-icon"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"></circle></svg>';
dashArea.insertBefore(refreshContainer, slider);

dashArea.addEventListener('touchstart', (e) => { 
    if (dashArea.scrollTop === 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
});

dashArea.addEventListener('touchmove', (e) => {
    if (isRefreshing) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const diffX = x - touchStartX;
    const diffY = y - touchStartY;
    if (Math.abs(diffX) > Math.abs(diffY)) return; 
    if (diffY > 0 && dashArea.scrollTop === 0) {
        if (e.cancelable) e.preventDefault(); 
        const translate = Math.min(diffY * 0.4, 150); 
        const rotate = diffY * 2;
        slider.style.transition = 'none';
        slider.style.transform = `translateX(-${currentLocIndex * 100}%) translateY(${translate}px)`;
        const spinner = refreshContainer.querySelector('.spinner-icon');
        spinner.style.opacity = Math.min(diffY / 100, 1);
        spinner.style.transform = `rotate(${rotate}deg)`;
    }
});

dashArea.addEventListener('touchend', (e) => {
    if (isRefreshing) return;
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(diffY) > Math.abs(diffX) && diffY > 80 && dashArea.scrollTop === 0) {
        isRefreshing = true;
        slider.style.transition = 'transform 0.3s ease-out';
        slider.style.transform = `translateX(-${currentLocIndex * 100}%) translateY(60px)`;
        const spinner = refreshContainer.querySelector('.spinner-icon');
        spinner.classList.add('spinning');
        refreshAllLocations().then(() => {
            isRefreshing = false;
            spinner.classList.remove('spinning');
            spinner.style.opacity = '0';
            slider.style.transform = `translateX(-${currentLocIndex * 100}%) translateY(0)`;
        });
        return;
    }
    if (diffY > 0) {
        slider.style.transition = 'transform 0.3s ease-out';
        slider.style.transform = `translateX(-${currentLocIndex * 100}%) translateY(0)`;
    }
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        if (diffX > 0 && currentLocIndex > 0) currentLocIndex--;
        else if (diffX < 0 && currentLocIndex < locations.length - 1) currentLocIndex++;
        renderDashboard();
    }
});

function handleSearch(e) {
    const val = e.target.value;
    const resultsDiv = document.getElementById('search-results');
    tempSelectedLocation = null; 
    clearTimeout(searchTimeout);
    
    // UPDATED: Threshold lowered to 2 characters
    if (val.length < 2) { resultsDiv.innerHTML = ""; return; }
    
    searchTimeout = setTimeout(async () => {
        try {
            // FIXED: URL Encode to handle spaces (e.g. "San Francisco")
            const res = await fetch(`${API.GEO}?name=${encodeURIComponent(val)}&count=5&language=en&format=json`);
            const data = await res.json();
            if(data.results && data.results.length > 0) {
                resultsDiv.innerHTML = data.results.map((city, index) => `
                    <div id="search-item-${index}" class="search-item" onclick="selectLocation(${index}, '${city.name.replace(/'/g, "\\'")}', ${city.latitude}, ${city.longitude})">
                        <div class="search-item-city">${city.name}</div>
                        <div class="search-item-country">${city.country}</div>
                    </div>
                `).join('');
            } else {
                // FIXED: Explicit "No Results" state
                resultsDiv.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No results found</div>';
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
    if (!locExists) { adHocLocations.add(alarm.location); }
    updateLocationDropdown();
    document.getElementById('new-time').value = alarm.time;
    document.getElementById('new-label').value = alarm.label;
    document.getElementById('new-location-select').value = alarm.location;
    if(alarm.conditions && alarm.conditions.length > 0) {
        document.getElementById('new-alarm-metric').value = alarm.conditions[0].metric || 'aqi';
        document.getElementById('new-aqi-op').value = alarm.conditions[0].operator;
        document.getElementById('new-aqi').value = alarm.conditions[0].value;
    }
    document.getElementById('new-sound').value = alarm.sound;
    document.getElementById('new-snooze-toggle').checked = !!alarm.snoozeEnabled;
    document.getElementById('new-snooze-duration').value = alarm.snoozeDuration || 9;
    document.getElementById('new-snooze-retain').checked = (alarm.snoozeRetainSettings !== false);
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
function openLocationSearch() { document.getElementById('loc-search-input').value = ""; document.getElementById('search-results').innerHTML = ""; document.getElementById('location-modal').style.display = 'flex'; }
function removeLocation(index) { const realIndex = index + 1; if (realIndex >= locations.length) return; locations.splice(realIndex, 1); if (currentLocIndex >= locations.length) currentLocIndex = locations.length - 1; renderDashboard(); }
function renderSettingsLocations() { const container = document.getElementById('settings-location-list'); const removableLocs = locations.slice(1); if (removableLocs.length === 0) { container.innerHTML = `<div class="settings-row" style="color: var(--text-secondary); font-size: 14px;">No added locations</div>`; } else { container.innerHTML = removableLocs.map((loc, i) => ` <div class="settings-row"> <span class="settings-label">${loc.name}</span> <button class="settings-delete-btn" onclick="removeLocation(${i})">Remove</button> </div> `).join(''); } }

function saveAlarm() {
    const timeVal = document.getElementById('new-time').value;
    const val = document.getElementById('new-aqi').value;
    const locVal = document.getElementById('new-location-select').value;
    const metricVal = document.getElementById('new-alarm-metric').value; 
    if (!timeVal || !val) { alert("Please set a time and value."); return; }
    if (locVal === 'search_new') { alert("Please select a valid location."); return; }
    const alarmData = { 
        time: timeVal, 
        label: document.getElementById('new-label').value, 
        location: locVal, 
        conditions: [{ metric: metricVal, operator: document.getElementById('new-aqi-op').value, value: val }], 
        repeat: selectedDays.length === 0 ? ["Never"] : [...selectedDays], 
        sound: document.getElementById('new-sound').value,
        active: true,
        snoozeEnabled: document.getElementById('new-snooze-toggle').checked,
        snoozeDuration: parseInt(document.getElementById('new-snooze-duration').value) || 9,
        snoozeRetainSettings: document.getElementById('new-snooze-retain').checked
    };
    if (editingAlarmIndex !== null) { alarms[editingAlarmIndex] = alarmData; } else { alarms.push(alarmData); }
    renderAlarms(); renderDashboard(); closeAddAlarm();
}

function toggleAlarm(index) { alarms[index].active = !alarms[index].active; renderDashboard(); }
function toggleDay(btn) { const day = btn.getAttribute('data-day'); if (selectedDays.includes(day)) { selectedDays = selectedDays.filter(d => d !== day); btn.classList.remove('selected'); } else { selectedDays.push(day); btn.classList.add('selected'); } }
function renderAlarms() { const listContainer = document.getElementById('alarm-list-container'); listContainer.innerHTML = alarms.map((alarm, index) => { const cond = alarm.conditions[0]; const op = cond.operator === 'gt' ? '>' : '<'; const metric = cond.metric ? cond.metric.toUpperCase() : 'AQI'; return ` <div class="alarm-container"> <div class="alarm-swipe-actions"> <button class="swipe-btn edit" onclick="openEditAlarm(${index})">Edit</button> <button class="swipe-btn delete" onclick="deleteAlarm(${index})"> <svg class="trash-icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> </button> </div> <div class="alarm-row-content" id="row-${index}" ontouchstart="handleAlarmTouchStart(event, ${index})" ontouchmove="handleAlarmTouchMove(event, ${index})" ontouchend="handleAlarmTouchEnd(event, ${index})"> <div class="alarm-info"> <div class="alarm-top-line"><span class="alarm-time">${alarm.time}</span><span class="alarm-condition">${metric} ${op} ${cond.value}</span></div> ${alarm.label ? `<div class="alarm-label">${alarm.label}</div>` : ''} <div class="alarm-details">${alarm.location} • ${formatDays(alarm.repeat)}</div> </div> <label class="switch"> <input type="checkbox" ${alarm.active ? 'checked' : ''} onchange="toggleAlarm(${index})"> <span class="slider"></span> </label> </div> </div> `}).join(''); }
function deleteAlarm(index) { alarms.splice(index, 1); renderAlarms(); renderDashboard(); }
function formatDays(days) { return days.includes("Never") ? "Once" : (days.length === 7 ? "Daily" : days.map(d => d.slice(0, 3)).join(", ")); }
function toggleSnoozeOptions() { const toggle = document.getElementById('new-snooze-toggle'); const options = document.getElementById('snooze-options'); if (toggle.checked) { options.style.display = 'block'; const modalBody = document.querySelector('#add-modal .modal-body'); if (modalBody) { setTimeout(() => { modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' }); }, 50); } } else { options.style.display = 'none'; } }

// Check Alarms and Trigger Logic (Same as before)
let lastCheckedMinuteCheck = null; 
function checkAlarms() { const now = new Date(); const currentMinuteStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); if (lastCheckedMinuteCheck === currentMinuteStr) return; lastCheckedMinuteCheck = currentMinuteStr; const dayName = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][now.getDay()]; alarms.forEach((alarm, index) => { if (!alarm.active) return; if (alarm.time !== currentMinuteStr) return; if (!alarm.repeat.includes("Never") && !alarm.repeat.includes(dayName)) return; let locData = null; if (alarm.location.includes("Current")) { locData = locations.find(l => l.isCurrent); } else { locData = locations.find(l => l.name === alarm.location); } if (!locData) return; const metric = (alarm.conditions[0].metric || 'aqi'); let currentVal = 0; if (metric === 'aqi') { currentVal = calculateAQI(locData.current.pm25); } else if (locData.current[metric] !== undefined) { currentVal = locData.current[metric]; } const threshold = parseInt(alarm.conditions[0].value); const op = alarm.conditions[0].operator; let conditionMet = false; if (op === 'lt' && currentVal < threshold) conditionMet = true; if (op === 'gt' && currentVal > threshold) conditionMet = true; if (conditionMet) { triggerAlarm(alarm, currentVal, locData.name, metric); if (alarm.repeat.includes("Never")) { alarm.active = false; renderAlarms(); } } }); }
function triggerAlarm(alarm, val, locName, metric) { currentRingingAlarm = alarm; audio.play(alarm.sound); const overlay = document.getElementById('ring-overlay'); document.getElementById('ring-label').innerText = alarm.label || "Alarm"; const disp = getMetricDisplay(metric || 'aqi', val); document.getElementById('ring-condition').innerText = `${disp.label} is ${disp.val}${disp.unit}`; document.getElementById('ring-location').innerText = locName; document.getElementById('ring-time').innerText = alarm.time; const badge = document.getElementById('ring-aqi-badge'); badge.innerText = "Alert"; badge.style.backgroundColor = disp.color; const snoozeBtn = document.getElementById('btn-snooze'); if (alarm.snoozeEnabled) { snoozeBtn.style.display = 'block'; } else { snoozeBtn.style.display = 'none'; } overlay.style.display = 'flex'; }
function stopAlarm() { audio.stop(); currentRingingAlarm = null; document.getElementById('ring-overlay').style.display = 'none'; }
function snoozeAlarm() { if (!currentRingingAlarm) return; const duration = currentRingingAlarm.snoozeDuration ? parseInt(currentRingingAlarm.snoozeDuration) : 9; const now = new Date(); now.setMinutes(now.getMinutes() + duration); const snoozeTimeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); let newConditions = []; if (currentRingingAlarm.snoozeRetainSettings) { newConditions = [...currentRingingAlarm.conditions]; } else { newConditions = [{ metric: currentRingingAlarm.conditions[0].metric, operator: 'gt', value: -9999 }]; } const snoozeAlarmObj = { time: snoozeTimeStr, label: "Snoozing: " + (currentRingingAlarm.label || "Alarm"), location: currentRingingAlarm.location, conditions: newConditions, repeat: ["Never"], sound: currentRingingAlarm.sound, active: true, snoozeEnabled: true, snoozeDuration: duration, snoozeRetainSettings: currentRingingAlarm.snoozeRetainSettings }; alarms.push(snoozeAlarmObj); renderAlarms(); stopAlarm(); }

// Keep Handle Touch
let alarmTouchStartX2 = 0; let alarmCurrentSwipeIndex2 = -1; 
function handleAlarmTouchStart(e, index) { alarmTouchStartX2 = e.touches[0].clientX; alarmCurrentSwipeIndex2 = index; document.querySelectorAll('.alarm-row-content').forEach(row => { if(row.id !== `row-${index}`) row.style.transform = `translateX(0px)`; }); }
function handleAlarmTouchMove(e, index) { if (alarmCurrentSwipeIndex2 !== index) return; const diff = e.touches[0].clientX - alarmTouchStartX2; const row = document.getElementById(`row-${index}`); if (diff < 0 && diff > -160) { row.style.transform = `translateX(${diff}px)`; } }
function handleAlarmTouchEnd(e, index) { const row = document.getElementById(`row-${index}`); const diff = e.changedTouches[0].clientX - alarmTouchStartX2; if (diff < -60) { row.style.transform = `translateX(-150px)`; } else { row.style.transform = `translateX(0px)`; } }

initData();
renderAlarms();