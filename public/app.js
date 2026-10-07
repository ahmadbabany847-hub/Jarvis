const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const mic = document.getElementById("mic");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];

function add(text, who) {
  if (welcome) welcome.remove();
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;
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
    const answer = data.response || data.error || "وەڵامێک نەگەیشت.";
    ai.textContent = answer;
    history.push({ role: "assistant", content: answer });
    statusEl.textContent = "JARVIS ئامادەیە";
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

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.lang = "ku-IQ";
  rec.interimResults = false;
  rec.onstart = () => statusEl.textContent = "گوێم لێتە...";
  rec.onresult = e => sendMessage(e.results[0][0].transcript);
  rec.onerror = () => statusEl.textContent = "نەتوانرا دەنگ بخوێندرێتەوە";
  rec.onend = () => { if (!statusEl.textContent.includes("error")) statusEl.textContent = "JARVIS ئامادەیە"; };
  mic.addEventListener("click", () => rec.start());
} else {
  mic.addEventListener("click", () => statusEl.textContent = "Voice input لەم browser ـەدا پشتگیری ناکرێت");
}
