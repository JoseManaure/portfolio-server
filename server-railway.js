import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Visitor from "./models/Visitor.js";
import Chat from "./models/Chat.js";
dotenv.config();

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
    const { prompt, sessionId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Falta prompt" });

    console.log("🟢 POST /api/chat:", prompt);

    try {
        // Historial
        let history = [];
        if (sessionId) {
            const chats = await Chat.find({ sessionId }).sort({ timestamp: 1 });
            history = chats.map(c => [
                { role: "user", content: c.prompt },
                { role: "assistant", content: c.reply }
            ]).flat();
        }

        // Mensaje de sistema con tu contexto
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

        // Guardar en Mongo
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
    const { prompt } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // ================================
    // 1. DETECCIÓN DE PALABRAS CLAVE
    // ================================
    const keywords = ["contratar", "empleo", "vacante", "trabajo", "reclutar", "curriculum", "cv"];
    const contienePalabrasClave = keywords.some(k => prompt.toLowerCase().includes(k));

    // ================================
    // 2. SI TIENE PALABRA CLAVE → DISPARAR N8N Y RESPONDER MANUAL
    // ================================
    if (contienePalabrasClave) {
        try {
            // Enviar a n8n
            await fetch("https://flat-trains-sleep.loca.lt/webhook/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt })
            });
        } catch (error) {
            console.log("⚠️ Error enviando a n8n:", error.message);
        }

        // RESPUESTA PERSONALIZADA PROFESIONAL
        const respuestaProfesional = `
Hola, gracias por tu interés en mi perfil profesional.

Soy Jose Manaure, desarrollador Full Stack especializado en **Next.js y NestJS**, con experiencia en:
- React
- Node.js
- MongoDB
- Tailwind
- Docker
- Arquitecturas limpias y escalables

Si deseas contratarme o saber más sobre mis proyectos, estaré encantado de ayudarte.
`;

        // Enviar por SSE simulando stream real
        const partes = respuestaProfesional.split(" ");
        for (const parte of partes) {
            res.write(`data: ${parte}\n\n`);
            await new Promise(r => setTimeout(r, 25)); // efecto typing
        }

        res.write("data: [FIN]\n\n");
        return res.end();  // 🔥 Importante: NO sigue al modelo
    }

    // ================================
    // 3. SI NO HAY PALABRAS CLAVE → VA AL MODELO LOCAL
    // ================================

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

                    if (token) res.write(`data: ${token}\n\n`);
                } catch {
                    res.write(`data: ${line}\n\n`);
                }
            }
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
    res.send("✅ Backend Relay corriendo. SSE y POST listos, conectado a LLaMA.");
});

// ===============================
// 🚀 Arranque
// ===============================
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
