const MODEL = "@cf/google/gemma-4-26b-a4b-it";
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

        const audioBase64 = arrayBufferToBase64(audioBuffer);

        const result = await env.AI.run(STT_MODEL, {
          audio: audioBase64,
          task: "transcribe",
          vad_filter: true,
          initial_prompt: "The speaker may speak Sorani Kurdish, Arabic, Turkish, or English."
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}
