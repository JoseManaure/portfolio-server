import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import Visitor from "./models/Visitor.js";
import Chat from "./models/Chat.js"; // asumo que tenías este modelo
import { spawn } from "child_process";
import dotenv from "dotenv";
dotenv.config()
// ===============================
// ⚙️ Configuración inicial
// ===============================
const app = express();
app.use(express.json());

// ============================
// 🔧 CORS
// ============================
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
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "";
const BACKEND_URL = process.env.BACKEND_URL || "https://portfolio-server-production-67e9.up.railway.app";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";

// ===============================
// 🧠 Función fetch con reintentos
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 90000) {
    if (!url) throw new Error("URL no definida");
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
// 🔹 Endpoint /api/chat
// ===============================
const contactSessions = new Map();
const contactFields = ["nombre", "apellido", "email", "asunto"];
const contactQuestions = {
    nombre: "¿Cuál es tu nombre?",
    apellido: "¿Cuál es tu apellido?",
    email: "¿Cuál es tu email?",
    asunto: "¿Cuál es el asunto de tu mensaje?",
};

app.post("/api/chat", async (req, res) => {
    const { prompt, sessionId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Falta prompt" });

    console.log("🟢 POST /api/chat:", prompt);

    const normalized = prompt.toLowerCase().trim();
    const triggerKeywords = ["contratar", "servicio", "precio", "presupuesto", "trabajar contigo", "cotización"];
    const shouldTriggerWebhook = triggerKeywords.some(kw => normalized.includes(kw));

    let session = contactSessions.get(sessionId);

    if (shouldTriggerWebhook && !session) {
        session = { currentField: 0, data: {} };
        contactSessions.set(sessionId, session);
        return res.json({ reply: contactQuestions[contactFields[0]], source: "formulario-contacto" });
    }

    if (session) {
        const field = contactFields[session.currentField];
        session.data[field] = prompt;
        session.currentField++;
        if (session.currentField < contactFields.length) {
            contactSessions.set(sessionId, session);
            return res.json({ reply: contactQuestions[contactFields[session.currentField]], source: "formulario-contacto" });
        } else {
            try {
                const msg = session.data;
                if (N8N_WEBHOOK_URL) {
                    await fetchWithRetry(N8N_WEBHOOK_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt, sessionId, msg }),
                    });
                    console.log("📡 Datos enviados a n8n:", msg);
                }
            } catch (err) {
                console.error("❌ Error enviando a n8n:", err);
            }
            contactSessions.delete(sessionId);
            await Chat.create({ prompt, reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.", source: "formulario-completo" });
            return res.json({ reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.", source: "formulario-completo" });
        }
    }

    return res.json({ reply: "❌ No se pudo procesar el prompt.", source: "error" });
});

// ===============================
// 🧠 Endpoint SSE
// ===============================
app.get("/api/chat-sse", async (req, res) => {
    const { prompt, sessionId } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const modelUrl = LOCAL_MODEL_URL || `${BACKEND_URL}/completion`;
    console.log("📡 Conectando al modelo:", modelUrl);

    try {
        const response = await fetchWithRetry(modelUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, stream: true }),
        });

        if (!response.body) throw new Error("No hay body del modelo");

        const decoder = new TextDecoder();
        let partialText = "";
        for await (const chunk of response.body) {
            partialText += decoder.decode(chunk, { stream: true });
            const lines = partialText.split(/\r?\n/);
            partialText = lines.pop() || "";
            for (let line of lines) {
                if (!line || line === "[FIN]") continue;
                res.write(`data: ${line}\n\n`);
            }
        }
        if (partialText.trim()) res.write(`data: ${partialText.trim()}\n\n`);
        res.write("data: [FIN]\n\n");
        res.end();
    } catch (err) {
        console.error("❌ SSE error:", err.message);
        res.write(`data: ⚠️ Error al conectar con el modelo: ${err.message}\n\n`);
        res.write("data: [FIN]\n\n");
        res.end();
    }
});

// ===============================
// 🔹 Visitor
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
// 🩵 Raíz
// ===============================
app.get("/", (req, res) => {
    res.send("✅ Backend Relay de José Manaure en Railway, SSE listo y conectado al modelo local.");
});

// ===============================
// 🚀 Arranque
// ===============================
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
