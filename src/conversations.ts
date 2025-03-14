export class ConversationDO {
    state: DurableObjectState;
    
    constructor(state: DurableObjectState) {
      this.state = state;
    }
  
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      // Here we assume that the conversation data is stored under the key "conversation"
      let conversation = await this.state.storage.get("conversation") || { messages: [] };
  
      if (request.method === "GET") {
        return new Response(JSON.stringify(conversation), {
          headers: { "Content-Type": "application/json" }
        });
      } else if (request.method === "PUT" || request.method === "POST") {
        const newData = await request.json();
        // You can add additional validation and merging logic here
        // conversation = newData;
        await this.state.storage.put("conversation", conversation);
        return new Response("OK", { status: 200 });
      }
  
      return new Response("Method not allowed", { status: 405 });
    }
  }