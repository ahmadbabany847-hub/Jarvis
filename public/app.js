const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const dictationBtn = document.getElementById("dictation");
const liveBtn = document.getElementById("liveVoice");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];
let preferredLanguage = localStorage.getItem("jarvis-language") || "auto";

let dictationRecorder = null;
let dictationStream = null;
let dictationChunks = [];
let dictating = false;

let liveActive = false;
let liveStream = null;
let liveRecorder = null;
let liveChunks = [];
let audioContext = null;
let analyser = null;
let analyserSource = null;
let analyserTimer = null;
let speechStartedAt = 0;
let lastVoiceAt = 0;
let aboveThresholdSince = 0;
let liveBusy = false;

const VOICE_THRESHOLD = 0.018;
const START_HOLD_MS = 140;
const END_SILENCE_MS = 900;
const MIN_TURN_MS = 450;

function add(text, who) {
  if (welcome) welcome.remove();

  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

async function askJarvis(text, { speak = false } = {}) {
  text = String(text || "").trim();
  if (!text) return "";

  add(text, "user");
  history.push({ role: "user", content: text });
  input.value = "";
  statusEl.textContent = "JARVIS بیر دەکاتەوە...";

  const ai = add("...", "ai");

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history, language: preferredLanguage })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "AI request failed");

    const answer = String(data.response || "وەڵامێک نەگەیشت.").trim();
    ai.textContent = answer;
    history.push({ role: "assistant", content: answer });

    if (speak) {
      statusEl.textContent = "JARVIS قسە دەکات...";
      await speakText(answer);
    }

    statusEl.textContent = liveActive
      ? "Free Live Voice چالاکە — قسە بکە"
      : "JARVIS ئامادەیە";

    return answer;
  } catch (error) {
    ai.textContent = "کێشەی پەیوەندی بە AI هەیە.";
    statusEl.textContent = "Connection error";
    return "";
  }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  askJarvis(input.value);
});

document.querySelectorAll(".quick button").forEach(btn => {
  btn.addEventListener("click", () => askJarvis(btn.dataset.prompt || ""));
});

function bestMimeType() {
  const preferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];

  return preferred.find(type =>
    window.MediaRecorder?.isTypeSupported?.(type)
  ) || "";
}

async function transcribeBlob(blob, type) {
  const r = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "content-type": type || blob.type || "application/octet-stream",
      "x-jarvis-language": preferredLanguage
    },
    body: blob
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Transcription failed");

  return String(data.text || "").trim();
}

async function startDictation() {
  if (liveActive) {
    statusEl.textContent = "سەرەتا Free Live Voice بوەستێنە";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    statusEl.textContent = "Voice typing لەم browser ـەدا پشتگیری ناکرێت";
    return;
  }

  try {
    dictationStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    dictationChunks = [];
    const mimeType = bestMimeType();

    dictationRecorder = new MediaRecorder(
      dictationStream,
      mimeType ? { mimeType } : undefined
    );

    dictationRecorder.ondataavailable = event => {
      if (event.data?.size) dictationChunks.push(event.data);
    };

    dictationRecorder.onstop = async () => {
      dictating = false;
      dictationBtn.classList.remove("active");
      dictationBtn.textContent = "🎙️";

      const type =
        dictationRecorder.mimeType ||
        dictationChunks[0]?.type ||
        "audio/webm";

      const blob = new Blob(dictationChunks, { type });

      dictationStream?.getTracks().forEach(track => track.stop());
      dictationStream = null;

      if (!blob.size) {
        statusEl.textContent = "هیچ دەنگێک تۆمار نەکرا";
        return;
      }

      statusEl.textContent = "دەنگەکەت دەگۆڕم بۆ نووسین...";

      try {
        const text = await transcribeBlob(blob, type);

        if (!text) {
          statusEl.textContent = "دەنگەکەت ڕوون نەبوو";
          return;
        }

        input.value = input.value
          ? `${input.value.trim()} ${text}`
          : text;

        input.focus();
        statusEl.textContent = "دەنگەکەت نووسرایەوە — Send دابگرە";
      } catch {
        statusEl.textContent = "نەتوانرا دەنگەکەت بنووسرێتەوە";
      }
    };

    dictationRecorder.start();
    dictating = true;
    dictationBtn.classList.add("active");
    dictationBtn.textContent = "⏹";
    statusEl.textContent = "قسە بکە... دووبارە mic دابگرە بۆ وەستاندن";
  } catch (error) {
    statusEl.textContent =
      error?.name === "NotAllowedError"
        ? "ڕێگە بە Microphone بدە"
        : "Microphone نەکرایەوە";
  }
}

