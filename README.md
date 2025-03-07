# 🤖 Voice Chat Agent Starter Kit

![agents-header](./public/banner.jpeg)

A starter template for building AI-powered voice chat agents using Cloudflare's Agent platform, powered by [`agents-sdk`](https://www.npmjs.com/package/agents-sdk). This project provides a foundation for creating interactive, voice-enabled chat experiences with AI, complete with a modern 16:9 UI, conversation sidebar, tool integration, and built-in support for local microphone (STT) and speaker (TTS) interfaces.

## Features

- 🎤 Voice-to-text input using Deepgram (STT) via a local microphone
- 🔊 Text-to-speech output using ElevenLabs (TTS) routed to the browser speaker
- 💬 Interactive chat interface with AI
- 🛠️ Built-in tool system with human-in-the-loop confirmation
- 📅 Advanced task scheduling (one-time, delayed, and recurring via cron)
- 🌓 Dark/Light theme support
- ⚡️ Real-time streaming responses from AI
- 🔄 State management and chat history
- 🎨 Modern, responsive 16:9 UI with a conversation sidebar (20%) and chat area (80%)

## Prerequisites

- Cloudflare account
- OpenAI API key
- Deepgram API key
- ElevenLabs API key

## Quick Start
1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up your environment:**

   Create a `.dev.vars` file with:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   DEEPGRAM_API_KEY=your_deepgram_api_key
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   ```

3. **Run locally:**

   ```bash
   npm start
   ```

4. **Deploy:**

   ```bash
   npm run deploy
   ```

## Project Structure

The project has been reorganized to support a voice agent with modular components:

```
├── public
│   └── favicon.ico
├── src
│   ├── agent
│   │   ├── voice_agent.ts       # Main voice agent logic (STT, TTS, chat agent)
│   │   └── agent-utils.ts       # Shared agent utilities
│   ├── client
│   │   ├── app.tsx              # React UI with 16:9 layout, sidebar, chat area
│   │   └── ...                # Additional client components and styles
│   ├── services
│   │   ├── sinks
│   │   │   └── local_speaker.ts # Browser speaker sink implementation
│   │   ├── sources
│   │   │   └── local_mic.ts     # Local microphone source implementation
│   │   ├── stt
│   │   │   ├── stt.ts           # Abstract SpeechToTextService class
│   │   │   └── deepgram.ts      # Deepgram STT implementation using @deepgram/sdk v3
│   │   └── tts
│   │       └── elevenlabs.ts# ElevenLabs TTS implementation
│   ├── shared
│   │   ├── approval.ts          # Constants and helpers
│   │   └── env.ts               # Environment variable types and bindings
│   ├── tools
│   │   ├── basics.ts           # Tool definitions and examples
│   │   └── index.ts            # Aggregated tool exports
│   └── utils.ts               # Shared helper functions
│   └── server.ts               # Server entry point
├── tests
│   └── ...                    # Unit and integration tests
├── package.json
├── tsconfig.json
├── vite.config.ts
└── wrangler.jsonc
```

## Customization Guide

### Adding New Tools

Add new tools in `tools/basics.ts` using the tool builder. For example:

```typescript
// Example of a tool that requires confirmation
const searchDatabase = tool({
  description: "Search the database for user records",
  parameters: z.object({
    query: z.string(),
    limit: z.number().optional(),
  }),
  // No execute function = requires confirmation
});

// Example of an auto-executing tool
const getCurrentTime = tool({
  description: "Get current server time",
  parameters: z.object({}),
  execute: async () => new Date().toISOString(),
});

// Scheduling tool implementation
const scheduleTask = tool({
  description: "Schedule a task for later execution.",
  parameters: z.object({
    type: z.enum(["scheduled", "delayed", "cron"]),
    when: z.union([z.number(), z.string()]),
    payload: z.string(),
  }),
  execute: async ({ type, when, payload }) => {
    // ... your scheduling logic here ...
  },
});
```

Handle confirmations by adding functions to the `executions` object:

```typescript
export const executions = {
  searchDatabase: async ({ query, limit }: { query: string; limit?: number }) => {
    // Implementation for confirmed tool call
    const results = await db.search(query, limit);
    return results;
  },
  // More tool executors...
};
```

### Modifying the UI

Your chat interface is built with React. You can:

- Change theme colors in `src/client/styles`.
- Add or customize UI components in `src/client/components`.
- Modify the conversation sidebar or chat area by editing `src/client/app.tsx`.

The current layout offers a full-screen 16:9 view with a left sidebar (20% width) for conversation navigation and a right chat area (80% width) where your conversation (including the text input) resides entirely.

### Example Use Cases

1. **Customer Support Agent**
   - Tools: Ticket creation, order status, product recommendations, FAQ search.
2. **Development Assistant**
   - Tools: Code linting, Git operations, documentation search, dependency checks.
3. **Data Analysis Assistant**
   - Tools: Database querying, data visualization, statistical analysis, report generation.
4. **Personal Productivity Assistant**
   - Tools: Task scheduling, reminders, email drafting, note taking.
5. **Scheduling Assistant**
   - Tools: One-time event scheduling, delayed task execution, recurring tasks with cron patterns.

Each use case can be implemented by:

1. Adding relevant tools in `tools/basics.ts`.
2. Customizing the UI in `src/client/app.tsx` and related components.
3. Extending your agent’s logic in `src/agent/voice_agent.ts`.
4. Integrating additional external APIs as needed.

## Learn More

- [agents-sdk on GitHub](https://github.com/cloudflare/agents/blob/main/packages/agents/README.md)
- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## License

MIT
```

---

This updated README now covers the new voice features, full‑screen 16:9 layout with a sidebar for previous conversations, and all the customization details while keeping the original instructions intact.