const MODEL = "@cf/google/gemma-4-26b-a4b-it";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages) ? body.messages.slice(-20) : [];

        const result = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: "You are JARVIS, a helpful AI assistant. Reply mainly in Sorani Kurdish unless the user requests another language. Be concise and practical. Help with coding, projects, databases, and general questions. Never claim to have executed code or changed a real system unless you actually did."
            },
            ...incoming
          ],
          chat_template_kwargs: {
            enable_thinking: false
          }
        });

        const response =
          result?.response ??
          result?.result?.response ??
          result?.choices?.[0]?.message?.content ??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({ response });
      } catch (error) {
        return Response.json(
          { error: error?.message || "AI request failed" },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
