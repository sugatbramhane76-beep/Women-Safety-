const express = require("express");
const twilio = require("twilio");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || "http://localhost:5500")
    .split(",")
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
}));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.get("/health", (req, res) => {
  res.json({ status: "SafeHer backend running" });
});

app.post("/api/emergency-alert", async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        error: "At least one emergency contact is required."
      });
    }

    if (contacts.length > 5) {
      return res.status(400).json({
        error: "Maximum 5 contacts allowed."
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Emergency message is required."
      });
    }

    const validContacts = contacts.filter(
      number =>
        typeof number === "string" &&
        /^\+[1-9]\d{7,14}$/.test(number)
    );

    if (validContacts.length !== contacts.length) {
      return res.status(400).json({
        error: "Use valid international phone numbers, e.g. +919876543210."
      });
    }

    // Send only to contacts who agreed to receive emergency alerts.
    const results = await Promise.allSettled(
      validContacts.map(number =>
        client.messages.create({
          body: message.slice(0, 1500),
          from: process.env.TWILIO_FROM_NUMBER,
          to: number
        })
      )
    );

    const sent = results.filter(
      result => result.status === "fulfilled"
    ).length;

    res.json({
      success: sent > 0,
      sent,
      failed: results.length - sent,
      message: `SMS accepted for ${sent} contact(s).`
    });
  } catch (error) {
    console.error("SMS error:", error.message);
    res.status(500).json({
      error: "Unable to send emergency messages."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SafeHer backend running on port ${PORT}`);
});
async function sendAutomaticEmergencyAlert(message, contacts) {
  try {
    const response = await fetch(
      "http://localhost:3000/api/emergency-alert",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message,
          contacts: contacts
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "SMS request failed");
    }

    console.log("SafeHer SMS result:", result);
    return result;
  } catch (error) {
    console.error("Emergency SMS error:", error);
    throw error;
  }
}
const contacts = JSON.parse(
  localStorage.getItem("safeHerContacts") || "[]"
);

// Adapt this mapping to your existing contact object structure.
const phoneNumbers = contacts.map(contact => contact.phone);

const message =
  "SAFEHER EMERGENCY ALERT: I may need immediate help. Please contact me.";

sendAutomaticEmergencyAlert(message, phoneNumbers)
  .catch(() => {
    alert("Automatic SMS failed. Please use your backup emergency method.");
  });