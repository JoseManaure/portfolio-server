// ===============================
// 🌍 Backend Relay para Railway
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
// 🌐 URL del modelo local
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://soft-pandas-hammer.loca.lt";

// ===============================
// 🌐 URL de n8n
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://f8e85894b3ed.ngrok-free.app/webhook";

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
// 🧠 Endpoint principal: relay a tu modelo local
// ===============================
// 🧠 Endpoint principal: relay SSE
app.post("/api/chat", async (req, res) => {
    try {
        const { prompt, sessionId } = req.body;
        if (!prompt) return res.status(400).json({ error: "Falta prompt" });

        console.log("🚀 Relay → reenviando prompt al modelo local...");

        // Configuramos SSE
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${LOCAL_MODEL_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, sessionId }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.body) throw new Error("No hay body del modelo local");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            let chunk = decoder.decode(value);
            chunk = chunk.replace(/^data:\s*/g, "").trim();
            if (!chunk || chunk === "[FIN]") continue;

            // Enviamos cada chunk al frontend como SSE
            res.write(`data: ${chunk}\n\n`);
        }

        // Indicamos fin del stream
        res.write("data: [FIN]\n\n");
        res.end();

    } catch (err) {
        console.error("❌ Error en relay:", err);
        res.write(`data: ❌ Error comunicando con el modelo local: ${err.message}\n\n`);
        res.end();
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
    res.send("✅ Servidor Relay de José Manaure en Railway, conectado al modelo local.");
});

// ===============================
// 🚀 Arranque del servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
