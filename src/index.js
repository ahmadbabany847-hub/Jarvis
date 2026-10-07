const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const REALTIME_MODEL = "gpt-realtime-2.1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/realtime" && request.method === "POST") {
      if (!env.OPENAI_API_KEY) {
        return Response.json(
          { error: "OPENAI_API_KEY secret is not configured in Cloudflare." },
          { status: 500 }
        );
      }

      try {
        const sdp = await request.text();

        const session = {
          type: "realtime",
          model: REALTIME_MODEL,
          output_modalities: ["audio"],
          instructions:
            "You are JARVIS, a natural realtime voice assistant. Speak mainly in Sorani Kurdish unless the user asks for another language. Keep replies concise, friendly, and conversational. Let the user interrupt you naturally. Help with coding, projects, databases, planning, and general questions.",
          audio: {
            input: {
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: true,
                interrupt_response: true
              }
            },
            output: {
              voice: "marin"
            }
          }
        };

        const form = new FormData();
        form.set("sdp", sdp);
        form.set("session", JSON.stringify(session));

        const openaiResponse = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENAI_API_KEY}`,
              "OpenAI-Safety-Identifier": "jarvis-web-user"
            },
            body: form
          }
        );

        if (!openaiResponse.ok) {
          const details = await openaiResponse.text();
          return new Response(details || "Realtime session failed", {
            status: openaiResponse.status,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }

        return new Response(await openaiResponse.text(), {
          status: 200,
          headers: { "content-type": "application/sdp" }
        });
      } catch (error) {
        return Response.json(
          { error: error?.message || "Realtime connection failed" },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages)
          ? body.messages.slice(-20)
          : [];

        const result = await env.AI.run(TEXT_MODEL, {
          messages: [
            {
              role: "system",
              content:
                "You are JARVIS, a helpful AI assistant. Reply mainly in Sorani Kurdish unless the user requests another language. Be concise and practical."
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
