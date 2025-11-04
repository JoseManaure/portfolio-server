// scripts/start-ngrok.js
import ngrok from "ngrok";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();

(async () => {
    try {
        console.log("🚀 Iniciando túneles ngrok...");

        // ✅ Levanta túnel para el modelo local (puerto 4000)
        const mistralUrl = await ngrok.connect({
            addr: 4000,
            proto: "http",
            authtoken: process.env.NGROK_AUTHTOKEN,
        });

        // ✅ Levanta túnel para n8n (puerto 5678)
        const n8nUrl = await ngrok.connect({
            addr: 5678,
            proto: "http",
            authtoken: process.env.NGROK_AUTHTOKEN,
        });

        console.log("✅ Modelo:", mistralUrl);
        console.log("✅ n8n:", n8nUrl);

        // ✅ Actualiza archivo .env.local
        const envPath = ".env.local";
        const env = dotenv.parse(fs.readFileSync(envPath, "utf8"));

        env.MISTRAL_API_URL = `${mistralUrl}/api/chat`;
        env.N8N_WEBHOOK_URL = `${n8nUrl}/webhook/chat`;

        const updatedEnv = Object.entries(env)
            .map(([key, val]) => `${key}=${val}`)
            .join("\n");

        fs.writeFileSync(envPath, updatedEnv);
        console.log("📝 Archivo .env.local actualizado correctamente");

        console.log("\n🌐 URLs activas:");
        console.log(`   Modelo → ${env.MISTRAL_API_URL}`);
        console.log(`   n8n → ${env.N8N_WEBHOOK_URL}`);
    } catch (err) {
        console.error("❌ Error al iniciar ngrok:", err);
    }
})();
