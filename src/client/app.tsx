import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { Message } from "@ai-sdk/react";
import type { tools } from "../tools/basics";
import { APPROVAL } from "../shared/approval";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Switch } from "./components/ui/switch";
import { Send, Bot, Trash2, Sun, Moon, Bug, Mic, MicOff } from "lucide-react";

// Import your AudioSink & AudioSource
import { LocalSpeakerSink } from "@/services/sinks/local_speaker";
import { LocalMicrophoneSource } from "@/services/sources/local_mic";
import { generateId } from "ai";

// Tools that require human confirmation
const toolsRequiringConfirmation: (keyof typeof tools)[] = [
  "getWeatherInformation",
];

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

export default function Chat() {
  // Theme & debug state
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "dark";
  });
  const [showDebug, setShowDebug] = useState(false);

  // Mic state
  const [micActive, setMicActive] = useState(false);

  // Refs for local microphone & speaker
  const micRef = useRef<LocalMicrophoneSource | null>(null);
  const sinkRef = useRef<LocalSpeakerSink | null>(null);

  // Conversation sidebar state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string>("");

  // For auto-scrolling the chat area
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // --- Conversation Sidebar Logic ---
  useEffect(() => {
    if (!currentConvId) {
      // Fetch the first conversation or create a new one
      const existingConv = conversations[0];
      if (existingConv) {
        console.log("Switching to existing conversation:", existingConv);
        setCurrentConvId(existingConv.id);
      } else {
        const newId = generateId();
        console.log("Creating new conversation with ID:", newId);
        setCurrentConvId(newId);
        setConversations((prev) => [
          {
            id: newId,
            title: `Chat ${new Date().toLocaleTimeString()}`,
            messages: [],
          },
          ...prev,
        ]);
      }
    }
  }, [currentConvId]);

  const handleNewChat = () => {
    const newId = generateId();
    console.log("handleNewChat: Creating new conversation with ID:", newId);
    setCurrentConvId(newId);
    setConversations((prev) => [
      {
        id: newId,
        title: `Chat ${new Date().toLocaleTimeString()}`,
        messages: [],
      },
      ...prev,
    ]);
  };

  const handleSwitchChat = (convId: string) => {
    if (convId === currentConvId) return;
    console.log("handleSwitchChat: Switching to conversation with ID:", convId);
    setCurrentConvId(convId);
    // In a complete implementation, load the conversation's messages here
  };

  // Memoize the onMessage callback to prevent agent recreation
  const onMessage = useCallback(async (event) => {
    if (typeof event.data === "string") {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "audio-chunk") {
          const binaryString = atob(parsed.data);
          const byteArray = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            byteArray[i] = binaryString.charCodeAt(i);
          }
          const audioBuffer = byteArray.buffer;
          sinkRef.current?.write(audioBuffer);
        }
      } catch {
        console.error("Failed to parse JSON:", event.data);
      }
    }
  }, []);

  // Initialize the agent with onMessage handler for binary audio
  // Use voicechat agent when mic is active, otherwise use regular chat
  const agent = useAgent({
    agent: micActive ? "voicechat" : "chat",
    name: currentConvId,
    onMessage,
  });

  const {
    messages: agentMessages,
    input: agentInput,
    handleInputChange: handleAgentInputChange,
    handleSubmit: handleAgentSubmit,
    addToolResult,
    clearHistory: deleteHistory,
  } = useAgentChat({
    agent,
    maxSteps: 5,
  });

  console.log(
    "Agent messages:",
    agentMessages,
    "agent id:",
    agent.id,
    "agent name:",
    agent.name,
    "micActive:",
    micActive,
    "agent type:",
    micActive ? "voicechat" : "chat"
  );

  // Initialize mic & speaker on mount
  useEffect(() => {
    if (!micRef.current) {
      micRef.current = new LocalMicrophoneSource();
    }
    if (!sinkRef.current) {
      sinkRef.current = new LocalSpeakerSink();
    }
  }, []);

  // Direct WebSocket connection for voice agent
  const voiceWebSocketRef = useRef<WebSocket | null>(null);

  // Register audio callback when agent changes
  useEffect(() => {
    const mic = micRef.current;
    if (!mic) {
      console.log("Browser: No microphone available for callback registration");
      return;
    }

    console.log(
      "Browser: Registering audio callback for agent:",
      agent.id,
      "micActive:",
      micActive
    );

    const handleAudioData = (chunk: ArrayBuffer) => {
      console.log(
        "Browser: Sending audio chunk to agent",
        agent.id,
        "size:",
        chunk.byteLength
      );

      // If mic is active and we're using voicechat, try direct WebSocket
      if (
        micActive &&
        voiceWebSocketRef.current?.readyState === WebSocket.OPEN
      ) {
        console.log("Browser: Sending via direct WebSocket");
        voiceWebSocketRef.current.send(chunk);
      } else {
        console.log("Browser: Sending via agent.send()");
        agent.send(chunk);
      }
    };

    mic.onAudioData(handleAudioData);

    return () => {
      console.log("Browser: Unregistering audio callback for agent:", agent.id);
      mic.offAudioData(handleAudioData);
    };
  }, [agent, micActive]);

  // Create direct WebSocket connection when switching to voice mode
  useEffect(() => {
    if (micActive && currentConvId) {
      console.log(
        "Browser: Creating direct WebSocket connection for voice chat"
      );
      const wsUrl = `${window.location.origin.replace("http", "ws")}/agents/voicechat/${currentConvId}`;
      console.log("Browser: Connecting to:", wsUrl);

      voiceWebSocketRef.current = new WebSocket(wsUrl);

      voiceWebSocketRef.current.onopen = () => {
        console.log("Browser: Direct WebSocket connected");
      };

      voiceWebSocketRef.current.onmessage = async (event) => {
        console.log("Browser: Received message on direct WebSocket");
        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "audio-chunk") {
              console.log("Browser: Received audio chunk for playback");
              const binaryString = atob(parsed.data);
              const byteArray = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                byteArray[i] = binaryString.charCodeAt(i);
              }
              const audioBuffer = byteArray.buffer;
              sinkRef.current?.write(audioBuffer);
            }
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
        }
      };

      voiceWebSocketRef.current.onerror = (error) => {
        console.log("Browser: Direct WebSocket error:", error);
      };

      voiceWebSocketRef.current.onclose = () => {
        console.log("Browser: Direct WebSocket closed");
      };
    } else if (voiceWebSocketRef.current) {
      console.log("Browser: Closing direct WebSocket connection");
      voiceWebSocketRef.current.close();
      voiceWebSocketRef.current = null;
    }

    return () => {
      if (voiceWebSocketRef.current) {
        voiceWebSocketRef.current.close();
        voiceWebSocketRef.current = null;
      }
    };
  }, [micActive, currentConvId]);

  // Start/stop microphone based on micActive state
  useEffect(() => {
    const mic = micRef.current;
    if (!mic) return;
    if (micActive) {
      console.log("Browser: Starting microphone...");
      void mic.start();
    } else {
      console.log("Browser: Stopping microphone...");
      void mic.stop();
    }
    return () => {
      void mic.stop();
    };
  }, [micActive]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (agentMessages.length > 0) {
      scrollToBottom();
    }
  }, [agentMessages, scrollToBottom]);

  const pendingToolCallConfirmation = agentMessages.some((m: Message) =>
    m.parts?.some(
      (part) =>
        part.type === "tool-invocation" &&
        part.toolInvocation.state === "call" &&
        toolsRequiringConfirmation.includes(
          part.toolInvocation.toolName as keyof typeof tools
        )
    )
  );

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-[#F48120]/10 via-background/30 to-[#FAAD3F]/10 backdrop-blur-md p-4 flex overflow-hidden">
      {/* Sidebar (20%) */}
      <div className="w-1/5 bg-background border-r border-assistant-border p-4 flex flex-col">
        <div className="mb-4">
          <Button onClick={handleNewChat} className="w-full mb-2">
            New Chat
          </Button>
          <h3 className="text-lg font-semibold">Conversations</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => handleSwitchChat(conv.id)}
              className={`p-2 rounded cursor-pointer ${
                conv.id === currentConvId
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {conv.title}
            </div>
          ))}
        </div>
      </div>

      {/* Chat area (80%) */}
      <div className="w-4/5 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-background sticky top-0 z-10">
          <div className="flex items-center justify-center h-8 w-8">
            <svg
              width="28px"
              height="28px"
              className="text-[#F48120]"
              data-icon="agents"
            >
              <title>Cloudflare Agents</title>
              <symbol id="ai:local:agents" viewBox="0 0 80 79">
                <path
                  fill="currentColor"
                  d="M69.3 39.7c-3.1 0-5.8 2.1-6.7 5H48.3V34h4.6l4.5-2.5c1.1.8 2.5 1.2 3.9 1.2 3.8 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7c0 .9.2 1.8.5 2.6L51.9 30h-3.5V18.8h-.1c-1.3-1-2.9-1.6-4.5-1.9h-.2c-1.9-.3-3.9-.1-5.8.6-.4.1-.8.3-1.2.5h-.1c-.1.1-.2.1-.3.2-1.7 1-3 2.4-4 4 0 .1-.1.2-.1.2l-.3.6c0 .1-.1.1-.1.2v.1h-.6c-2.9 0-5.7 1.2-7.7 3.2-2.1 2-3.2 4.8-3.2 7.7 0 .7.1 1.4.2 2.1-1.3.9-2.4 2.1-3.2 3.5s-1.2 2.9-1.4 4.5c-.1 1.6.1 3.2.7 4.7s1.5 2.9 2.6 4c-.8 1.8-1.2 3.7-1.1 5.6 0 1.9.5 3.8 1.4 5.6s2.1 3.2 3.6 4.4c1.3 1 2.7 1.7 4.3 2.2v-.1q2.25.75 4.8.6h.1c0 .1.1.1.1.1.9 1.7 2.3 3 4 4 .1.1.2.1.3.2h.1c.4.2.8.4 1.2.5 1.4.6 3 .8 4.5.7.4 0 .8-.1 1.3-.1h.1c1.6-.3 3.1-.9 4.5-1.9V62.9h3.5l3.1 1.7c-.3.8-.5 1.7-.5 2.6 0 3.8 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.5 0-2.8.5-3.9 1.2l-4.6-2.5h-4.6V48.7h14.3c.9 2.9 3.5 5 6.7 5 3.8 0 7-3.1 7-7s-3.1-7-7-7m-7.9-16.9c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3m0 41.4c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3M44.3 72c-.4.2-.7.3-1.1.3-.2 0-.4.1-.5.1h-.2c-.9.1-1.7 0-2.6-.3-1-.3-1.9-.9-2.7-1.7-.7-.8-1.3-1.7-1.6-2.7l-.3-1.5v-.7q0-.75.3-1.5c.1-.2.1-.4.2-.7s.3-.6.5-.9c0-.1.1-.1.1-.2.1-.1.1-.2.2-.3s.1-.2.2-.3c0 0 0-.1.1-.1l.6-.6-2.7-3.5c-1.3 1.1-2.3 2.4-2.9 3.9-.2.4-.4.9-.5 1.3v.1c-.1.2-.1.4-.1.6-.3 1.1-.4 2.3-.3 3.4-.3 0-.7 0-1-.1-2.2-.4-4.2-1.5-5.5-3.2-1.4-1.7-2-3.9-1.8-6.1q.15-1.2.6-2.4l.3-.6c.1-.2.2-.4.3-.5 0 0 0-.1.1-.1.4-.7.9-1.3 1.5-1.9 1.6-1.5 3.8-2.3 6-2.3q1.05 0 2.1.3v-4.5c-.7-.1-1.4-.2-2.1-.2-1.8 0-3.5.4-5.2 1.1-.7.3-1.3.6-1.9 1s-1.1.8-1.7 1.3c-.3.2-.5.5-.8.8-.6-.8-1-1.6-1.3-2.6-.2-1-.2-2 0-2.9.2-1 .6-1.9 1.3-2.6.6-.8 1.4-1.4 2.3-1.8l1.8-.9-.7-1.9c-.4-1-.5-2.1-.4-3.1s.5-2.1 1.1-2.9q.9-1.35 2.4-2.1c.9-.5 2-.8 3-.7.5 0 1 .1 1.5.2 1 .2 1.8.7 2.6 1.3s1.4 1.4 1.8 2.3l4.1-1.5c-.9-2-2.3-3.7-4.2-4.9q-.6-.3-.9-.6c.4-.7 1-1.4 1.6-1.9.8-.7 1.8-1.1 2.9-1.3.9-.2 1.7-.1 2.6 0 .4.1.7.2 1.1.3V72zm25-22.3c-1.6 0-3-1.3-3-3 0-1.6 1.3-3 3-3s3 1.3 3 3c0 1.6-1.3 3-3 3"
                />
              </symbol>
              <use href="#ai:local:agents" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-base">AI Chat Agent</h2>
          </div>
          <div className="flex items-center gap-2 mr-2">
            <Bug className="h-4 w-4 text-muted-foreground/50 dark:text-gray-500" />
            <Switch
              checked={showDebug}
              onCheckedChange={setShowDebug}
              aria-label="Toggle debug mode"
              className="data-[state=checked]:bg-gray-500 data-[state=unchecked]:bg-gray-300 dark:data-[state=unchecked]:bg-gray-700"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-9 w-9"
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-9 w-9"
            onClick={deleteHistory}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>

        {/* Chat messages and input area within a flex-col container */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {agentMessages.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <Card className="bg-secondary/30 border-secondary/50 p-6 max-w-md mx-auto">
                  <div className="text-center space-y-4">
                    <div className="bg-[#F48120]/10 text-[#F48120] rounded-full p-3 inline-flex">
                      <Bot className="h-6 w-6" />
                    </div>
                    <h3 className="font-semibold text-lg">
                      Welcome to AI Chat
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      Start a conversation with your AI assistant. Try asking
                      about:
                    </p>
                    <ul className="text-sm text-left space-y-2">
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Weather information for any city</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Local time in different locations</span>
                      </li>
                    </ul>
                  </div>
                </Card>
              </div>
            )}
            {agentMessages.map((m: Message, index) => {
              const isUser = m.role === "user";
              const showAvatar =
                index === 0 || agentMessages[index - 1]?.role !== m.role;
              return (
                <div key={m.id}>
                  {showDebug && (
                    <pre className="text-xs text-muted-foreground overflow-scroll">
                      {JSON.stringify(m, null, 2)}
                    </pre>
                  )}
                  <div
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`flex gap-2 max-w-[85%] ${isUser ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {showAvatar && !isUser ? (
                        <Avatar className="h-8 w-8 mt-1 flex-shrink-0">
                          <AvatarFallback className="bg-[#F48120] text-white">
                            AI
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        !isUser && <div className="w-8" />
                      )}
                      <div>
                        {m.parts?.map((part, i) => {
                          if (part.type === "text") {
                            const isScheduled =
                              part.text.startsWith("scheduled message");
                            return (
                              <div key={i}>
                                <Card
                                  className={`p-3 rounded-md ${
                                    isUser
                                      ? "bg-primary text-primary-foreground rounded-br-none"
                                      : "rounded-bl-none border-assistant-border"
                                  } ${isScheduled ? "border-accent/50" : ""} relative`}
                                >
                                  {isScheduled && (
                                    <span className="absolute -top-3 -left-2 text-base">
                                      🕒
                                    </span>
                                  )}
                                  <p className="text-sm whitespace-pre-wrap">
                                    {part.text.replace(
                                      /^scheduled message: /,
                                      ""
                                    )}
                                  </p>
                                </Card>
                                <p
                                  className={`text-xs text-muted-foreground mt-1 ${isUser ? "text-right" : "text-left"}`}
                                >
                                  {formatTime(
                                    new Date(m.createdAt as unknown as string)
                                  )}
                                </p>
                              </div>
                            );
                          }
                          if (part.type === "tool-invocation") {
                            const toolInvocation = part.toolInvocation;
                            const toolCallId = toolInvocation.toolCallId;
                            if (
                              toolsRequiringConfirmation.includes(
                                toolInvocation.toolName as keyof typeof tools
                              ) &&
                              toolInvocation.state === "call"
                            ) {
                              return (
                                <Card
                                  key={i}
                                  className="p-4 my-3 bg-secondary/30 border-secondary/50 rounded-md"
                                >
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="bg-[#F48120]/10 p-1.5 rounded-full">
                                      <Bot className="h-4 w-4 text-[#F48120]" />
                                    </div>
                                    <h4 className="font-medium">
                                      {toolInvocation.toolName}
                                    </h4>
                                  </div>
                                  <div className="mb-3">
                                    <h5 className="text-xs font-medium mb-1 text-muted-foreground">
                                      Arguments:
                                    </h5>
                                    <pre className="bg-background/80 p-2 rounded-md text-xs overflow-auto">
                                      {JSON.stringify(
                                        toolInvocation.args,
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        addToolResult({
                                          toolCallId,
                                          result: APPROVAL.NO,
                                        })
                                      }
                                    >
                                      Reject
                                    </Button>
                                    <Button
                                      variant="default"
                                      size="sm"
                                      onClick={() =>
                                        addToolResult({
                                          toolCallId,
                                          result: APPROVAL.YES,
                                        })
                                      }
                                    >
                                      Approve
                                    </Button>
                                  </div>
                                </Card>
                              );
                            }
                            return null;
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {/* Chat Input Area */}
          <div className="p-3 bg-input-background border-t">
            <form
              onSubmit={(e) =>
                handleAgentSubmit(e, {
                  data: { annotations: { hello: "world" } },
                })
              }
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Input
                    disabled={pendingToolCallConfirmation}
                    placeholder={
                      pendingToolCallConfirmation
                        ? "Please respond to the tool confirmation above..."
                        : "Type your message..."
                    }
                    className="pr-10 py-6 rounded-full bg-muted border-muted"
                    value={agentInput}
                    onChange={handleAgentInputChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAgentSubmit(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                </div>
                {/* Microphone toggle */}
                <Button
                  type="button"
                  size="icon"
                  className="rounded-full h-10 w-10 flex-shrink-0"
                  onClick={() => setMicActive((prev) => !prev)}
                  disabled={pendingToolCallConfirmation}
                >
                  {micActive ? (
                    <MicOff className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </Button>
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full h-10 w-10 flex-shrink-0"
                  disabled={pendingToolCallConfirmation || !agentInput.trim()}
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
