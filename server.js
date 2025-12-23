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

function getNextPracticeCode() {
  const year = new Date().getFullYear();
  let data = { year, lastNumber: 0 };
  try { data = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")); } catch {}
  if (data.year !== year) { data.year = year; data.lastNumber = 0; }
  data.lastNumber += 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2));
  return `DSV-${year}-${String(data.lastNumber).padStart(6, "0")}`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/report", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Foto obbligatoria" });
    if (!req.body?.email) return res.status(400).json({ error: "Email obbligatoria" });

    const code = getNextPracticeCode();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,          // ✅ per Brevo su 587
      requireTLS: true,       // ✅ forza STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,  // ✅ mittente verificato in Brevo
      to: process.env.DEST_EMAIL,
      bcc: req.body.email,
      replyTo: req.body.email,
      subject: `Segnalazione ${code}`,
      text: `Codice: ${code}\nCategoria: ${req.body.category}\n${req.body.description}`,
      attachments: [
        { filename: req.file.originalname || "foto.jpg", content: req.file.buffer }
      ]
    });

    res.json({ ok: true, practiceCode: code });
  } catch (err) {
    console.error("Errore /api/report:", err);
    res.status(500).json({ error: "Errore invio segnalazione" });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("Server avviato"));
