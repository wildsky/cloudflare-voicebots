# Twilio Phone Integration Setup

This guide will help you set up Twilio so users can call in by phone and speak with the voice agent.

## Step 1: Set Up Twilio Account

1. Sign up for a Twilio account at https://twilio.com
2. Get a Twilio phone number from the console
3. Find your Account SID and Auth Token in the console

## Step 2: Configure Environment Variables

Add these variables to your `.dev.vars` file:

```
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WEBHOOK_SECRET=your_webhook_secret_here
CLOUDFLARE_WORKERS_URL=https://your-worker-domain.workers.dev
```

Then deploy the secrets:

```bash
wrangler secret bulk .dev.vars
```

## Step 3: Deploy Your Worker

Deploy your updated worker with Twilio support:

```bash
npm run deploy
```

## Step 4: Configure Twilio Webhook URLs

In your Twilio console, configure your phone number with these webhook URLs:

### Voice Webhook (Primary)

- URL: `https://your-worker-domain.workers.dev/twilio/voice`
- HTTP Method: POST

### Status Callback URL (Optional)

- URL: `https://your-worker-domain.workers.dev/twilio/status`
- HTTP Method: POST

## Step 5: Test the Integration

1. Call your Twilio phone number
2. You should hear: "Hello! Please wait while I connect you to the voice agent."
3. The call will connect to a WebSocket stream for real-time audio
4. Speak to test voice recognition and AI responses

## How It Works

### Call Flow

1. User calls Twilio number
2. Twilio sends webhook to `/agents/twiliovoice/twilio/voice`
3. TwilioVoiceAgent returns TwiML to start media stream
4. WebSocket connection established for real-time audio
5. Audio flows: Phone → Twilio → Worker → Deepgram STT → GPT-4 → Inworld TTS → Twilio → Phone

### Components

- **TwilioVoiceAgent**: Extended VoiceAgent with Twilio webhook handling
- **TwilioService**: Handles Twilio-specific audio processing and TwiML generation
- **Database Integration**: Automatic user lookup by phone number
- **Real-time Audio**: Bidirectional audio streaming via WebSockets

### User Database Integration

- When a user calls, the system looks up their profile by phone number
- Uses existing database tables (users, call_activity, core_memories, etc.)
- Provides personalized responses based on user history and preferences

## Troubleshooting

### Common Issues

1. **Webhook timeout**: Make sure your worker responds quickly to webhook requests
2. **Audio quality**: Twilio uses μ-law encoding - ensure proper audio conversion
3. **WebSocket connection**: Verify WebSocket URL is accessible and uses wss://

### Debug Logs

- Check Cloudflare Workers logs for webhook and audio processing errors
- Monitor Twilio console for call status and error details
- Use `logger.debug` statements to trace audio flow

### Audio Format Notes

- Twilio sends/expects audio in G.711 μ-law format
- Audio is base64 encoded in WebSocket messages
- Sample rate: 8kHz, 16-bit samples

## Available Features

With phone integration, users can:

- Call in and speak naturally with the AI agent
- Get personalized responses based on their user profile
- Have conversations that are tracked in call_activity and core_memories tables
- Use all existing database tools (shopping lists, user info, etc.) via voice

The voice agent has the same capabilities as the web version, including:

- Natural conversation with GPT-4
- Real-time voice synthesis with Inworld TTS
- Database access for personalized responses
- Shopping list management
- Memory of previous conversations
