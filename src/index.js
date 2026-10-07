const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const REALTIME_MODEL = "gpt-realtime-2.1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      try {
        const audioBuffer = await request.arrayBuffer();
        if (!audioBuffer || audioBuffer.byteLength === 0) {
          return Response.json({ error: "No audio received" }, { status: 400 });
        }

        const result = await env.AI.run(STT_MODEL, {
          audio: arrayBufferToBase64(audioBuffer),
          task: "transcribe",
          vad_filter: true,
          initial_prompt:
            "The speaker may speak Sorani Kurdish, Arabic, Turkish, or English."
        });

        const text =
          result?.text ??
          result?.response ??
          result?.result?.text ??
          "";

        return Response.json({ text: String(text || "").trim() });
      } catch (error) {
        return Response.json(
          { error: error?.message || "Transcription failed" },
          { status: 500 }
        );
      }
    }

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
          instructions:
            "You are JARVIS, a natural realtime voice assistant. Speak mainly in Sorani Kurdish unless the user asks for another language. Keep replies concise, friendly, and conversational. Let the user interrupt you naturally.",
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
          let message = details;
          try {
            const parsed = JSON.parse(details);
            message = parsed?.error?.message || parsed?.message || details;
          } catch {}

          return Response.json(
            {
              code:
                openaiResponse.status === 401 ? "invalid_key" :
                openaiResponse.status === 429 ? "quota_or_rate_limit" :
                "openai_realtime_error",
              status: openaiResponse.status,
              error: message || "Realtime session failed"
            },
            { status: openaiResponse.status }
          );
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
