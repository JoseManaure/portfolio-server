import fetch from "node-fetch";

export async function notifyN8n(message, title = "Nuevo mensaje") {
    try {
        const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL || "https://f8e85894b3ed.ngrok-free.app/webhook/chat";

        // Enviar mensaje como JSON
        const res = await fetch(N8N_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, message }),
        });

        if (!res.ok) {
            console.error("❌ Error enviando a n8n:", res.status, await res.text());
        } else {
            console.log("📡 Notificación enviada a n8n:", message);
        }
    } catch (err) {
        console.error("❌ Error enviando a n8n:", err);
    }
}
