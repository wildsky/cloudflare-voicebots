import WebSocket from "ws";

async function testWeatherRequest() {
  const agentUrl =
    "wss://cloudflare-voicebots.v5bqjpxcbw.workers.dev/agents/voicechat/test-room";

  console.log("Connecting to agent...");
  const ws = new WebSocket(agentUrl);

  ws.on("open", () => {
    console.log("Connected! Sending weather request...");

    // Send a text message asking about weather
    const message = {
      type: "chat",
      content: "What's the weather in Seattle, WA?",
    };

    ws.send(JSON.stringify(message));
    console.log("Message sent:", message);
  });

  ws.on("message", (data) => {
    try {
      const response = JSON.parse(data.toString());
      console.log("Response:", JSON.stringify(response, null, 2));

      // Look for tool calls or text responses
      if (
        response.type === "text-delta" ||
        response.type === "tool-call" ||
        response.type === "tool-result"
      ) {
        console.log("Important response:", response);
      }
    } catch (e) {
      console.log("Raw response:", data.toString());
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("Connection closed");
  });

  // Keep the connection open for 10 seconds to see responses
  setTimeout(() => {
    console.log("Closing connection...");
    ws.close();
  }, 10000);
}

testWeatherRequest();
