const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const mic = document.getElementById("mic");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let isRecording = false;
let voiceReplies = true;

function add(text, who) {
  if (welcome) welcome.remove();
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function pickVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return (
    voices.find(v => /^ku\b/i.test(v.lang)) ||
    voices.find(v => /^ar-IQ$/i.test(v.lang)) ||
    voices.find(v => /^ar\b/i.test(v.lang)) ||
    voices.find(v => /^en-GB$/i.test(v.lang)) ||
    voices.find(v => /^en\b/i.test(v.lang)) ||
    voices[0] ||
    null
  );
}

function speak(text) {
  if (!voiceReplies || !("speechSynthesis" in window) || !text) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "ar-IQ";
  }

  utterance.rate = 0.94;
  utterance.pitch = 0.95;
  utterance.volume = 1;

  utterance.onstart = () => {
    statusEl.textContent = "JARVIS قسە دەکات...";
  };

  utterance.onend = () => {
    statusEl.textContent = "JARVIS ئامادەیە";
  };

  utterance.onerror = () => {
    statusEl.textContent = "JARVIS ئامادەیە";
  };

  speechSynthesis.speak(utterance);
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  if ("speechSynthesis" in window) speechSynthesis.cancel();

  add(text, "user");
  history.push({ role: "user", content: text });
  input.value = "";
  statusEl.textContent = "JARVIS بیر دەکاتەوە...";

  const ai = add("...", "ai");

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history })
    });

    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.error || "AI request failed");
    }

    const answer = data.response || data.error || "وەڵامێک نەگەیشت.";
    ai.textContent = answer;
    history.push({ role: "assistant", content: answer });

    statusEl.textContent = "JARVIS وەڵامی دا";
    speak(answer);
  } catch (e) {
    ai.textContent = "کێشەی پەیوەندی بە AI هەیە.";
    statusEl.textContent = "Connection error";
  }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  sendMessage(input.value);
});

document.querySelectorAll(".quick button").forEach(btn => {
  btn.addEventListener("click", () => sendMessage(btn.dataset.prompt || ""));
});

if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    statusEl.textContent = "ئەم browser ـە voice recording پشتگیری ناکات";
    return;
  }

  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let options = {};
    const preferredTypes = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus"
    ];

    const supportedType = preferredTypes.find(type =>
      MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : false
    );

    if (supportedType) {
      options.mimeType = supportedType;
    }

    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, options);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      mic.textContent = "🎙️";
      isRecording = false;

      const mimeType =
        mediaRecorder.mimeType ||
        audioChunks[0]?.type ||
        "audio/mp4";

      const blob = new Blob(audioChunks, { type: mimeType });

      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }

      if (!blob.size) {
        statusEl.textContent = "هیچ دەنگێک تۆمار نەکرا";
        return;
      }

      statusEl.textContent = "دەنگەکەت دەخوێنمەوە...";

      try {
        const r = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "content-type": mimeType
          },
          body: blob
        });

        const data = await r.json();

        if (!r.ok) {
          throw new Error(data.error || "Transcription failed");
        }

        const text = (data.text || "").trim();

        if (!text) {
          statusEl.textContent = "دەنگەکەت ڕوون نەبوو، دووبارە هەوڵ بدە";
          return;
        }

        statusEl.textContent = "دەنگەکەت خوێندرایەوە";
        sendMessage(text);
      } catch (error) {
        statusEl.textContent = "نەتوانرا دەنگ بخوێندرێتەوە";
      }
    };

    mediaRecorder.onerror = () => {
      isRecording = false;
      mic.textContent = "🎙️";
      statusEl.textContent = "کێشە لە تۆمارکردنی دەنگ هەیە";
    };

    mediaRecorder.start();
    isRecording = true;
    mic.textContent = "⏹";
    statusEl.textContent = "گوێم لێتە... دووبارە mic دابگرە بۆ ناردن";
  } catch (error) {
    statusEl.textContent =
      error?.name === "NotAllowedError"
        ? "ڕێگە بە Microphone بدە لە Safari Settings"
        : "Microphone نەکرایەوە";
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording && mediaRecorder.state !== "inactive") {
    statusEl.textContent = "دەنگەکەت دەنێرم...";
    mediaRecorder.stop();
  }
}

mic.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});
