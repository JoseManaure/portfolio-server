// ===============================
// 🌍 Backend Relay para Railway con SSE + n8n
// ===============================
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import Visitor from "./models/Visitor.js";

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
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "https://ready-bags-jam.loca.lt";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://c39b9b66690c.ngrok-free.app/webhook/chat";

// ===============================
// 🧠 Función fetch con reintentos
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
// 🔹 Endpoint /api/chat
// ===============================
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
                const telegramMessage = `📩 Nuevo contacto:
  Nombre: ${msg.nombre}
  Apellido: ${msg.apellido}
  Email: ${msg.email}
  Asunto: ${msg.asunto}`;

                await notifyN8n(telegramMessage, "Formulario completado");
                console.log("📡 Datos enviados a Telegram:", msg);
            } catch (err) {
                console.error("❌ Error enviando a Telegram:", err);
            }

            contactSessions.delete(sessionId);
            await Chat.create({ prompt, reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.", source: "formulario-completo" });

            return res.json({ reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.", source: "formulario-completo" });
        }
    }

    const localAnswer = getSmartAnswer(prompt);
    if (localAnswer) return res.json({ reply: localAnswer, source: "dictionary" });

    // 🔹 SSE con llama.cpp
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const formattedPrompt = `[INST] ${personalContext.trim()} \nUsuario: ${prompt} \nResponde solo en español. [/INST]`;
    const child = spawn(LLAMA_BINARY, [
        "--model", MODEL_PATH,
        "--prompt", formattedPrompt,
        "--n-predict", "30",
        "--threads", "4",
    ]);
    let fullResponse = "";
    let buffer = "";
    let responseStarted = false;

    child.stdout.on("data", (data) => {
        buffer += data.toString();

        // Detectar inicio real del texto
        if (!responseStarted && buffer.includes("[/INST]")) {
            buffer = buffer.split("[/INST]")[1] || "";
            responseStarted = true;
        }

        if (responseStarted) {
            // Procesar en bloques cada 50 caracteres (mejor coherencia)
            if (buffer.length > 50) {
                const cleaned = cleanText(buffer);
                res.write(`data: ${cleaned}\n\n`);
                fullResponse += cleaned + " ";
                buffer = "";
            }
        }
    });

    child.on("close", async () => {
        if (buffer.trim()) {
            const cleaned = cleanText(buffer);
            res.write(`data: ${cleaned}\n\n`);
            fullResponse += cleaned + " ";
        }
        await Chat.create({ prompt, reply: fullResponse.trim(), source: "llama-local" });
        res.write(`data: [FIN]\n\n`);
        res.end();
    });

});


const corsOptions = {
    origin: ["https://pfweb-nu.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};

// ===============================
// 🧠 Endpoint SSE al modelo local (con limpieza y trigger n8n)
// ===============================
app.get("/api/chat-sse", cors(corsOptions), async (req, res) => {
    const { prompt, sessionId } = req.query;
    if (!prompt) return res.status(400).send("Falta prompt");

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });



    console.log(`📡 SSE iniciado: prompt="${prompt}", session=${sessionId}`);

    // 🧩 Palabras clave para activar n8n
    const triggerWords = ["contratar", "contactar", "telegram", "mensaje"];

    try {
        // 1️⃣ Conectar al modelo local
        const response = await fetchWithRetry(`${LOCAL_MODEL_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, sessionId }),
        });

        if (!response.body) throw new Error("No hay body del modelo local");

        const decoder = new TextDecoder();
        let partialText = ""; // para detectar palabras cortadas
        let buffer = "";

        for await (const chunk of response.body) {
            let textChunk = decoder.decode(chunk, { stream: true });
            textChunk = textChunk.replace(/^data:\s*/g, "");

            // 🔹 Acumula por si vienen fragmentos partidos
            partialText += textChunk;

            // Procesa por líneas completas
            const lines = partialText.split(/\r?\n/);
            partialText = lines.pop() || ""; // guarda el sobrante no terminado

            for (let line of lines) {
                line = line.trim();
                if (!line || line === "[FIN]") continue;

                // 🧹 Limpieza avanzada
                line = line
                    .replace(/\[INST\][\s\S]*?\]/g, "")
                    .replace(/\s{2,}/g, " ")
                    .replace(/([.,!?])(?=[^\s])/g, "$1 ")
                    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ¡¿.,!?]/g, "")
                    .trim();

                // Si el último carácter del buffer y el primero del nuevo no tienen espacio, agrégalo
                const needsSpace = buffer && !buffer.endsWith(" ") && !line.startsWith(" ");
                buffer += (needsSpace ? " " : "") + line;

                res.write(`data: ${line}\n\n`);
            }
        }

        if (partialText.trim()) {
            res.write(`data: ${partialText.trim()}\n\n`);
        }

        res.write("data: [FIN]\n\n");
        res.end();

        // 2️⃣ Enviar también a n8n si el prompt contiene alguna palabra clave
        if (triggerWords.some(w => prompt.toLowerCase().includes(w))) {
            console.log("🤖 Trigger n8n activado por palabra clave:", prompt);
            fetchWithRetry(N8N_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, sessionId }),
            })
                .then(() => console.log("📡 Datos enviados a n8n"))
                .catch((err) => console.warn("❌ Error enviando a n8n:", err.message));
        }

    } catch (err) {
        console.error("❌ Error SSE:", err.message);
        res.write(`data: ⚠️ Error al conectar con el modelo local.\n\n`);
        res.write(`data: Detalle técnico: ${err.message}\n\n`);
        res.write(`data: [FIN]\n\n`);
        res.end();

        if (err.message.includes("Tunnel Unavailable"))
            console.warn("🔌 El túnel LOCAL_MODEL_URL (loca.lt) ya no está disponible.");
        else if (err.name === "AbortError")
            console.warn("⏱️ Conexión abortada (timeout alcanzado).");
    }
});



// ===============================
// 🔹 Historial de chat
app.get("/api/history", (req, res) => {
    res.status(200).json({ message: "Historial deshabilitado en versión relay." });
});


app.post("/api/visitor", async (req, res) => {
    try {
        // Genera un nuevo ID para el visitante
        const visitorId = uuidv4();

        // Detecta IP y User-Agent (solo para info general)
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const userAgent = req.headers["user-agent"];

        // Guarda en MongoDB
        const visitor = new Visitor({
            visitorId,
            ip,
            userAgent,
        });
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
app.get("/", (req, res) => {
    res.send("✅ Backend Relay de José Manaure en Railway, SSE listo y conectado al modelo local.");
});

// ===============================
// 🚀 Arranque del servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend Relay corriendo en puerto ${PORT}`);
});
