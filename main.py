import os, re, zipfile, shutil, textwrap

base = "/mnt/data/safeher_backend_project"
os.makedirs(base, exist_ok=True)

source_path = "/mnt/data/Pasted code(20261003-184028).html"
with open(source_path, "r", encoding="utf-8") as f:
    html = f.read()

script = r'''<script>
"use strict";

/*
 * SafeHer frontend.
 * IMPORTANT: After deploying the backend, replace the placeholder below
 * with your HTTPS backend URL, for example:
 * https://your-safeher-api.example.com/api/emergency-alert
 */
const AUTO_SMS_ENDPOINT = "https://YOUR-BACKEND-DOMAIN/api/emergency-alert";

let contacts = [];
try {
    const saved = JSON.parse(localStorage.getItem("safeHerContacts") || "[]");
    contacts = Array.isArray(saved) ? saved.filter(c => c && c.name && c.phone) : [];
} catch (_) {
    contacts = [];
}
let currentLatitude = null;
let currentLongitude = null;
let monitoring = false;
let audioContext = null;
let oscillator = null;
let gainNode = null;
let alarmPulseTimer = null;
let countdownTimer = null;
let countdownValue = 5;
let locationWatchId = null;
let automaticAlertInProgress = false;
let lastAcceleration = { x: 0, y: 0, z: 0 };
let lastShakeTime = 0;

function cleanPhoneNumber(phone) {
    return String(phone || "").replace(/[^\d+]/g, "");
}

function getMapURL() {
    if (currentLatitude === null || currentLongitude === null) return null;
    return `https://www.google.com/maps?q=${currentLatitude},${currentLongitude}`;
}

function getEmergencyMessage() {
    const mapURL = getMapURL();
    return "🚨 SAFEHER EMERGENCY ALERT 🚨\n\n" +
        "I may need immediate help. Please contact me as soon as possible.\n\n" +
        "📍 My Google Maps location:\n" + (mapURL || "Location unavailable") +
        "\n\n🕒 Time: " + new Date().toLocaleString("en-IN") +
        "\n\n🛡️ SafeHer Emergency System";
}

function updateEmergencyMessage() {
    const el = document.getElementById("emergencyText");
    if (el) el.innerText = getEmergencyMessage();
}

function setLocation(position) {
    currentLatitude = position.coords.latitude;
    currentLongitude = position.coords.longitude;
    document.getElementById("latitude").innerText = currentLatitude.toFixed(6);
    document.getElementById("longitude").innerText = currentLongitude.toFixed(6);
    document.getElementById("locationStatus").innerText =
        locationWatchId !== null ? "🟢 Live location active" : "🟢 Location available";
    updateEmergencyMessage();
}

function getLocation(callback) {
    if (!navigator.geolocation) {
        document.getElementById("locationStatus").innerText = "❌ Geolocation not supported";
        if (callback) callback(false);
        return;
    }
    document.getElementById("locationStatus").innerText = "📍 Requesting GPS permission...";
    navigator.geolocation.getCurrentPosition(
        position => { setLocation(position); if (callback) callback(true); },
        () => {
            document.getElementById("locationStatus").innerText = "❌ Location unavailable";
            updateEmergencyMessage();
            if (callback) callback(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function startLiveLocation() {
    if (!navigator.geolocation) return;
    stopLiveLocation();
    locationWatchId = navigator.geolocation.watchPosition(
        setLocation,
        () => { document.getElementById("locationStatus").innerText = "❌ Location unavailable"; },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
}

function stopLiveLocation() {
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

function openMap() {
    const url = getMapURL();
    if (!url) {
        getLocation();
        alert("Please allow location access and try again.");
        return;
    }
    window.open(url, "_blank", "noopener");
}

function startSOS() {
    if (countdownTimer) return;
    if (!contacts.length) {
        alert("Please add at least one emergency contact before activating SOS.");
        return;
    }
    countdownValue = 5;
    document.getElementById("countdown").classList.add("show");
    document.getElementById("countdownNumber").innerText = countdownValue;
    document.getElementById("systemStatus").innerText = "🟠 SOS Countdown";
    getLocation();
    countdownTimer = setInterval(() => {
        countdownValue--;
        document.getElementById("countdownNumber").innerText = countdownValue;
        if (countdownValue <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            activateSOS();
        }
    }, 1000);
}

function cancelSOS() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    automaticAlertInProgress = false;
    document.getElementById("countdown").classList.remove("show");
    document.getElementById("sosButton").classList.remove("active");
    document.getElementById("alertBox").classList.remove("show");
    document.getElementById("systemStatus").innerText = "🟢 System Ready";
    document.getElementById("smsStatus").innerText = "SMS status: SOS cancelled. If an alert was already submitted, it may still be sent.";
    stopAlarm();
}

function activateSOS() {
    document.getElementById("countdown").classList.remove("show");
    document.getElementById("sosButton").classList.add("active");
    document.getElementById("alertBox").classList.add("show");
    document.getElementById("systemStatus").innerText = "🔴 EMERGENCY ACTIVE";
    document.getElementById("alertMessage").innerText =
        "SOS active. Alarm started; preparing emergency SMS alerts.";
    startAlarm();
    notifyEmergency();
    requestLatestLocationForSOS();
}

function requestLatestLocationForSOS() {
    document.getElementById("smsStatus").innerText = "SMS status: Getting latest GPS location...";
    getLocation(() => prepareEmergencyAlerts());
    // If geolocation never calls back or is unavailable, allow the alert attempt to proceed.
    setTimeout(() => {
        if (document.getElementById("smsStatus").innerText === "SMS status: Getting latest GPS location...") {
            prepareEmergencyAlerts();
        }
    }, 10500);
}

function prepareEmergencyAlerts() {
    updateEmergencyMessage();
    sendAutomaticEmergencyAlert();
}

async function sendAutomaticEmergencyAlert() {
    if (automaticAlertInProgress) return;
    if (!contacts.length) {
        document.getElementById("smsStatus").innerText = "SMS status: No emergency contacts saved.";
        return;
    }
    if (AUTO_SMS_ENDPOINT.includes("YOUR-BACKEND-DOMAIN")) {
        document.getElementById("smsStatus").innerText =
            "⚠️ Backend not configured. Deploy the backend and set AUTO_SMS_ENDPOINT.";
        document.getElementById("alertMessage").innerText =
            "SOS is active, but automatic SMS is not configured. Use the manual SMS button as a fallback.";
        return;
    }

    const recipients = contacts.map(c => ({
        name: String(c.name).slice(0, 80),
        phone: cleanPhoneNumber(c.phone)
    })).filter(c => /^\+?[1-9]\d{7,14}$/.test(c.phone));

    if (!recipients.length) {
        document.getElementById("smsStatus").innerText = "SMS status: No valid phone numbers. Use international format, e.g. +919876543210.";
        return;
    }

    automaticAlertInProgress = true;
    document.getElementById("smsStatus").innerText = "🚨 Submitting emergency SMS alerts to the server...";
    try {
        const response = await fetch(AUTO_SMS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                source: "SafeHer",
                message: getEmergencyMessage(),
                contacts: recipients,
                location: {
                    latitude: currentLatitude,
                    longitude: currentLongitude,
                    mapsUrl: getMapURL()
                },
                timestamp: new Date().toISOString()
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Server returned HTTP ${response.status}`);
        const sent = Number(result.sent || 0);
        const failed = Number(result.failed || 0);
        document.getElementById("smsStatus").innerText =
            `Backend result: ${sent} SMS accepted by provider; ${failed} failed. Check delivery status with your provider.`;
        document.getElementById("alertMessage").innerText =
            sent > 0 ? "SOS active. Emergency SMS request processed by the SMS provider." :
            "SOS active, but the provider did not accept any SMS. Use the manual fallback.";
    } catch (error) {
        console.error("SafeHer SMS backend error:", error);
        document.getElementById("smsStatus").innerText =
            "❌ Automatic SMS failed: " + (error.message || "Backend unavailable") + ". Use manual SMS fallback.";
        document.getElementById("alertMessage").innerText =
            "SOS is active and alarm is sounding, but automatic SMS could not be confirmed.";
    } finally {
        automaticAlertInProgress = false;
    }
}

function buildSMSRecipients() {
    return contacts.map(c => cleanPhoneNumber(c.phone)).filter(Boolean);
}

function openEmergencySMS() {
    const recipients = buildSMSRecipients();
    if (!recipients.length) {
        document.getElementById("smsStatus").innerText = "SMS status: No valid phone numbers.";
        return;
    }
    const smsURL = "sms:" + recipients.join(",") + "?body=" + encodeURIComponent(getEmergencyMessage());
    document.getElementById("smsStatus").innerText =
        "📱 Opening the SMS app. Review the recipients and press Send.";
    window.location.href = smsURL;
}

function sendEmergencySMS() {
    if (!contacts.length) {
        alert("Please add at least one emergency contact.");
        return;
    }
    getLocation(() => openEmergencySMS());
    // If location permission is denied, still let the user send the message without a map link.
    setTimeout(() => {
        if (document.getElementById("smsStatus").innerText === "SMS status: Preparing emergency message...") {
            openEmergencySMS();
        }
    }, 3000);
    document.getElementById("smsStatus").innerText = "SMS status: Preparing emergency message...";
}

function shareWhatsApp() {
    if (!contacts.length) {
        alert("Please add at least one emergency contact.");
        return;
    }
    const firstPhone = cleanPhoneNumber(contacts[0].phone).replace(/^\+/, "");
    const url = "https://wa.me/" + firstPhone + "?text=" + encodeURIComponent(getEmergencyMessage());
    window.open(url, "_blank", "noopener");
}

async function copyEmergencyMessage() {
    try {
        await navigator.clipboard.writeText(getEmergencyMessage());
        alert("Emergency message copied.");
    } catch (_) {
        alert("Unable to copy automatically. Please select and copy the emergency message.");
    }
}

function startAlarm() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx || audioContext) return;
        audioContext = new AudioCtx();
        oscillator = audioContext.createOscillator();
        gainNode = audioContext.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = 900;
        gainNode.gain.value = 0.25;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        let high = true;
        alarmPulseTimer = setInterval(() => {
            if (oscillator) {
                oscillator.frequency.value = high ? 1100 : 650;
                high = !high;
            }
        }, 350);
    } catch (error) {
        console.warn("Audio unavailable", error);
    }
}

function stopAlarm() {
    if (alarmPulseTimer) clearInterval(alarmPulseTimer);
    alarmPulseTimer = null;
    try { if (oscillator) { oscillator.stop(); oscillator.disconnect(); } } catch (_) {}
    oscillator = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
    gainNode = null;
}

function notifyEmergency() {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("SafeHer Emergency Alert", {
            body: "SOS activated. Emergency alerts are being prepared."
        });
    }
}

function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

async function requestMotionPermission() {
    try {
        if (typeof DeviceMotionEvent !== "undefined" &&
            typeof DeviceMotionEvent.requestPermission === "function") {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission !== "granted") console.warn("Motion permission not granted.");
        }
    } catch (error) {
        console.warn("Motion permission error", error);
    }
}

function toggleMonitoring() {
    monitoring = !monitoring;
    const sw = document.getElementById("monitorSwitch");
    if (monitoring) {
        sw.classList.add("active");
        document.getElementById("systemStatus").innerText = "🟢 Safety Monitoring ON";
        getLocation();
        startLiveLocation();
        requestNotificationPermission();
        requestMotionPermission();
        alert("Safety monitoring enabled. Keep this page open; browser background restrictions may limit monitoring.");
    } else {
        sw.classList.remove("active");
        stopLiveLocation();
        document.getElementById("systemStatus").innerText = "🟢 System Ready";
    }
}

function handleMotion(event) {
    if (!monitoring) return;
    const a = event.accelerationIncludingGravity;
    if (!a) return;
    const x = a.x || 0, y = a.y || 0, z = a.z || 0;
    const change = Math.abs(x - lastAcceleration.x) +
        Math.abs(y - lastAcceleration.y) + Math.abs(z - lastAcceleration.z);
    const now = Date.now();
    if (change > 35 && now - lastShakeTime > 3000) {
        lastShakeTime = now;
        startSOS();
    }
    lastAcceleration = { x, y, z };
}

function addContact() {
    const name = document.getElementById("contactName").value.trim();
    const phone = cleanPhoneNumber(document.getElementById("contactPhone").value.trim());
    if (!name || !phone) {
        alert("Enter contact name and phone number.");
        return;
    }
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
        alert("Enter a valid phone number with country code, e.g. +919876543210.");
        return;
    }
    if (contacts.length >= 5) {
        alert("For safety, this version supports up to 5 emergency contacts.");
        return;
    }
    contacts.push({ name, phone });
    localStorage.setItem("safeHerContacts", JSON.stringify(contacts));
    document.getElementById("contactName").value = "";
    document.getElementById("contactPhone").value = "";
    renderContacts();
}

function deleteContact(index) {
    contacts.splice(index, 1);
    localStorage.setItem("safeHerContacts", JSON.stringify(contacts));
    renderContacts();
}

function escapeHTML(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderContacts() {
    const list = document.getElementById("contactList");
    list.innerHTML = "";
    contacts.forEach((contact, index) => {
        const div = document.createElement("div");
        div.className = "contact";
        div.innerHTML = `<div><b>👤 ${escapeHTML(contact.name)}</b><br><small>${escapeHTML(contact.phone)}</small></div>
            <button class="delete-contact" type="button" aria-label="Delete ${escapeHTML(contact.name)}" onclick="deleteContact(${index})">Delete</button>`;
        list.appendChild(div);
    });
}

function callEmergency() {
    window.location.href = "tel:112";
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.getElementById("alertBox").classList.contains("show")) {
        cancelSOS();
    }
});

renderContacts();
updateEmergencyMessage();
if ("DeviceMotionEvent" in window) window.addEventListener("devicemotion", handleMotion);
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        setLocation,
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
}
</script>'''

