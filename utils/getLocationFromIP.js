// utils/getLocationFromIP.js
import fetch from "node-fetch";

export async function getLocationFromIP(ip) {
    try {
        const res = await fetch(`https://ipapi.co/${ip}/json/`);
        const data = await res.json();

        return {
            ip,
            country: data.country_name || "",
            city: data.city || "",
            lat: data.latitude,
            lon: data.longitude
        };
    } catch (err) {
        console.error("Error obteniendo ubicación:", err.message);
        return null;
    }
}
