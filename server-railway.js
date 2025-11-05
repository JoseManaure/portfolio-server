// ===============================
// 🌍 Backend Relay para Railway + n8n
// ===============================
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import fetch from "node-fetch";

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
// 📦 MongoDB (opcional)
const MONGO_URI = process.env.MONGO_URI || "";
if (MONGO_URI) {
    mongoose
        .connect(MONGO_URI)
        .then(() => console.log("✅ Conectado a MongoDB (Railway)"))
        .catch((err) => console.error("❌ Error Mongo:", err));
} else {
    console.log("⚠️ MongoDB deshabilitado (sin MONGO_URI)");
}

// ===============================
// 🌐 URL del modelo local y n8n
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://soft-pandas-hammer.loca.lt";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://f8e85894b3ed.ngrok-free.app"; // Debes poner aquí tu webhook de n8n

// ===============================
// 🧠 Función de fetch con reintentos y timeout
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 30000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(id);

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }

            return await response.text();
        } catch (err) {
            console.warn(`⚠️ Fetch intento ${attempt} fallido: ${err.message}`);
            if (attempt === retries) throw err;
        }
    }
}

// ===============================
// 🧠 Endpoint principal: relay a tu modelo local + n8n
app.post("/api/chat", async (req, res) => {
    try {
        const { prompt, sessionId, formData } = req.body;
        if (!prompt) return res.status(400).json({ error: "Falta prompt" });

        console.log("🚀 Relay → reenviando prompt al modelo local...");

        // 🔹 Obtener respuesta del modelo
        const data = await fetchWithRetry(`${LOCAL_MODEL_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, sessionId }),
        });

        // 🔹 Envuelve cualquier texto en JSON válido
        const modelResponse = typeof data === "string" ? { message: data } : data;

        // 🔹 Enviar a n8n si hay webhook definido y formData
        if (N8N_WEBHOOK_URL && formData) {
            try {
                const n8nResponse = await fetchWithRetry(N8N_WEBHOOK_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(formData),
                });
                console.log("📡 Datos enviados a n8n:", formData);
            } catch (n8nErr) {
                console.error("❌ Error enviando a n8n:", n8nErr.message);
            }
        }

        // 🔙 Retorna respuesta al frontend
        res.type("application/json").send(modelResponse);
    } catch (err) {
        console.error("❌ Error en relay:", err);
        res.status(500).json({
            error: "Error comunicando con el modelo local.",
            details: err.message,
        });
    }
});

// ===============================
// 🔹 Historial de chat
app.get("/api/history", (req, res) => {
    res.status(200).json({ message: "Historial deshabilitado en versión relay." });
});

// ===============================
// 🩵 Endpoint raíz
app.get("/", (req, res) => {
    res.send("✅ Servidor Relay de José Manaure en Railway, conectado al modelo local y listo para n8n.");
});

// ===============================
// 🚀 Arranque del servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
