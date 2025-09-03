// Direct test of the weather tool
import { tools } from "./src/tools/index.js";

async function testWeatherTool() {
  console.log("Available tools:", Object.keys(tools));

  if (tools.getWeatherInformation) {
    console.log("Weather tool found! Testing execution...");

    try {
      const result = await tools.getWeatherInformation.execute({
        city: "Seattle, WA",
      });
      console.log("Weather tool result:", result);
    } catch (error) {
      console.error("Weather tool error:", error);
    }
  } else {
    console.log("Weather tool not found in tools");
    console.log("Tools structure:", tools);
  }
}

testWeatherTool();
