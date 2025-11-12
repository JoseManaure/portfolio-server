// ===============================
// 🌍 Backend Relay con SSE + Mongo + n8n
// ===============================
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import Visitor from "./models/Visitor.js";

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
// 📦 Conexión MongoDB
// ===============================
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
// 🌐 URLs y Webhooks
// ===============================
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://many-trams-relax.loca.lt"; // 👈 cambia por tu tunnel
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://c39b9b66690c.ngrok-free.app";

// ===============================
// 🧠 Fetch con reintentos y timeout
// ===============================
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 90000) {
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
// 🧩 Endpoint principal SSE -> llama-server
// ===============================
app.get("/api/chat-sse", async (req, res) => {
    const { prompt, sessionId } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    console.log(`📡 SSE iniciado: prompt="${prompt}", session=${sessionId}`);

    try {
        // 🧠 Conectamos directamente a llama-server
        const response = await fetchWithRetry(`${LOCAL_MODEL_URL}/completion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: `Responde en español, con estilo profesional.\nUsuario: ${prompt}\nAsistente:`,
                stream: true,
                temperature: 0.7,
                n_predict: 200,
            }),
        });

        if (!response.body) throw new Error("No hay body en la respuesta del modelo.");

        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
            const text = decoder.decode(chunk, { stream: true });
            res.write(`data: ${text}\n\n`);
        }

        res.write(`data: [FIN]\n\n`);
        res.end();
    } catch (err) {
        console.error("❌ Error SSE:", err.message);
        res.write(`data: ⚠️ Error al conectar con el modelo local.\n\n`);
        res.write(`data: Detalle técnico: ${err.message}\n\n`);
        res.write(`data: [FIN]\n\n`);
        res.end();

        if (err.message.includes("Tunnel Unavailable"))
            console.warn("🔌 El túnel LOCAL_MODEL_URL (loca.lt) ya no está disponible.");
        else if (err.name === "AbortError")
            console.warn("⏱️ Timeout alcanzado.");
    }
});

// ===============================
// 👥 Registro de visitantes
// ===============================
app.post("/api/visitor", async (req, res) => {
    try {
        const visitorId = uuidv4();
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const userAgent = req.headers["user-agent"];

        const visitor = new Visitor({ visitorId, ip, userAgent });
        await visitor.save();

        console.log(`👤 Nuevo visitante: ${visitorId}`);
        res.status(201).json({ success: true, visitorId });
    } catch (err) {
        console.error("❌ Error creando visitante:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================
// 🩵 Endpoint raíz
// ===============================
app.get("/", (req, res) => {
    res.send("✅ Backend Relay de José Manaure corriendo con SSE y llama-server.");
});

// ===============================
// 🚀 Iniciar servidor
// ===============================
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
