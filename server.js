import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

const COUNTER_FILE = path.join(process.cwd(), "counter.json");

function safeText(s, max = 4000) {
  if (typeof s !== "string") return "";
  return s.replace(/\u0000/g, "").trim().slice(0, max);
}

function isEmailValid(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getNextPracticeCode() {
  const year = new Date().getFullYear();

  let data = { year, lastNumber: 0 };
  try {
    data = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8"));
  } catch {
    // first run -> keep defaults
  }

  if (data.year !== year) {
    data.year = year;
    data.lastNumber = 0;
  }

  data.lastNumber += 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2));

  return `DSV-${year}-${String(data.lastNumber).padStart(6, "0")}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/report", upload.single("photo"), async (req, res) => {
  try {
    const name = safeText(req.body.name, 120);
    const email = safeText(req.body.email, 200);
    const category = safeText(req.body.category, 80);
    const description = safeText(req.body.description, 4000);
    const lat = safeText(req.body.lat, 50);
    const lon = safeText(req.body.lon, 50);
    const accuracy = safeText(req.body.accuracy, 50);
    const timestamp = safeText(req.body.timestamp, 80);

    if (!name) return res.status(400).json({ error: "Nome obbligatorio" });
    if (!isEmailValid(email)) return res.status(400).json({ error: "Email non valida" });
    if (!category) return res.status(400).json({ error: "Categoria obbligatoria" });
    if (!description) return res.status(400).json({ error: "Descrizione obbligatoria" });
    if (!req.file) return res.status(400).json({ error: "Foto obbligatoria" });

    const practiceCode = getNextPracticeCode();
    const dest = process.env.DEST_EMAIL || "iw1foo@gmail.com";

    const googleMapsLink =
      lat && lon ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}` : "";

    const subject = `Segnalazione disservizio [${practiceCode}] - ${name}`;

    const textBody = [
      `Codice pratica: ${practiceCode}`,
      `Categoria: ${category}`,
      ``,
      `Nome: ${name}`,
      `Email: ${email}`,
      ``,
      `Descrizione:`,
      description,
      ``,
      `Posizione: ${lat || "n/d"}, ${lon || "n/d"} (accuratezza: ${accuracy || "n/d"} m)`,
      googleMapsLink ? `Google Maps: ${googleMapsLink}` : `Google Maps: n/d`,
      ``,
      `Timestamp dispositivo: ${timestamp || "n/d"}`,
      `Ricevuto: ${new Date().toLocaleString("it-IT")}`
    ].join("\n");

    const htmlBody = `
      <h2>Nuova segnalazione disservizio</h2>
      <p><b>Codice pratica:</b> ${escapeHtml(practiceCode)}<br/>
         <b>Categoria:</b> ${escapeHtml(category)}</p>
      <p><b>Nome:</b> ${escapeHtml(name)}<br/>
         <b>Email:</b> ${escapeHtml(email)}</p>
      <p><b>Descrizione:</b><br/>${escapeHtml(description).replace(/\n/g, "<br/>")}</p>
      <p><b>Posizione:</b> ${escapeHtml(lat || "n/d")}, ${escapeHtml(lon || "n/d")}
         (accuratezza: ${escapeHtml(accuracy || "n/d")} m)<br/>
         <b>Google Maps:</b> ${
           googleMapsLink ? `<a href="${googleMapsLink}">Apri posizione</a>` : "n/d"
         }</p>
      <p><b>Timestamp dispositivo:</b> ${escapeHtml(timestamp || "n/d")}<br/>
         <b>Ricevuto:</b> ${escapeHtml(new Date().toLocaleString("it-IT"))}</p>
    `;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: dest,
      bcc: email,
      replyTo: email,
      subject,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename: req.file.originalname || "foto.jpg",
          content: req.file.buffer,
          contentType: req.file.mimetype || "image/jpeg"
        }
      ]
    });

    res.json({ ok: true, practiceCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore invio segnalazione" });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Backend on http://localhost:${port}`));
