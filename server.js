// server.js — SafeHer automatic emergency SMS backend

const express = require("express");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "10kb" }));

const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.post("/api/emergency-alert", async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (
      !Array.isArray(contacts) ||
      contacts.length < 1 ||
      contacts.length > 5 ||
      contacts.some(
        number =>
          typeof number !== "string" ||
          !/^\+[1-9]\d{7,14}$/.test(number)
      )
    ) {
      return res.status(400).json({
        error: "Provide 1–5 valid international phone numbers."
      });
    }

    if (
      typeof message !== "string" ||
      message.trim().length === 0 ||
      message.length > 1500
    ) {
      return res.status(400).json({
        error: "Provide a valid emergency message."
      });
    }

    const results = await Promise.allSettled(
      contacts.map(number =>
        smsClient.messages.create({
          from: process.env.TWILIO_FROM_NUMBER,
          to: number,
          body: message
        })
      )
    );

    res.json({
      success: results.some(r => r.status === "fulfilled"),
      sent: results.filter(r => r.status === "fulfilled").length,
      failed: results.filter(r => r.status === "rejected").length
    });
  } catch (error) {
    console.error("SMS service error:", error.message);
    res.status(500).json({ error: "SMS service unavailable." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("SafeHer SMS backend is running.");
});
const AUTO_SMS_ENDPOINT =
    "https://your-safether-server.com/api/emergency-alert";