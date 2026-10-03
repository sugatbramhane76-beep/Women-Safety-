
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const twilio = require("twilio");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

// Allow requests from your GitHub Pages website.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// Limit repeated requests from the same IP.
app.use("/api/", rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false
}));

// Create Twilio client using private server credentials.
function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured.");
  }

  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// Health check.
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "SafeHer SMS backend" });
});

// Receive SOS request and send SMS alerts.
app.post("/api/emergency-alert", async (req, res) => {
  const { contacts, message } = req.body || {};

  if (!Array.isArray(contacts) ||
      contacts.length < 1 ||
      contacts.length > 5) {
    return res.status(400).json({
      error: "Provide between 1 and 5 emergency contacts."
    });
  }

  if (typeof message !== "string" ||
      message.trim().length < 5 ||
      message.length > 1500) {
    return res.status(400).json({
      error: "Invalid emergency message."
    });
  }

  const validContacts = contacts.every(contact =>
    contact &&
    typeof contact.phone === "string" &&
    /^\+[1-9]\d{7,14}$/.test(contact.phone)
  );

  if (!validContacts) {
    return res.status(400).json({
      error: "Use international phone format, e.g. +919876543210."
    });
  }

  if (!process.env.TWILIO_PHONE_NUMBER) {
    return res.status(503).json({
      error: "Twilio sender number is not configured."
    });
  }

  try {
    const client = getTwilioClient();

    const results = await Promise.allSettled(
      contacts.map(contact =>
        client.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: contact.phone,
          body: message
        })
      )
    );

    const details = results.map((result, index) => ({
      phone: contacts[index].phone,
      status: result.status === "fulfilled"
        ? "accepted"
        : "failed",
      ...(result.status === "fulfilled"
        ? { sid: result.value.sid }
        : { error: result.reason?.message || "SMS request failed" })
    }));

    const sent = details.filter(
      item => item.status === "accepted"
    ).length;

    const failed = details.length - sent;

    return res.status(sent > 0 ? 200 : 502).json({
      ok: failed === 0,
      sent,
      failed,
      note: "Provider acceptance does not guarantee SMS delivery.",
      results: details
    });

  } catch (error) {
    console.error("Twilio error:", error.message);

    return res.status(502).json({
      error: "Unable to submit SMS requests to Twilio."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SafeHer backend running on port ${PORT}`);
});
