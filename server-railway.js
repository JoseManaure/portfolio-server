// ===============================
// 🌍 Backend Relay para Railway con SSE + n8n
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
    if (allowedOrigins.includes(origin)) res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ===============================
// 📦 MongoDB (opcional)
const MONGO_URI = process.env.MONGO_URI || "";
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ Conectado a MongoDB (Railway)"))
        .catch((err) => console.error("❌ Error Mongo:", err));
} else console.log("⚠️ MongoDB deshabilitado (sin MONGO_URI)");

// ===============================
// 🌐 URLs
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://neat-lines-fry.loca.lt";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://f8e85894b3ed.ngrok-free.app/webhook/chat";

// ===============================
// 🧠 Función fetch con reintentos
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 30000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
            return response;
        } catch (err) {
            console.warn(`⚠️ Fetch intento ${attempt} fallido: ${err.message}`);
            if (attempt === retries) throw err;
        }
    }
}

// ===============================
// 🧠 Endpoint SSE al modelo local
// ===============================
// 🧠 Endpoint SSE universal
// ===============================
app.get("/api/chat-sse", async (req, res) => {
    const { prompt, sessionId } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    // Headers SSE
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const isLocal = process.env.NODE_ENV !== "production";

    try {
        // 🔹 En local: usamos el modelo local (loca.lt o puerto)
        if (isLocal) {
            console.log("💻 Usando modelo local:", LOCAL_MODEL_URL);

            const response = await fetchWithRetry(`${LOCAL_MODEL_URL}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, sessionId }),
            });

            if (!response.body) throw new Error("No hay body del modelo local");

            const decoder = new TextDecoder();
            for await (const chunk of response.body) {
                let textChunk = decoder.decode(chunk);
                textChunk = textChunk.replace(/^data:\s*/g, "").trim();
                if (!textChunk || textChunk === "[FIN]") continue;
                res.write(`data: ${textChunk}\n\n`);
            }

            res.write("data: [FIN]\n\n");
            res.end();
        }
        // 🔹 En producción: redirigimos a n8n
        else {
            console.log("🌐 Producción: enviando prompt a n8n");
            await fetchWithRetry(N8N_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, sessionId }),
            });

            res.write(`data: 📡 Prompt recibido: ${prompt}\n\n`);
            res.write(`data: Procesado por n8n\n\n`);
            res.write("data: [FIN]\n\n");
            res.end();
        }

    } catch (err) {
        console.error("❌ Error SSE:", err.message);
        res.write(`data: ❌ Error: ${err.message}\n\n`);
        res.end();
    }

    // 🔹 Heartbeat SSE para mantener viva la conexión
    const interval = setInterval(() => res.write("data: 💓\n\n"), 15000);
    req.on("close", () => clearInterval(interval));
});


// ===============================
// 🔹 Historial de chat
app.get("/api/history", (req, res) => {
    res.status(200).json({ message: "Historial deshabilitado en versión relay." });
});

// ===============================
// 🩵 Endpoint raíz
app.get("/", (req, res) => {
    res.send("✅ Backend Relay de José Manaure en Railway, SSE listo y conectado al modelo local.");
});

// ===============================
// 🚀 Arranque del servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
