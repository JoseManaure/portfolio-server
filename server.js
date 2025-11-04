// ===============================
// 📦 Dependencias
// ===============================
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import mongoose from "mongoose";
import { notifyN8n } from "./utils/notifyN8n.js";

// ===============================
// 🌍 Variables de entorno manuales (ajústalas si cambian los túneles)
// ===============================
process.env.PUBLIC_BACKEND_URL = "https://sour-pandas-lie.loca.lt";
process.env.N8N_WEBHOOK_URL = "https://21064a753e80.ngrok-free.app/webhook/chat";

// ===============================
// ⚙️ Configuración inicial
// ===============================
const app = express();
// ======================================
// 🔧 Configurar CORS de forma robusta
// ======================================
const allowedOrigins = [
  "http://localhost:3000",
  "https://pfweb-nu.vercel.app",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200); // ✅ responde correctamente al preflight
  }

  next();
});

app.use(express.json());


const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatdb";

// ===============================
// 📦 Conexión MongoDB
// ===============================
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
Eres un asistente IA. Responde siempre en español, con espacios correctos, puntuación y formato legible.
El usuario es José Manaure, desarrollador full stack con experiencia en React, Node.js y MongoDB, experto en UI/UX y testing de aplicaciones.
Siempre que respondas, da ejemplos o información sobre José y sus proyectos.
`;

// ===============================
// ⚙️ Configuración del modelo local
// ===============================
const LLAMA_BINARY = "/Users/jnanaure87/Desktop/portafolio-senior/myGpt/backend/llama.cpp/build/bin/llama-cli";
const MODEL_PATH = "/Users/jnanaure87/Desktop/portafolio-senior/myGpt/backend/models/mistral-7b-instruct-v0.2.Q4_0.gguf";

// ===============================
// 🔹 Flujo de contacto automático
// ===============================
const contactSessions = new Map(); // key: sessionId
const contactFields = ["nombre", "apellido", "email", "asunto"];
const contactQuestions = {
  nombre: "¿Cuál es tu nombre?",
  apellido: "¿Cuál es tu apellido?",
  email: "¿Cuál es tu email?",
  asunto: "¿Cuál es el asunto o mensaje que quieres dejarme?",
};

// ===============================
// 🔹 Endpoint chat
// ===============================
app.post("/api/chat", async (req, res) => {
  const { prompt, sessionId } = req.body;
  if (!prompt) return res.status(400).json({ error: "Falta prompt" });

  console.log("🟢 POST /api/chat:", prompt);

  const normalizedMessage = prompt.toLowerCase().trim();
  const triggerKeywords = ["contratar", "servicio", "precio", "presupuesto", "trabajar contigo", "cotización"];
  const shouldTriggerWebhook = triggerKeywords.some(kw => normalizedMessage.includes(kw));

  let session = contactSessions.get(sessionId);

  // Iniciar flujo de contacto automáticamente
  if (shouldTriggerWebhook && !session) {
    session = { currentField: 0, data: {} };
    contactSessions.set(sessionId, session);
    return res.json({ reply: contactQuestions[contactFields[0]], source: "formulario-contacto" });
  }

  // Guardar respuestas de contacto
  if (session) {
    const field = contactFields[session.currentField];
    session.data[field] = prompt;
    session.currentField += 1;

    if (session.currentField < contactFields.length) {
      contactSessions.set(sessionId, session);
      return res.json({ reply: contactQuestions[contactFields[session.currentField]], source: "formulario-contacto" });
    } else {
      // Todos los datos completos → enviar a Telegram / n8n
      const finalMessage = session.data;

      try {
        const telegramMessage = `📩 Nuevo contacto desde el chat:
Nombre: ${finalMessage.nombre}
Apellido: ${finalMessage.apellido}
Email: ${finalMessage.email}
Asunto: ${finalMessage.asunto}
Mensaje usuario: ${prompt}`;

        await notifyN8n(telegramMessage, "Formulario completado");
        console.log("📡 Datos enviados a Telegram:", finalMessage);
      } catch (err) {
        console.error("❌ Error enviando a Telegram:", err);
      }

      contactSessions.delete(sessionId);

      await Chat.create({
        prompt,
        reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.",
        source: "formulario-completo",
      });

      return res.json({ reply: "¡Gracias! Tu mensaje ha sido enviado. Te contactaré pronto.", source: "formulario-completo" });
    }
  }

  // Diccionario local
  const localAnswer = getSmartAnswer(prompt);
  if (localAnswer) return res.json({ reply: localAnswer, source: "dictionary" });

  // Streaming SSE con llama.cpp
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

  child.stdout.on("data", (data) => {
    const chunk = data.toString() + " ";
    fullResponse += chunk;
    res.write(`data: ${chunk}\n\n`);
  });

  child.stderr.on("data", (err) => console.error("⚠️ llama stderr:", err.toString()));

  child.on("close", async () => {
    fullResponse = fullResponse.trim();
    await Chat.create({ prompt, reply: fullResponse, source: "llama-local" });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  });
});

// ===============================
// 🔹 Endpoint para historial de chats
// ===============================
app.get("/api/history", async (req, res) => {
  try {
    const { sessionId } = req.query;

    let query = {};
    if (sessionId) {
      query = { sessionId }; // Filtra por sessionId si lo proporcionan
    }

    const chats = await Chat.find(query).sort({ createdAt: -1 }).lean();

    res.status(200).json({ chats });
  } catch (err) {
    console.error("❌ Error fetching chat history:", err);
    res.status(500).json({ error: "Error fetching chat history" });
  }
});


// ===============================
// 🩵 Endpoint base
// ===============================
app.get("/", (req, res) => {
  res.send("✅ Servidor de José Manaure activo con modelo local Mistral y MongoDB.");
});

// ===============================
// 🚀 Arranque del servidor
// ===============================
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
