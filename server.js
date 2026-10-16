const API = "https://YOUR-BACKEND.onrender.com";

let automaticAlertInProgress = false;
let lastSOSRequestTime = 0;

function prepareEmergencyAlerts() {
    updateEmergencyMessage();

    document.getElementById("alertMessage").innerText =
        "SOS active. Sending emergency SMS...";

    sendAutomaticEmergencyAlert();
}

async function sendAutomaticEmergencyAlert() {
    if (automaticAlertInProgress) return;

    // Prevent accidental duplicate requests.
    if (Date.now() - lastSOSRequestTime < 15000) {
        document.getElementById("smsStatus").innerText =
            "Please wait before retrying an SOS request.";
        return;
    }

    if (!contacts.length) {
        document.getElementById("smsStatus").innerText =
            "No emergency contacts saved.";
        return;
    }

    if (!window.safeHerToken) {
        document.getElementById("smsStatus").innerText =
            "Please log in before sending an SOS.";
        return;
    }

    automaticAlertInProgress = true;
    lastSOSRequestTime = Date.now();

    document.getElementById("smsStatus").innerText =
        "Sending emergency SMS through SafeHer...";

    try {
        const response = await fetch(`${API}/api/sos`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${window.safeHerToken}`
            },
            body: JSON.stringify({
                contacts: contacts.map(contact => ({
                    name: contact.name,
                    phone: cleanPhoneNumber(contact.phone)
                })),
                latitude: currentLatitude,
                longitude: currentLongitude
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "SOS request failed");
        }

        const results = result.results || [];
        const accepted = results.filter(
            item => item.status !== "request_failed"
        ).length;

        document.getElementById("smsStatus").innerText =
            `SMS requests accepted: ${accepted}/${results.length}. Check delivery status.`;

        document.getElementById("alertMessage").innerText =
            "SOS active. The server has processed the SMS requests.";

    } catch (error) {
        console.error("SafeHer SOS error:", error);

        document.getElementById("smsStatus").innerText =
            "Automatic SMS failed. Use the manual emergency options.";

        document.getElementById("alertMessage").innerText =
            "SOS active, but automatic SMS could not be confirmed.";
    } finally {
        automaticAlertInProgress = false;
    }
}

const twilio = require("twilio");

const smsClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Add this route to your existing Express application.
// authenticateToken must validate your existing login token.
app.post("/api/sos", authenticateToken, async (req, res) => {
    const { contacts, latitude, longitude } = req.body;

    if (!Array.isArray(contacts) ||
        contacts.length < 1 ||
        contacts.length > 5) {
        return res.status(400).json({
            error: "Provide 1 to 5 emergency contacts."
        });
    }

    if (
        latitude != null &&
        (typeof latitude !== "number" ||
         latitude < -90 || latitude > 90)
    ) {
        return res.status(400).json({
            error: "Invalid latitude."
        });
    }

    if (
        longitude != null &&
        (typeof longitude !== "number" ||
         longitude < -180 || longitude > 180)
    ) {
        return res.status(400).json({
            error: "Invalid longitude."
        });
    }

    const mapsUrl =
        Number.isFinite(latitude) &&
        Number.isFinite(longitude)
            ? `https://www.google.com/maps?q=${latitude},${longitude}`
            : "Location unavailable";

    const message =
        "🚨 SAFEHER EMERGENCY ALERT 🚨\n\n" +
        "The SafeHer user has activated SOS and may need help.\n" +
        "Please contact them as soon as possible.\n\n" +
        "📍 Location: " + mapsUrl + "\n" +
        "🕒 Time: " + new Date().toLocaleString("en-IN");

    try {
        const results = await Promise.allSettled(
            contacts.map(async contact => {
                const phone = String(contact.phone || "").trim();

                // Require international format, e.g. +919876543210.
                if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                    throw new Error("Invalid phone number");
                }

                const sms = await smsClient.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: phone,
                    body: message
                });

                return {
                    phone,
                    status: sms.status,
                    sid: sms.sid
                };
            })
        );

        const summary = results.map((item, index) => ({
            phone: contacts[index].phone,
            status: item.status === "fulfilled"
                ? item.value.status
                : "request_failed",
            sid: item.status === "fulfilled"
                ? item.value.sid
                : undefined
        }));

        res.json({
            accepted: true,
            results: summary
        });

    } catch (error) {
        console.error("SafeHer SMS error:", error.message);

        res.status(500).json({
            error: "Unable to process SOS."
        });
    }
});
