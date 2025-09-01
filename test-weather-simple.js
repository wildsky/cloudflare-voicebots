// Simple test of weather functionality
async function testWeatherFunction() {
  console.log('Testing weather function directly...');
  
  // This mimics the execute function from basics.ts
  const weatherResponse = async (city) => {
    console.log(`Getting weather information for ${city}`);
    // In production, this would call a real weather API
    return `The weather in ${city} is currently 65 degrees and partly cloudy with a chance of rain later this evening`;
  };
  
  try {
    const result = await weatherResponse("Seattle, WA");
    console.log('Weather result:', result);
    return result;
  } catch (error) {
    console.error('Weather error:', error);
    return null;
  }
}

testWeatherFunction();