import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Visitor from "./models/Visitor.js";
import Chat from "./models/Chat.js";
import { getLocationFromIP } from "./utils/getLocationFromIP.js";
import cookieParser from "cookie-parser";
dotenv.config();

// ===============================
// ⚙️ Configuración inicial
// ===============================
const app = express();
app.use(express.json());
app.use(cookieParser());

// ============================
// 🔧 CORS
// ============================
const allowedOrigins = [
    "https://pfweb-nu.vercel.app",
    "http://localhost:3000",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Credentials", "true"); // 🔹 Muy importante
    }

    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ===============================
// 📦 MongoDB
// ===============================
const MONGO_URI = process.env.MONGO_URI || "";
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ Conectado a MongoDB"))
        .catch((err) => console.error("❌ Error Mongo:", err));
} else console.log("⚠️ MongoDB deshabilitado (sin MONGO_URI)");

// ===============================
// 🌐 Config modelo llama.cpp
// ===============================
const LOCAL_MODEL_URL =
    process.env.LOCAL_MODEL_URL ||
    "http://127.0.0.1:8080/v1/chat/completions";

// Modelo instalado en tu carpeta /models
const MODEL_NAME = process.env.MODEL_NAME || "mistral-7b-instruct-v0.2.Q4_0.gguf";

app.use((req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const ua = req.headers["user-agent"];
    console.log(`📡 Nueva petición → IP: ${ip} | UA: ${ua} | Ruta: ${req.method} ${req.url}`);
    next();
});

