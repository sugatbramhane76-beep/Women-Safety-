const API = "https://YOUR-BACKEND.onrender.com";

async function sendAutomaticEmergencyAlert() {
    if (automaticAlertInProgress) return;

    if (!contacts.length) {
        document.getElementById("smsStatus").innerText =
            "No saved emergency contacts.";
        return;
    }

    automaticAlertInProgress = true;

    document.getElementById("smsStatus").innerText =
        "Sending emergency alerts...";

    try {
        const response = await fetch(`${API}/api/sos`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${window.safeHerToken}`
            },
            body: JSON.stringify({
                contacts: contacts.map(c => ({
                    name: c.name,
                    phone: cleanPhoneNumber(c.phone)
                })),
                latitude: currentLatitude,
                longitude: currentLongitude,
                message: getEmergencyMessage()
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Alert failed");
        }

        document.getElementById("smsStatus").innerText =
            "Alert request accepted by the server.";

    } catch (error) {
        console.error("SafeHer alert error:", error);

        document.getElementById("smsStatus").innerText =
            "Alert failed. Please use the manual emergency options.";
    } finally {
        automaticAlertInProgress = false;
    }
}
const express = require("express");
const twilio = require("twilio");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "10kb" }));

const smsClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

function authenticateToken(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
        ? header.slice(7)
        : "";

    if (!token) {
        return res.status(401).json({
            error: "Login required"
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({
                error: "Invalid or expired login token"
            });
        }

        req.user = user;
        next();
    });
}

app.post("/api/sos", authenticateToken, async (req, res) => {
    try {
        const { contacts, latitude, longitude } = req.body;

        if (
            !Array.isArray(contacts) ||
            contacts.length < 1 ||
            contacts.length > 5
        ) {
            return res.status(400).json({
                error: "Provide 1–5 emergency contacts"
            });
        }

        if (
            latitude != null &&
            (typeof latitude !== "number" ||
             latitude < -90 || latitude > 90)
        ) {
            return res.status(400).json({
                error: "Invalid latitude"
            });
        }

        if (
            longitude != null &&
            (typeof longitude !== "number" ||
             longitude < -180 || longitude > 180)
        ) {
            return res.status(400).json({
                error: "Invalid longitude"
            });
        }

        const mapsUrl =
            Number.isFinite(latitude) &&
            Number.isFinite(longitude)
                ? `https://www.google.com/maps?q=${latitude},${longitude}`
                : "Location unavailable";

        const message =
            "SAFEHER EMERGENCY ALERT\n" +
            "The SafeHer user has activated SOS and may need help.\n" +
            "Please contact them promptly.\n" +
            "Location: " + mapsUrl;

        const results = await Promise.allSettled(
            contacts.map(async contact => {
                const phone = String(contact.phone || "");

                // Accept international E.164-style numbers only.
                if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                    throw new Error("Invalid recipient number");
                }

                const result = await smsClient.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: phone,
                    body: message
                });

                return {
                    phone,
                    messageSid: result.sid,
                    status: result.status
                };
            })
        );

        const summary = results.map((result, index) => ({
            phone: contacts[index].phone,
            status: result.status === "fulfilled"
                ? result.value.status
                : "request_failed"
        }));

        res.json({
            accepted: true,
            results: summary
        });

    } catch (error) {
        console.error("SOS processing failed:", error.message);

        res.status(500).json({
            error: "Unable to process the SOS request"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`SafeHer backend running on port ${PORT}`);
});
