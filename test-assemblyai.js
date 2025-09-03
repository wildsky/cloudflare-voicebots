// Minimal AssemblyAI WebSocket connection test
// Run with: node test-assemblyai.js

const API_KEY = "f9a4549cbdb846cfbd292c8e8771eb0d";
const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&token=${API_KEY}`;

console.log(
  "🔧 Testing AssemblyAI Universal Streaming WebSocket connection..."
);
console.log("URL:", wsUrl.replace(API_KEY, "***"));

try {
  const ws = new WebSocket(wsUrl);
  console.log("🔄 WebSocket object created successfully");

  ws.onopen = () => {
    console.log("🎉 CONNECTION OPENED SUCCESSFULLY!");
    ws.close();
  };

  ws.onerror = (error) => {
    console.log("💥 ERROR:", error);
  };

  ws.onclose = (event) => {
    console.log("💔 CONNECTION CLOSED:", {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
  };

  ws.onmessage = (event) => {
    console.log("📨 MESSAGE:", event.data);
  };

  // Timeout after 10 seconds
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log("⏰ TIMEOUT: Connection did not open within 10 seconds");
      console.log("ReadyState:", ws.readyState);
      ws.close();
    }
  }, 10000);
} catch (error) {
  console.error("💥 EXCEPTION DURING CREATION:", error);
}