function stopDictation() {
  if (
    dictationRecorder &&
    dictating &&
    dictationRecorder.state !== "inactive"
  ) {
    statusEl.textContent = "دەنگەکەت دەنێرم...";
    dictationRecorder.stop();
  }
}

function setLiveUI(active) {
  liveActive = active;
  liveBtn.classList.toggle("active", active);
  liveBtn.textContent = active ? "⏹" : "◉";
  liveBtn.setAttribute(
    "aria-label",
    active ? "Stop free live voice" : "Start free live voice"
  );
}

async function startFreeLiveVoice() {
  if (dictating) {
    statusEl.textContent = "سەرەتا Voice typing بوەستێنە";
    return;
  }

  if (
    !navigator.mediaDevices?.getUserMedia ||
    !window.MediaRecorder ||
    !window.AudioContext
  ) {
    statusEl.textContent = "Free Live Voice لەم browser ـەدا پشتگیری ناکرێت";
    return;
  }

  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioContext = new AudioContext();
    await audioContext.resume();

    analyserSource = audioContext.createMediaStreamSource(liveStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    analyserSource.connect(analyser);

    setLiveUI(true);
    liveBusy = false;
    statusEl.textContent = "Free Live Voice چالاکە — قسە بکە";

    monitorVoice();
  } catch (error) {
    stopFreeLiveVoice();

    statusEl.textContent =
      error?.name === "NotAllowedError"
        ? "ڕێگە بە Microphone بدە"
        : "Microphone نەکرایەوە";
  }
}

function monitorVoice() {
  clearInterval(analyserTimer);

  const data = new Float32Array(analyser.fftSize);

  analyserTimer = setInterval(() => {
    if (!liveActive || !analyser || liveBusy) return;

    analyser.getFloatTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }

    const rms = Math.sqrt(sum / data.length);
    const now = performance.now();
    const isVoice = rms > VOICE_THRESHOLD;

    if (isVoice) {
      lastVoiceAt = now;

      if (!aboveThresholdSince) {
        aboveThresholdSince = now;
      }

      if (
        !liveRecorder &&
        now - aboveThresholdSince >= START_HOLD_MS
      ) {
        beginLiveTurn();
      }
    } else {
      aboveThresholdSince = 0;

      if (
        liveRecorder &&
        liveRecorder.state === "recording" &&
        now - lastVoiceAt >= END_SILENCE_MS &&
        now - speechStartedAt >= MIN_TURN_MS
      ) {
        endLiveTurn();
      }
    }
  }, 80);
}

function beginLiveTurn() {
  if (!liveActive || liveBusy || !liveStream || liveRecorder) return;

  liveChunks = [];
  const mimeType = bestMimeType();

  liveRecorder = new MediaRecorder(
    liveStream,
    mimeType ? { mimeType } : undefined
  );

  liveRecorder.ondataavailable = event => {
    if (event.data?.size) liveChunks.push(event.data);
  };

  liveRecorder.onstop = async () => {
    const recorder = liveRecorder;
    liveRecorder = null;

    const type =
      recorder?.mimeType ||
      liveChunks[0]?.type ||
      "audio/webm";

    const blob = new Blob(liveChunks, { type });
    liveChunks = [];

    if (!liveActive || blob.size < 800) {
      liveBusy = false;
      return;
    }

    liveBusy = true;
    statusEl.textContent = "گوێم لێبوو...";

    try {
      const text = await transcribeBlob(blob, type);

      if (!text) {
        statusEl.textContent = "قسە بکە، گوێم لێتە...";
        liveBusy = false;
        return;
      }

      statusEl.textContent = "JARVIS بیر دەکاتەوە...";
      await askJarvis(text, { speak: true });
    } catch (error) {
      statusEl.textContent = "کێشە لە Voice ـەکە هەیە";
    } finally {
      if (liveActive) {
        liveBusy = false;
        speechStartedAt = 0;
        lastVoiceAt = 0;
        aboveThresholdSince = 0;
        statusEl.textContent = "Free Live Voice چالاکە — قسە بکە";
      }
    }
  };

  speechStartedAt = performance.now();
  lastVoiceAt = speechStartedAt;
  liveRecorder.start(200);
  statusEl.textContent = "گوێم لێتە...";
}

