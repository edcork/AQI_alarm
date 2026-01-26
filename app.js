// --- CONFIGURATION ---
let alarms = []; 
let selectedDays = []; 
let timeFormat = "24h";
let currentAQIStandard = "US";
let currentTheme = "dark"; 
let primaryIndex = "aqi"; // Default to overall AQI
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
    WEATHER_METEO: "https://api.open-meteo.com/v1/forecast", // Added for weather forecast
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

// --- UTILITY: DATA NORMALIZATION ---
function getMetricDisplay(metric, val) {
    if (val === undefined || val === null) return { val: '-', unit: '', label: metric, color: '#888' };
    
    // Units & Labels
    const meta = {
        'aqi': { unit: '', label: 'AQI' },
        'pm25': { unit: 'PM2.5', label: 'PM2.5' },
        'pm10': { unit: 'PM10', label: 'PM10' },
        'no2': { unit: 'NO₂', label: 'NO₂' },
        'so2': { unit: 'SO₂', label: 'SO₂' },
        'o3': { unit: 'O₃', label: 'Ozone' },
        'co': { unit: 'CO', label: 'CO' },
        'temp': { unit: '°C', label: 'Temp' },
        'wind': { unit: 'km/h', label: 'Wind' },
        'humidity': { unit: '%', label: 'Humidity' }
    }[metric] || { unit: '', label: metric };

    // Colors
    let color = '#fff';
    if (['aqi', 'pm25', 'pm10', 'no2', 'so2', 'o3', 'co'].includes(metric)) {
        // Recycle AQI color logic for all pollutants for simplicity (approximate)
        // Or map raw values. For now, assume value is Index-like or similar scale
        // Exception: AQI function takes Raw PM2.5.
        // If metric is AQI, val is AQI. If metric is PM2.5, val is raw.
        // Let's use simple thresholds for demo:
        let normVal = val;
        if (metric === 'aqi') normVal = val;
        // Simple heuristic for demo coloring of other pollutants:
        color = getColor(normVal, 'US'); 
    } else if (metric === 'temp') {
        if (val < 10) color = '#0A84FF'; // Cold
        else if (val > 30) color = '#FF453A'; // Hot
        else color = '#30D158'; // Mild
    } else if (metric === 'wind') {
        if (val > 20) color = '#FF9500'; 
        else color = '#30D158';
    } else {
        color = '#0A84FF'; // Humidity
    }

    return { val: Math.round(val), unit: meta.unit, label: meta.label, color: color };
}

function calculateAQI(pm25, standard = 'US') {
    // Keep existing implementation
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
    // Simplified status text
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

        // Fetch 3 sources in parallel
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
            current: { aqi: 0 }, // Default
            forecast: {}
        };

        // 1. Process WAQI (Real-time Reality Check)
        if (waqiRes.status === 'fulfilled') {
            const w = await waqiRes.value.json();
            if (w.status === 'ok' && w.data.iaqi) {
                // Map WAQI values (Indices/Raw)
                if(w.data.iaqi.pm25) data.current.pm25 = w.data.iaqi.pm25.v;
                if(w.data.iaqi.pm10) data.current.pm10 = w.data.iaqi.pm10.v;
                if(w.data.iaqi.no2) data.current.no2 = w.data.iaqi.no2.v;
                if(w.data.iaqi.so2) data.current.so2 = w.data.iaqi.so2.v;
                if(w.data.iaqi.o3) data.current.o3 = w.data.iaqi.o3.v;
                if(w.data.iaqi.co) data.current.co = w.data.iaqi.co.v;
                
                // Weather from WAQI
                if(w.data.iaqi.t) data.current.temp = w.data.iaqi.t.v;
                if(w.data.iaqi.w) data.current.wind = w.data.iaqi.w.v * 3.6; // m/s to km/h approx
                if(w.data.iaqi.h) data.current.humidity = w.data.iaqi.h.v;

                // Calculated AQI
                if(data.current.pm25) data.current.aqi = calculateAQI(data.current.pm25, currentAQIStandard);
            }
        }

        // 2. Process Meteo Air (Forecast + Fallback)
        if (meteoAirRes.status === 'fulfilled') {
            const m = await meteoAirRes.value.json();
            // Fill current if missing
            if(!data.current.pm25 && m.current) data.current.pm25 = m.current.pm2_5;
            // Build Forecasts
            data.forecast.pm25 = m.hourly.pm2_5;
            data.forecast.pm10 = m.hourly.pm10;
            data.forecast.no2 = m.hourly.nitrogen_dioxide;
            data.forecast.so2 = m.hourly.sulphur_dioxide;
            data.forecast.o3 = m.hourly.ozone;
            data.forecast.co = m.hourly.carbon_monoxide;
            
            // Calculate Forecast AQI (based on PM2.5 for simplicity)
            data.forecast.aqi = m.hourly.pm2_5.map(v => calculateAQI(v, currentAQIStandard));
        }

        // 3. Process Meteo Weather (Forecast + Fallback)
        if (meteoWeatherRes.status === 'fulfilled') {
            const mw = await meteoWeatherRes.value.json();
            // Fill current if missing
            if(!data.current.temp && mw.current) data.current.temp = mw.current.temperature_2m;
            if(!data.current.wind && mw.current) data.current.wind = mw.current.wind_speed_10m;
            if(!data.current.humidity && mw.current) data.current.humidity = mw.current.relative_humidity_2m;

            // Build Forecasts
            data.forecast.temp = mw.hourly.temperature_2m;
            data.forecast.wind = mw.hourly.wind_speed_10m;
            data.forecast.humidity = mw.hourly.relative_humidity_2m;
        }

        if(isCurrent) locations.unshift(data);
        else locations.push(data);

        if (!isCurrent) currentLocIndex = locations.length - 1;
        renderDashboard();

    } catch (e) { console.error("API Error", e); }
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

