import WebSocket from "ws";

async function simulateVoiceInteraction() {
  // Connect directly to the Twilio voice agent endpoint
  const agentUrl =
    "wss://cloudflare-voicebots.v5bqjpxcbw.workers.dev/agents/twiliovoice/test-sim/websocket";

  console.log("Connecting to Twilio voice agent...");
  const ws = new WebSocket(agentUrl);

  ws.on("open", () => {
    console.log("Connected! Simulating Twilio stream start...");

    // First, send a Twilio "connected" event
    ws.send(
      JSON.stringify({
        event: "connected",
        protocol: "Call",
        version: "1.0.0",
      })
    );

    // Then send a "start" event to initialize the stream
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          event: "start",
          sequenceNumber: "1",
          start: {
            accountSid: "TEST_ACCOUNT",
            streamSid: "MZ_TEST_" + Date.now(),
            callSid: "CA_TEST_" + Date.now(),
            tracks: ["inbound"],
            mediaFormat: {
              encoding: "audio/x-mulaw",
              sampleRate: 8000,
              channels: 1,
            },
          },
          streamSid: "MZ_TEST_" + Date.now(),
        })
      );
    }, 100);

    // After services initialize, simulate the final transcript being saved
    // This bypasses STT and directly adds the message to the conversation
    setTimeout(() => {
      console.log(
        'Simulating user saying: "What\'s the weather in Seattle, WA?"'
      );

      // Send a chat message directly (this simulates the final transcript)
      ws.send(
        JSON.stringify({
          type: "chat",
          role: "user",
          content: "What's the weather in Seattle, WA?",
        })
      );
    }, 3000);
  });

  ws.on("message", (data) => {
    try {
      const message = data.toString();
      const parsed = JSON.parse(message);

      // Filter for relevant messages
      if (
        parsed.type === "text-delta" ||
        parsed.type === "tool-call" ||
        parsed.type === "tool-result" ||
        parsed.type === "audio-chunk" ||
        message.includes("weather") ||
        message.includes("Weather") ||
        message.includes("Seattle")
      ) {
        console.log("Response:", parsed);
      }
    } catch (e) {
      // Binary data or non-JSON
      if (
        data.toString().includes("weather") ||
        data.toString().includes("Seattle")
      ) {
        console.log(
          "Raw response contains weather info:",
          data.toString().substring(0, 200)
        );
      }
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("Connection closed");
  });

  // Keep connection open for 15 seconds to see the full response
  setTimeout(() => {
    console.log("Closing connection...");
    ws.close();
  }, 15000);
}

simulateVoiceInteraction();
