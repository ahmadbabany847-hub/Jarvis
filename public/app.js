const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const mic = document.getElementById("mic");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];

let recognition = null;
let isListening = false;
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

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "ku-IQ";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    mic.textContent = "⏹";
    statusEl.textContent = "گوێم لێتە...";
  };

  recognition.onresult = e => {
    const spokenText = e.results?.[0]?.[0]?.transcript || "";
    if (spokenText) sendMessage(spokenText);
  };

  recognition.onerror = event => {
    isListening = false;
    mic.textContent = "🎙️";
    statusEl.textContent =
      event.error === "not-allowed"
        ? "ڕێگە بە Microphone بدە"
        : "نەتوانرا دەنگ بخوێندرێتەوە";
  };

  recognition.onend = () => {
    isListening = false;
    mic.textContent = "🎙️";
    if (statusEl.textContent === "گوێم لێتە...") {
      statusEl.textContent = "JARVIS ئامادەیە";
    }
  };

  mic.addEventListener("click", () => {
    if ("speechSynthesis" in window) speechSynthesis.cancel();

    try {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    } catch (e) {
      statusEl.textContent = "دووبارە هەوڵ بدە";
    }
  });
} else {
  mic.addEventListener("click", () => {
    statusEl.textContent = "Voice input لەم browser ـەدا پشتگیری ناکرێت";
  });
}
