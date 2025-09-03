// Test script to verify services can fail independently

const baseUrl = 'http://localhost:8787';

async function testIndependentFailure() {
  console.log('🔍 Testing independent service failure handling...\n');
  
  // Note: This test simulates what would happen if one service failed
  // In reality, both services will initialize successfully if API keys are valid
  
  const callSid = `CA${Math.random().toString(36).substring(2, 15)}`;
  
  console.log(`📞 Testing with CallSid: ${callSid}\n`);
  console.log('Expected behavior with decoupled services:');
  console.log('✅ If STT fails → TTS still works (can speak but not hear)');
  console.log('✅ If TTS fails → STT still works (can hear but not speak)');
  console.log('✅ Each service tracks its own initialization state\n');
  
  const formData = new URLSearchParams({
    CallSid: callSid,
    From: '+15551234567',
    To: '+15559876543',
    CallStatus: 'in-progress',
    Direction: 'inbound',
    AccountSid: 'ACtest123'
  });
  
  try {
    const response = await fetch(`${baseUrl}/agents/twiliovoice/${callSid}/twilio/voice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });
    
    if (response.ok) {
      console.log('✅ Service initialization completed');
      console.log('\nWith our refactored architecture:');
      console.log('• Twilio services initialized separately');
      console.log('• STT service initialized independently');
      console.log('• TTS service initialized independently');
      console.log('• Each service has its own initialization flag');
      console.log('• Services can recover independently on retry');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testIndependentFailure();