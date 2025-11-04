import axios from "axios";

// Ajusta el endpoint según tu server.js
const API_URL = "http://localhost:4000/api/chat";

async function testChat() {
  try {
    const response = await axios.post(API_URL, {
        prompt: "Hola, ¿cómo estás?"
      });

    console.log("Respuesta del backend:");
    console.log(response.data);
  } catch (error) {
    console.error("Error conectando al backend:", error.message);
    if (error.response) {
      console.error("Detalles del error:", error.response.data);
    }
  }
}

testChat();
