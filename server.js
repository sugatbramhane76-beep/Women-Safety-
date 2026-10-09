
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true
}));
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("Set a strong JWT_SECRET in .env");
}

const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: [], contacts: [] };
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({ error: "Login required" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

app.get("/", (req, res) => {
  res.json({ service: "SafeHer API", status: "running" });
});

// Register
app.post("/api/register", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }

    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({
        error: "Password must be 10–72 characters"
      });
    }

    if (db.users.some(u => u.email === email)) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = {
      id: require("crypto").randomUUID(),
      email,
      passwordHash: await bcrypt.hash(password, 12)
    };

    db.users.push(user);
    saveDB();

    res.status(201).json({
      message: "Registration successful",
      token: createToken(user)
    });
  } catch {
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "")
    .trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.users.find(u => u.email === email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json({
    message: "Login successful",
    token: createToken(user)
  });
});

// Add an emergency contact
app.post("/api/contacts", auth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();

  if (!name || name.length > 80 || !validPhone(phone)) {
    return res.status(400).json({
      error: "Enter a contact name and phone in +countrycode format"
    });
  }

  const contact = {
    id: require("crypto").randomUUID(),
    userId: req.user.id,
    name,
    phone
  };

  db.contacts.push(contact);
  saveDB();

  res.status(201).json({
    message: "Contact saved",
    contact: { id: contact.id, name, phone }
  });
});

// List the logged-in user's contacts
app.get("/api/contacts", auth, (req, res) => {
  const contacts = db.contacts
    .filter(c => c.userId === req.user.id)
    .map(({ id, name, phone }) => ({ id, name, phone }));

  res.json({ contacts });
});

// Send SOS alerts by SMS
app.post("/api/sos", auth, async (req, res) => {
  const contacts = db.contacts.filter(
    c => c.userId === req.user.id
  );

  if (!contacts.length) {
    return res.status(400).json({
      error: "Add an emergency contact first"
    });
  }

  const { latitude, longitude } = req.body;

  const hasLocation =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;

  const mapLink = hasLocation
    ? `https://maps.google.com/?q=${latitude},${longitude}`
    : "Location unavailable";

  const message =
    "SAFEHER EMERGENCY ALERT: The user has requested help. " +
    "Please contact them and seek assistance. Location: " + mapLink;

  if (!process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_PHONE_NUMBER) {
    return res.status(503).json({
      error: "SMS service is not configured"
    });
  }

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const results = await Promise.allSettled(
      contacts.map(contact => client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: contact.phone
      }))
    );

    const sent = results.filter(
      r => r.status === "fulfilled"
    ).length;

    res.json({
      message: "SOS request processed",
      sent,
      failed: results.length - sent,
      locationIncluded: hasLocation
    });
  } catch {
    res.status(502).json({
      error: "SMS service request failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`SafeHer API running on port ${PORT}`);
});