# Replace all script blocks with the clean implementation, preserving UI/CSS.
start = html.find("<script>")
end = html.rfind("</script>")
if start == -1 or end == -1:
    raise ValueError("Could not locate script block in uploaded HTML")
html = html[:start] + script + html[end + len("</script>"):]
# Update the SMS limitations text to reflect backend behavior.
html = html.replace(
    "SafeHer can open the native SMS application and\n     WhatsApp with the emergency message prepared.",
    "With a configured backend, SafeHer can request automatic SMS delivery. Manual SMS and WhatsApp may still require user confirmation."
)
html = html.replace(
    "A normal browser cannot silently press the final\n     Send button for SMS or WhatsApp. Fully automatic\n     background delivery requires a secure server/service.",
    "Automatic SMS requires a deployed backend and SMS provider. WhatsApp messages still require user action. Keep this page open for monitoring."
)
front_path = os.path.join(base, "index.html")
with open(front_path, "w", encoding="utf-8") as f:
    f.write(html)

server_js = r'''import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import twilio from "twilio";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(v => v.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allows health checks and server-to-server calls without an Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "20kb" }));

const alertLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Rate limit reached. Try again later." }
});

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function validPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "SafeHer SMS backend" });
});

app.post("/api/emergency-alert", alertLimiter, async (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    return res.status(503).json({ error: "SMS provider is not configured on the server." });
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const rawContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];

  if (!message || message.length > 1500) {
    return res.status(400).json({ error: "Message is required and must be at most 1500 characters." });
  }
  if (rawContacts.length < 1 || rawContacts.length > 5) {
    return res.status(400).json({ error: "Provide between 1 and 5 contacts." });
  }

  const contacts = rawContacts.map(c => ({
    name: String(c?.name || "Emergency contact").slice(0, 80),
    phone: normalizePhone(c?.phone)
  }));

  if (contacts.some(c => !validPhone(c.phone))) {
    return res.status(400).json({ error: "All phone numbers must use international format, e.g. +919876543210." });
  }

  // Avoid sending duplicates if the same number was added more than once.
  const uniqueContacts = [...new Map(contacts.map(c => [c.phone, c])).values()];
  const client = twilio(accountSid, authToken);

  const results = await Promise.all(uniqueContacts.map(async contact => {
    try {
      const result = await client.messages.create({
        body: message,
        from,
        to: contact.phone
      });
      return { name: contact.name, phone: contact.phone, status: result.status, sid: result.sid };
    } catch (error) {
      // Do not return provider credentials or stack traces to the browser.
      console.error("SMS provider rejected a message:", {
        code: error.code,
        status: error.status,
        message: error.message
      });
      return { name: contact.name, phone: contact.phone, error: "Provider rejected the message" };
    }
  }));

  const sent = results.filter(r => r.sid).length;
  const failed = results.length - sent;
  return res.status(200).json({ ok: failed === 0, sent, failed, results });
});

app.use((error, _req, res, _next) => {
  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "This website origin is not allowed." });
  }
  console.error("Backend request error:", error.message);
  return res.status(400).json({ error: "Invalid request." });
});

app.listen(PORT, () => {
  console.log(`SafeHer SMS backend listening on port ${PORT}`);
});
'''
with open(os.path.join(base, "server.js"), "w", encoding="utf-8") as f:
    f.write(server_js)

package_json = '''{
  "name": "safeher-sms-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "SafeHer emergency SMS backend using Twilio",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "express-rate-limit": "^8.1.0",
    "twilio": "^5.10.0"
  }
}
'''
with open(os.path.join(base, "package.json"), "w", encoding="utf-8") as f:
    f.write(package_json)

env_example = '''# Copy this file to .env on your backend host; never commit real credentials.
PORT=3000
ALLOWED_ORIGINS=https://sugatbramhane76-beep.github.io
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=replace_with_your_real_auth_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
'''
with open(os.path.join(base, ".env.example"), "w", encoding="utf-8") as f:
    f.write(env_example)
