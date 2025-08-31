# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `npm start` - Runs the Vite dev server for local development
- **Deploy**: `npm run deploy` - Builds with Vite and deploys using Wrangler
- **Run tests**: `npm test` - Executes tests using Vitest with Workers pool
- **Lint and format check**: `npm run check` - Runs Prettier check, Biome lint, and TypeScript check
- **Format code**: `npm run format` - Formats code using Prettier

## Architecture

This is a Cloudflare Workers-based voice chat agent application built with:

- **Framework**: Cloudflare Workers with `agents-sdk` for AI agent functionality
- **AI Integration**: OpenAI GPT-4 via `@ai-sdk/openai` with streaming responses
- **Voice Services**:
  - Speech-to-Text: Deepgram SDK (`@deepgram/sdk`)
  - Text-to-Speech: ElevenLabs and LMNT (`lmnt-node`)
- **Frontend**: React 19 with Vite, TailwindCSS, and Radix UI components
- **State Management**: Durable Objects for agent state and conversation persistence

### Key Components

- **VoiceAgent** (`src/agent/voice-agent.ts`): Main agent class extending `AIChatAgent`
- **Chat Agent** (`src/agent/agent.ts`): Core chat functionality with tool integration
- **ConversationDO** (`src/conversations.ts`): Durable Object for conversation persistence
- **Tools System** (`src/tools/`): Human-in-the-loop tool confirmations and executions
- **Services**: Modular STT, TTS, audio sources/sinks in `src/services/`

### Configuration

- **Wrangler config**: `wrangler.jsonc` - Defines Durable Object bindings for `Chat` (VoiceAgent) and `CONVERSATION` (ConversationDO)
- **Required environment variables** (set in `.dev.vars`):
  - `OPENAI_API_KEY`
  - `DEEPGRAM_API_KEY`
  - `ELEVENLABS_API_KEY`
  - `LMNT_API_KEY`

### Agent Routing

The application uses `routeAgentRequest()` from `agents-sdk` to automatically route requests to `/agents/...` paths to the appropriate agent instances.

### Development Notes

- The project uses SQLite classes for agent state persistence (see `migrations` in wrangler.jsonc)
- Biome is configured for linting with Prettier disabled for formatting
- TypeScript with React 19 and strict type checking
- Vite build system with Cloudflare plugin integration
