// ===============================
// 📦 Dependencias
// ===============================
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import mongoose from "mongoose";
import { notifyN8n } from "./utils/notifyN8n.js";
import dotenv from "dotenv";
dotenv.config();

// ===============================
// 🌍 Variables de entorno dinámicas
// ===============================
// Estas cambian según si estás en local o producción
const isProd = process.env.NODE_ENV === "production";

const PUBLIC_BACKEND_URL = isProd
  ? "https://pfweb-nu.vercel.app" // tu front en producción
  : "http://localhost:4001"; // backend local

const N8N_WEBHOOK_URL = isProd
  ? process.env.N8N_WEBHOOK_URL_PROD
  : process.env.N8N_WEBHOOK_URL_LOCAL;

process.env.PUBLIC_BACKEND_URL = PUBLIC_BACKEND_URL;
process.env.N8N_WEBHOOK_URL = N8N_WEBHOOK_URL;

// ===============================
// ⚙️ Configuración inicial
// ===============================
const app = express();

// ======================================
// 🔧 Configurar CORS flexible
// ======================================
const allowedOrigins = [
  "http://localhost:3000",
  "https://pfweb-nu.vercel.app",
  "https://*.loca.lt", // permite túneles loca.lt
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.some((allowed) => origin?.includes(allowed.replace("*.", "")))) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// ===============================
// 📦 Conexión MongoDB
// ===============================
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/chatdb";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch((err) => console.error("❌ Error al conectar MongoDB:", err));

// ===============================
// 🧩 Modelo Chat
// ===============================
const chatSchema = new mongoose.Schema({
  prompt: String,
  reply: String,
  source: String,
  createdAt: { type: Date, default: Date.now },
});
const Chat = mongoose.model("Chat", chatSchema);

// ===============================
// 🧠 Diccionario local
// ===============================
const dictionary = [
  { question: "hola", answer: "¡Hola! 👋 Soy tu asistente virtual. Pregúntame sobre mis proyectos, experiencia o tecnologías." },
  { question: "experiencia", answer: "Tengo más de 15 años de experiencia como desarrollador full stack, trabajando con React, Node.js y MongoDB." },
  { question: "react", answer: "React es mi principal herramienta para construir interfaces dinámicas y rápidas con excelente experiencia de usuario." },
  { question: "node", answer: "Node.js me permite crear el backend de mis aplicaciones full stack, gestionando APIs y servidores eficientemente." },
  { question: "mongodb", answer: "MongoDB lo uso como base de datos NoSQL escalable y flexible." },
  { question: "tailwind", answer: "TailwindCSS me permite diseñar interfaces limpias y responsivas rápidamente." },
];

// ===============================
// 🔹 Funciones auxiliares
// ===============================
function tokenize(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/).filter(Boolean);
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function getSmartAnswer(userMessage) {
  let bestScore = 0;
  let bestAnswer = null;
  for (const item of dictionary) {
    const score = jaccardSimilarity(userMessage, item.question);
    if (score > bestScore) {
      bestScore = score;
      bestAnswer = item.answer;
    }
  }
  return bestScore > 0.3 ? bestAnswer : null;
}

// ===============================
// 🔹 Contexto personalizado
// ===============================
const personalContext = `
Eres un asistente de inteligencia artificial.
Responde SIEMPRE en español neutro, claro y natural, sin usar palabras en inglés.
El usuario es José Manaure, desarrollador full stack experto en React, Node.js, UI/UX y testing.
Menciona ejemplos de su experiencia y proyectos, pero evita traducir o escribir frases en inglés.
`;


// ===============================
// ⚙️ Modelo local llama.cpp
// ===============================
const LLAMA_BINARY = "/Users/jnanaure87/Desktop/portafolio-senior/myGpt/backend/llama.cpp/build/bin/llama-cli";
const MODEL_PATH = "/Users/jnanaure87/Desktop/portafolio-senior/myGpt/backend/models/mistral-7b-instruct-v0.2.Q4_0.gguf";

// ===============================
// 🔹 Flujo de contacto automático
// ===============================
const contactSessions = new Map();
const contactFields = ["nombre", "apellido", "email", "asunto"];
const contactQuestions = {
  nombre: "¿Cuál es tu nombre?",
  apellido: "¿Cuál es tu apellido?",
  email: "¿Cuál es tu email?",
  asunto: "¿Cuál es el asunto o mensaje que quieres dejarme?",
};

// ===============================
// 🧹 Función para limpiar texto SSE
// ===============================
function cleanText(chunk) {
  return chunk
    // Elimina etiquetas o restos del prompt
    .replace(/^\[INST\][\s\S]*?\> /, "")
    // Une fragmentos cortados de palabras (Man a ure → Manaure)
    .replace(/([A-Za-zÁÉÍÓÚáéíóúÑñ])\s+([a-záéíóúñ])/g, "$1$2")
    // Corrige múltiples espacios
    .replace(/\s{2,}/g, " ")
    // Asegura espacio después de comas y puntos
    .replace(/([.,!?])(?=[^\s])/g, "$1 ")
    // Limpia caracteres raros
    .replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ¡¿]/g, "")
    // Quita espacios iniciales y finales
    .trim();
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

// ===============================
// 🔹 Endpoint SSE (streaming)
// ===============================
app.get("/api/chat-sse", async (req, res) => {
  const { prompt, sessionId } = req.query;
  if (!prompt) return res.status(400).json({ error: "Falta prompt" });

  console.log("📡 SSE conectado:", prompt);

  // Diccionario local
  const localAnswer = getSmartAnswer(prompt);
  if (localAnswer) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${localAnswer}\n\n`);
    res.write(`data: [FIN]\n\n`);
    return res.end();
  }

  // Streaming desde llama.cpp
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const formattedPrompt = `${personalContext}\nUsuario: ${prompt}\nAsistente:`;
  const child = spawn(LLAMA_BINARY, [
    "--model", MODEL_PATH,
    "--prompt", formattedPrompt,
    "--n-predict", "200",
    "--threads", "4",
  ]);

  let fullResponse = "";

  let responseStarted = false;
  let buffer = "";

  child.stdout.on("data", (data) => {
    buffer += data.toString();

    // Solo procesamos cuando ya tenemos algo de contenido
    if (!responseStarted && buffer.includes("[/INST]")) {
      // Cortamos hasta después de [/INST]
      buffer = buffer.split("[/INST]")[1] || "";
      responseStarted = true;
    }

    if (responseStarted) {
      const cleaned = cleanText(buffer);
      buffer = ""; // limpiamos para acumular lo siguiente
      fullResponse += cleaned + " ";
      res.write(`data: ${cleaned}\n\n`);
    }
  });

  child.stderr.on("data", (err) => console.error("⚠️ llama stderr:", err.toString()));

  child.on("close", async () => {
    fullResponse = fullResponse.trim();
    await Chat.create({ prompt, reply: fullResponse, source: "llama-sse" });
    res.write(`data: [FIN]\n\n`);
    res.end();
  });
});

// ===============================
// 🔹 Historial de chat
// ===============================
app.get("/api/history", async (req, res) => {
  try {
    const chats = await Chat.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({ chats });
  } catch (err) {
    console.error("❌ Error al obtener historial:", err);
    res.status(500).json({ error: "Error fetching chat history" });
  }
});

// ===============================
// 🩵 Base
// ===============================
app.get("/", (req, res) => {
  res.send("✅ Servidor de José Manaure activo en modo " + (isProd ? "PRODUCCIÓN" : "LOCAL"));
});

// ===============================
// 🚀 Arranque
// ===============================
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en ${PUBLIC_BACKEND_URL}`);
});
