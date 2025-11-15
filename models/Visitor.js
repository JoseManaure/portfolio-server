// models/Visitor.js
import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
    role: String,
    content: String,
    time: String,
});

const VisitorSchema = new mongoose.Schema({
    visitorId: String,
    ip: String,
    userAgent: String,
    location: {
        lat: Number,
        lon: Number,
        city: String,
        country: String
    }
}, { timestamps: true });

export default mongoose.models.Visitor || mongoose.model("Visitor", VisitorSchema);