function endLiveTurn() {
  if (liveRecorder?.state === "recording") {
    statusEl.textContent = "دەنگەکەت دەنێرم...";
    liveRecorder.stop();
  }
}

function stopFreeLiveVoice() {
  clearInterval(analyserTimer);
  analyserTimer = null;

  if (liveRecorder?.state === "recording") {
    try { liveRecorder.stop(); } catch {}
  }
  liveRecorder = null;

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  liveStream?.getTracks().forEach(track => track.stop());
  liveStream = null;

  try { analyserSource?.disconnect(); } catch {}
  try { analyser?.disconnect(); } catch {}

  analyserSource = null;
  analyser = null;

  if (audioContext) {
    try { audioContext.close(); } catch {}
  }
  audioContext = null;

  liveBusy = false;
  setLiveUI(false);
  statusEl.textContent = "JARVIS ئامادەیە";
}

async function speakText(text) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const language =
    preferredLanguage === "tr"
      ? "tr-TR"
      : preferredLanguage === "ku"
        ? "ku"
        : detectSpeechLanguage(text);

  const voices = await getSpeechVoices();
  const voice = chooseVoice(voices, language);

  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(cleanSpeechText(text));
    utterance.lang = language;

    if (preferredLanguage === "tr") {
      utterance.rate = 0.92;
      utterance.pitch = 0.88;
    } else {
      utterance.rate = 0.98;
      utterance.pitch = 0.92;
    }

    if (voice) utterance.voice = voice;

    utterance.onend = resolve;
    utterance.onerror = resolve;

    window.speechSynthesis.speak(utterance);
  });
}

function getSpeechVoices() {
  const current = window.speechSynthesis.getVoices();
  if (current.length) return Promise.resolve(current);

  return new Promise(resolve => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 1200);
  });
}

function chooseVoice(voices, language) {
  if (!Array.isArray(voices) || !voices.length) return null;

  const wanted = language.toLowerCase();
  const base = wanted.split("-")[0];

  const exact = voices.filter(v => (v.lang || "").toLowerCase() === wanted);
  const baseMatches = voices.filter(v =>
    (v.lang || "").toLowerCase().startsWith(base)
  );

  const candidates = exact.length ? exact : baseMatches;
  if (!candidates.length) return null;

  if (base === "tr") {
    return (
      candidates.find(v => v.localService) ||
      candidates.find(v => v.default) ||
      candidates[0]
    );
  }

  return candidates.find(v => v.default) || candidates[0];
}

function cleanSpeechText(text) {
  return String(text || "")
    .replace(/[*_#`~>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSpeechLanguage(text) {
  const t = String(text || "");

  if (/[çğıöşüÇĞİÖŞÜ]/.test(t)) return "tr-TR";
  if (/[؀-ۿ]/.test(t)) {
    const soraniHints = /[ێۆڵڕڤژگچپ]/;
    return soraniHints.test(t) ? "ku" : "ar-IQ";
  }

  return "en-US";
}

dictationBtn.addEventListener("click", () => {
  if (dictating) stopDictation();
  else startDictation();
});

liveBtn.addEventListener("click", () => {
  if (liveActive) stopFreeLiveVoice();
  else startFreeLiveVoice();
});

window.addEventListener("pagehide", () => {
  stopFreeLiveVoice();
  dictationStream?.getTracks().forEach(track => track.stop());
});


function updateLanguageUI() {
  document.querySelectorAll("[data-language]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.language === preferredLanguage);
  });

  if (preferredLanguage === "tr") {
    statusEl.textContent = "Türkçe ses modu hazır — konuş";
  } else if (preferredLanguage === "ku") {
    statusEl.textContent = "دەنگی کوردی ئامادەیە — قسە بکە";
  }
}

document.querySelectorAll("[data-language]").forEach(btn => {
  btn.addEventListener("click", () => {
    preferredLanguage = btn.dataset.language || "auto";
    localStorage.setItem("jarvis-language", preferredLanguage);
    updateLanguageUI();
  });
});

updateLanguageUI();