// ===============================
// 🧠 fetch con reintentos
// ===============================
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
// 🔹 Endpoint POST /api/chat
// ===============================
app.post("/api/chat", async (req, res) => {
    // ✅ Verificar consentimiento de cookies
    if (!req.cookies.cookieConsent) {
        return res.status(403).json({ error: "Consentimiento de cookies requerido." });
    }

    const { prompt, sessionId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Falta prompt" });

    console.log("🟢 POST /api/chat:", prompt);

    try {
        let history = [];
        if (sessionId) {
            const chats = await Chat.find({ sessionId }).sort({ timestamp: 1 });
            history = chats.map(c => [
                { role: "user", content: c.prompt },
                { role: "assistant", content: c.reply }
            ]).flat();
        }

        const systemMessage = {
            role: "system",
            content: `Eres un asistente experto en Full Stack Development. 
                     Tu usuario se llama Jose Manaure. 
                     Jose es desarrollador especializado en Next.js y NestJS. 
                     Su stack incluye React, Node.js, MongoDB y Tailwind. 
                     Debes responder preguntas sobre Jose y sus proyectos.`
        };

        const messages = [systemMessage, ...history, { role: "user", content: prompt }];

        const modelResponse = await fetchWithRetry(LOCAL_MODEL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages,
                stream: false
            }),
        });

        const json = await modelResponse.json();
        const assistantReply = json.choices?.[0]?.message?.content || "No recibí respuesta del modelo.";

        if (sessionId) {
            const savedChat = await Chat.create({
                prompt,
                reply: assistantReply,
                sessionId,
                timestamp: new Date(),
            });
            console.log("💾 Chat guardado:", savedChat);
        }

        res.json({ reply: assistantReply });

    } catch (err) {
        console.error("❌ Error /api/chat:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ===============================
// 🔹 SSE /api/chat-sse
// ===============================
app.get("/api/chat-sse", async (req, res) => {
    // ✅ Verificar consentimiento de cookies
    if (!req.cookies.cookieConsent) {
        return res.status(403).send("Consentimiento de cookies requerido.");
    }

    const { prompt } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    const palabrasClave = ["contratar", "empleo", "trabajo", "trabajar", "hire", "job", "reclutar", "reclutador"];
    const activarWebhook = palabrasClave.some(p => prompt.toLowerCase().includes(p));

    if (activarWebhook) {
        fetch("https://flat-trains-sleep.loca.lt/webhook/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mensaje: prompt,
                fecha: new Date().toISOString()
            }),
        }).catch(err => console.error("❌ Error enviando a n8n:", err.message));
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const CONTEXTO_PERSONAL = `
        Eres un asistente experto en desarrollo Full Stack.
        Tu usuario se llama Jose Manaure.
        Jose es desarrollador especializado en Next.js y NestJS.
        Su stack incluye React, Node.js, MongoDB y Tailwind.
        Debes responder SIEMPRE en español, de forma natural y profesional.
    `;

    try {
        const response = await fetchWithRetry(LOCAL_MODEL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: CONTEXTO_PERSONAL },
                    { role: "user", content: prompt }
                ],
                stream: true
            }),
        });

        if (!response.body) throw new Error("No hay body del modelo");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";

        for await (const chunk of response.body) {
            buffer += decoder.decode(chunk, { stream: true });

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";

            for (let line of lines) {
                line = line.trim();
                if (!line || line === "[DONE]") continue;

                if (line.startsWith("data:")) {
                    line = line.replace("data:", "").trim();
                }

                try {
                    const parsed = JSON.parse(line);
                    const token =
                        parsed.content ||
                        parsed.delta?.content ||
                        parsed.choices?.[0]?.delta?.content ||
                        "";

                    if (token) {
                        fullResponse += token;
                        res.write(`data: ${token}\n\n`);
                    }
                } catch {
                    res.write(`data: ${line}\n\n`);
                }
            }
        }

        try {
            const sessionId = req.query.sessionId || uuidv4();
            await Chat.create({
                prompt,
                reply: fullResponse,
                sessionId,
                timestamp: new Date()
            });
            console.log("💾 Chat guardado vía SSE");
        } catch (err) {
            console.error("❌ Error guardando chat SSE:", err.message);
        }

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
        let visitorId = req.cookies.visitorId;

        if (!visitorId) {
            visitorId = uuidv4();

            const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            const userAgent = req.headers["user-agent"];

            const location = await getLocationFromIP(ip);

            const visitor = new Visitor({
                visitorId,
                ip,
                userAgent,
                location,
            });

            await visitor.save();
            console.log("📍 Ubicación detectada:", location);
            console.log(`👤 Nuevo visitante: ${visitorId}`);

            const isProduction = process.env.NODE_ENV === "production";

            res.cookie("visitorId", visitorId, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? "none" : "lax",
            });
        }

        res.status(201).json({ success: true, visitorId });
    } catch (err) {
        console.error("❌ Error creando visitante:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================
// ✅ Endpoint para aceptar cookies
// ===============================
app.post("/api/cookie-consent", (req, res) => {
    res.cookie("cookieConsent", "true", {
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 año
        httpOnly: true,
        sameSite: "lax"
    });
    res.json({ success: true });
});

// ===============================
// 🩵 Raíz
// ===============================
app.get("/", (req, res) => {
    res.send("✅ Backend Relay corriendo. SSE y POST listos, conectado a LLaMA.");
});

// ===============================
// Dashboard chats
// ===============================
app.get("/api/dashboard/chats", async (req, res) => {
    try {
        const { page = 1, limit = 20, search = "" } = req.query;
        const filter = search
            ? { prompt: { $regex: search, $options: "i" } }
            : {};

        const chats = await Chat.find(filter)
            .sort({ timestamp: -1 })
            .skip((+page - 1) * +limit)
            .limit(+limit);

        const total = await Chat.countDocuments(filter);

        res.json({ chats, total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Dashboard visitors
app.get("/api/dashboard/visitors", async (req, res) => {
    try {
        const { page = 1, limit = 20, ip = "" } = req.query;
        const filter = ip ? { ip: { $regex: ip, $options: "i" } } : {};

        const visitors = await Visitor.find(filter)
            .sort({ createdAt: -1 })
            .skip((+page - 1) * +limit)
            .limit(+limit);

        const total = await Visitor.countDocuments(filter);

        res.json({ visitors, total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ===============================
// 🚀 Arranque
// ===============================
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