// --- RENDER DASHBOARD (DYNAMIC) ---
function renderDashboard() {
    const slider = document.getElementById('dashboard-slider');
    const dots = document.getElementById('dots-container');
    
    if (locations.length === 0) {
        slider.innerHTML = "<div class='dashboard-slide' style='justify-content:center'>Loading...</div>";
        return;
    }

    slider.innerHTML = locations.map(loc => {
        // Get values based on Primary Index
        const valObj = loc.current[primaryIndex] !== undefined ? loc.current[primaryIndex] : loc.current['aqi']; // Fallback
        
        // Use helper to get display props (Color, Label, Unit)
        // If primaryIndex is 'aqi', valObj is the calculated AQI.
        // If primaryIndex is 'temp', valObj is 24.
        const disp = getMetricDisplay(primaryIndex, valObj);
        
        const iconHtml = loc.isCurrent 
            ? `<svg class="location-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path></svg>` 
            : '';

        // Forecast Chart
        // Pick the right forecast array
        const forecastArr = loc.forecast[primaryIndex] || loc.forecast['aqi'] || [];
        
        // Calculate Max for chart scaling
        let maxVal = 100; // default
        if(primaryIndex === 'aqi') maxVal = 500;
        else if(primaryIndex === 'temp') maxVal = 40;
        else if(primaryIndex === 'humidity') maxVal = 100;
        else if(primaryIndex === 'wind') maxVal = 50;
        else maxVal = Math.max(...forecastArr) || 100;

        const currentHourIndex = new Date().getHours(); 
        const barsHtml = [];
        
        for (let i = 0; i < 24; i++) {
            const idx = currentHourIndex + i;
            if (idx < forecastArr.length) {
                const val = forecastArr[idx];
                const h = Math.min((Math.max(val,0) / maxVal) * 100, 100); // Clamp 0-100%
                // Dynamic color per bar
                const barDisp = getMetricDisplay(primaryIndex, val);
                
                let timeLabel = "";
                const hour = (currentHourIndex + i) % 24;
                if (i % 4 === 0) { 
                    if (timeFormat === '24h') timeLabel = (hour < 10 ? '0' : '') + hour + ":00";
                    else { const suffix = hour >= 12 ? 'PM' : 'AM'; const h12 = hour % 12 || 12; timeLabel = h12 + "" + suffix; }
                }

                // Check active alarm on this hour? (Simplified: check time matches)
                const hasActiveAlarm = alarms.some(a => a.active && parseInt(a.time.split(':')[0]) === hour);
                const markerHtml = hasActiveAlarm 
                    ? `<svg class="alarm-marker-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z"/></svg>` 
                    : '';

                barsHtml.push(`
                    <div class="forecast-column">
                        <div class="forecast-icon-area">${markerHtml}</div>
                        <div class="forecast-bar-area">
                            <div class="forecast-bar" style="height: ${h}%; background-color: ${barDisp.color};"></div>
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

// --- ALARM CHECK LOGIC (UPDATED) ---
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

        // CHECK CONDITION BASED ON METRIC
        // alarm.conditions[0].metric e.g. 'aqi', 'temp', 'wind'
        const metric = alarm.conditions[0].metric || 'aqi'; 
        // Get value from current data
        const currentVal = locData.current[metric] !== undefined ? locData.current[metric] : (metric==='aqi'?calculateAQI(locData.current.pm25):0);
        
        const threshold = parseInt(alarm.conditions[0].value);
        const op = alarm.conditions[0].operator; 

        let conditionMet = false;
        if (op === 'lt' && currentVal < threshold) conditionMet = true;
        if (op === 'gt' && currentVal > threshold) conditionMet = true;

        if (conditionMet) {
            triggerAlarm(alarm, currentVal, locData.name, metric);
            if (alarm.repeat.includes("Never")) {
                alarm.active = false;
                renderAlarms(); 
            }
        }
    });
}

function triggerAlarm(alarm, val, locName, metric) {
    currentRingingAlarm = alarm; 
    audio.play(alarm.sound);

    const overlay = document.getElementById('ring-overlay');
    document.getElementById('ring-label').innerText = alarm.label || "Alarm";
    
    // Display proper metric
    const disp = getMetricDisplay(metric || 'aqi', val);
    document.getElementById('ring-condition').innerText = `${disp.label} is ${disp.val}${disp.unit}`;
    
    document.getElementById('ring-location').innerText = locName;
    document.getElementById('ring-time').innerText = alarm.time;
    
    const badge = document.getElementById('ring-aqi-badge');
    badge.innerText = "Alert"; // Generic alert text
    badge.style.backgroundColor = disp.color;

    const snoozeBtn = document.getElementById('btn-snooze');
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

function snoozeAlarm() {
    if (!currentRingingAlarm) return;
    const duration = currentRingingAlarm.snoozeDuration ? parseInt(currentRingingAlarm.snoozeDuration) : 9;
    const now = new Date();
    now.setMinutes(now.getMinutes() + duration);
    const snoozeTimeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    let newConditions = [];
    if (currentRingingAlarm.snoozeRetainSettings) {
        newConditions = [...currentRingingAlarm.conditions];
    } else {
        // Fallback condition if unconditional: metric same, but threshold -9999 GT
        newConditions = [{ metric: currentRingingAlarm.conditions[0].metric, operator: 'gt', value: -9999 }];
    }

    const snoozeAlarmObj = {
        time: snoozeTimeStr,
        label: "Snoozing: " + (currentRingingAlarm.label || "Alarm"),
        location: currentRingingAlarm.location,
        conditions: newConditions,
        repeat: ["Never"],
        sound: currentRingingAlarm.sound,
        active: true,
        snoozeEnabled: true, 
        snoozeDuration: duration,
        snoozeRetainSettings: currentRingingAlarm.snoozeRetainSettings
    };

    alarms.push(snoozeAlarmObj);
    renderAlarms();
    stopAlarm(); 
}

function toggleSnoozeOptions() {
    const toggle = document.getElementById('new-snooze-toggle');
    const options = document.getElementById('snooze-options');
    if (toggle.checked) {
        options.style.display = 'block';
        const modalBody = document.querySelector('#add-modal .modal-body');
        if (modalBody) {
            setTimeout(() => {
                modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' });
            }, 50);
        }
    } else {
        options.style.display = 'none';
    }
}

// --- SAVE ALARM (UPDATED) ---
function saveAlarm() {
    const timeVal = document.getElementById('new-time').value;
    const val = document.getElementById('new-aqi').value;
    const locVal = document.getElementById('new-location-select').value;
    const metricVal = document.getElementById('new-alarm-metric').value; // NEW

    if (!timeVal || !val) {
        alert("Please set a time and value.");
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
        // Save Metric
        conditions: [{ metric: metricVal, operator: document.getElementById('new-aqi-op').value, value: val }], 
        repeat: selectedDays.length === 0 ? ["Never"] : [...selectedDays], 
        sound: document.getElementById('new-sound').value,
        active: true,
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

// --- POPULATE EDIT FORM (UPDATED) ---
function openEditAlarm(index) {
    editingAlarmIndex = index;
    const alarm = alarms[index];
    document.getElementById('modal-title').innerText = "Edit Alarm";
    audio.init();

    const locExists = locations.some(l => l.name === alarm.location);
    if (!locExists) adHocLocations.add(alarm.location);
    updateLocationDropdown();

    document.getElementById('new-time').value = alarm.time;
    document.getElementById('new-label').value = alarm.label;
    document.getElementById('new-location-select').value = alarm.location;
    
    // Populate Condition
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

function updatePrimaryIndex(val) {
    primaryIndex = val;
    renderDashboard();
}

// --- BOILERPLATE (Keep existing toggleAlarm, toggleDay, deleteAlarm, formatDays, handleSearch, UI open/close, etc.) ---
// I am truncating the repetitive UI helper functions for brevity as they are unchanged from previous, 
// but ensure they are included in your final file (toggleAlarm, toggleDay, renderAlarms, etc.)
// COPY THE REST OF THE FUNCTIONS FROM PREVIOUS FILE HERE:
// toggleAlarm, toggleDay, renderAlarms, deleteAlarm, formatDays, updateTheme, updateAQIStandard, updateTimeFormat, etc.

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
        const metric = cond.metric ? cond.metric.toUpperCase() : 'AQI';
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
                    <div class="alarm-top-line"><span class="alarm-time">${alarm.time}</span><span class="alarm-condition">${metric} ${op} ${cond.value}</span></div>
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
function openAddMenu() { document.getElementById('menu-modal').style.display = 'block'; }
function closeAddMenu() { document.getElementById('menu-modal').style.display = 'none'; }
function selectMenuOption(opt) { closeAddMenu(); if (opt === 'alarm') openAddAlarm(); else { isAlarmLocationSearch = false; openLocationSearch(); } }
function openSettings() { renderSettingsLocations(); document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function closeAddAlarm() { document.getElementById('add-modal').style.display = 'none'; }
function openLocationSearch() { document.getElementById('loc-search-input').value = ""; document.getElementById('search-results').innerHTML = ""; document.getElementById('location-modal').style.display = 'flex'; }
function closeLocationSearch() { document.getElementById('location-modal').style.display = 'none'; if(isAlarmLocationSearch){ document.getElementById('new-location-select').selectedIndex=0; isAlarmLocationSearch=false; } }
function removeLocation(index) { const realIndex = index + 1; if (realIndex >= locations.length) return; locations.splice(realIndex, 1); if (currentLocIndex >= locations.length) currentLocIndex = locations.length - 1; renderDashboard(); }
function renderSettingsLocations() { const container = document.getElementById('settings-location-list'); const removableLocs = locations.slice(1); if (removableLocs.length === 0) { container.innerHTML = `<div class="settings-row" style="color: var(--text-secondary); font-size: 14px;">No added locations</div>`; } else { container.innerHTML = removableLocs.map((loc, i) => ` <div class="settings-row"> <span class="settings-label">${loc.name}</span> <button class="settings-delete-btn" onclick="removeLocation(${i})">Remove</button> </div> `).join(''); } }
let alarmTouchStartX = 0; let alarmCurrentSwipeIndex = -1;
function handleAlarmTouchStart(e, index) { alarmTouchStartX = e.touches[0].clientX; alarmCurrentSwipeIndex = index; document.querySelectorAll('.alarm-row-content').forEach(row => { if(row.id !== `row-${index}`) row.style.transform = `translateX(0px)`; }); }
function handleAlarmTouchMove(e, index) { if (alarmCurrentSwipeIndex !== index) return; const diff = e.touches[0].clientX - alarmTouchStartX; const row = document.getElementById(`row-${index}`); if (diff < 0 && diff > -160) { row.style.transform = `translateX(${diff}px)`; } }
function handleAlarmTouchEnd(e, index) { const row = document.getElementById(`row-${index}`); const diff = e.changedTouches[0].clientX - alarmTouchStartX; if (diff < -60) { row.style.transform = `translateX(-150px)`; } else { row.style.transform = `translateX(0px)`; } }

initData();
renderAlarms();