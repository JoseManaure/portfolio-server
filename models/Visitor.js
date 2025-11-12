// models/Visitor.js
import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
    role: String,
    content: String,
    time: String,
});

const VisitorSchema = new mongoose.Schema({
    visitorId: { type: String, unique: true },
    messages: [MessageSchema],
    createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Visitor || mongoose.model("Visitor", VisitorSchema);
