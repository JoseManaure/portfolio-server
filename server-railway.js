// ===============================
// 🌍 Backend Relay para Railway
// ===============================
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

// ===============================
// ⚙️ Configuración inicial
// ===============================
const app = express();
app.use(express.json());

// ===============================
// 🔧 CORS
// ===============================
const allowedOrigins = [
    "https://pfweb-nu.vercel.app",
    "http://localhost:3000",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ===============================
// 📦 MongoDB (opcional, puedes omitir si solo relay)
// ===============================
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatdb";
mongoose
    .connect(MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB (Railway)"))
    .catch((err) => console.error("❌ Error Mongo:", err));

// ===============================
// 🌐 URL del modelo local (LocalTunnel o Ngrok)
// ===============================
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://sour-pandas-lie.loca.lt";

// ===============================
// 🧠 Endpoint principal: relay a tu modelo local
// ===============================
app.post("/api/chat", async (req, res) => {
    try {
        const { prompt, sessionId } = req.body;
        if (!prompt) return res.status(400).json({ error: "Falta prompt" });

        console.log("🚀 Relay -> reenviando prompt al modelo local...");

        // 🔁 Reenvía la solicitud al modelo local
        const response = await fetch(`${LOCAL_MODEL_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, sessionId }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Error del modelo local: ${text}`);
        }

        // 🔙 Retorna la respuesta al frontend
        const data = await response.text();
        res.setHeader("Content-Type", "text/event-stream");
        res.write(data);
        res.end();

    } catch (err) {
        console.error("❌ Error en relay:", err);
        res.status(500).json({ error: "Error comunicando con el modelo local." });
    }
});

// ===============================
// 🔹 Historial de chat (opcional)
// ===============================
app.get("/api/history", async (req, res) => {
    res.status(200).json({ message: "Historial deshabilitado en versión relay." });
});

// ===============================
// 🩵 Endpoint raíz
// ===============================
app.get("/", (req, res) => {
    res.send("✅ Servidor Relay de José Manaure en Railway, conectado al modelo local.");
});

// ===============================
// 🚀 Arranque del servidor
// ===============================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
