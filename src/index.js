const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";

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
                "You are JARVIS, a natural conversational voice assistant. Reply in the same language the user is using unless they explicitly ask for another language. Keep replies short, warm, and easy to speak aloud. Do not use markdown unless needed."
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

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);

    if (
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/app.js"
    ) {
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
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
