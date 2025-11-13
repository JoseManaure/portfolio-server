import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
    prompt: { type: String, required: true },
    reply: { type: String, required: true },
    source: { type: String, default: "llama-local" }, // o "formulario-completo"
    createdAt: { type: Date, default: Date.now },
});

const Chat = mongoose.models.Chat || mongoose.model("Chat", chatSchema);

export default Chat;
