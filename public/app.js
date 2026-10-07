const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const dictationBtn = document.getElementById("dictation");
const liveBtn = document.getElementById("liveVoice");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettings");
const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");
const voiceRateValue = document.getElementById("voiceRateValue");
const voicePitchValue = document.getElementById("voicePitchValue");
const testVoiceBtn = document.getElementById("testVoice");
const naturalVoiceBtn = document.getElementById("naturalVoice");
const accountName = document.getElementById("accountName");
const accountEmail = document.getElementById("accountEmail");
const saveAccountBtn = document.getElementById("saveAccount");
const logoutAccountBtn = document.getElementById("logoutAccount");
const accountStatus = document.getElementById("accountStatus");
const pcStatusEl = document.getElementById("pcStatus");
const testPcBtn = document.getElementById("testPc");
const history = [];

const PC_AGENT_URL = "http://127.0.0.1:8765";

let preferredLanguage = localStorage.getItem("jarvis-language") || "auto";
let preferredVoiceURI = localStorage.getItem("jarvis-voice-uri") || "";
let preferredRate = Number(localStorage.getItem("jarvis-voice-rate") || "0.96");
let preferredPitch = Number(localStorage.getItem("jarvis-voice-pitch") || "1.00");

if (
  localStorage.getItem("jarvis-voice-natural-v2") !== "1" &&
  preferredRate === 0.92 &&
  preferredPitch === 0.88
) {
  preferredRate = 0.96;
  preferredPitch = 1.00;
  localStorage.setItem("jarvis-voice-rate", String(preferredRate));
  localStorage.setItem("jarvis-voice-pitch", String(preferredPitch));
  localStorage.setItem("jarvis-voice-natural-v2", "1");
}

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

  const localCommand = parsePcCommand(text);
  if (localCommand) {
    add(text, "user");
    const ok = await runPcCommand(localCommand);

    if (ok) {
      const reply =
        preferredLanguage === "tr"
          ? "Tamam, bilgisayarında yaptım."
          : preferredLanguage === "auto"
            ? "Done on your computer."
            : "تەواو، لە کۆمپیوتەرەکەت ئەنجامم دا.";

      add(reply, "ai");
      if (speak) await speakText(reply);
      return reply;
    }

    const reply =
      preferredLanguage === "tr"
        ? "Bilgisayar ajanına bağlanamadım."
        : "نەتوانرا بە JARVIS Agent ـی کۆمپیوتەر پەیوەست بم.";

    add(reply, "ai");
    if (speak) await speakText(reply);
    return reply;
  }

  add(text, "user");
  history.push({ role: "user", content: text });
  input.value = "";
  statusEl.textContent = "JARVIS بیر دەکاتەوە...";

  const ai = add("...", "ai");

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: history,
        language: preferredLanguage,
        voiceMode: Boolean(speak)
      })
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
  const savedVoice = voices.find(v => v.voiceURI === preferredVoiceURI);
  const voice = savedVoice || chooseVoice(voices, language);

  const cleaned = cleanSpeechText(text);
  const chunks = splitForNaturalSpeech(cleaned);

  for (const chunk of chunks) {
    await speakChunk(chunk, language, voice);
  }
}

function speakChunk(text, language, voice) {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = preferredRate;
    utterance.pitch = preferredPitch;
    utterance.volume = 1;

    if (voice) utterance.voice = voice;

    utterance.onend = () => setTimeout(resolve, preferredLanguage === "tr" ? 85 : 55);
    utterance.onerror = resolve;

    window.speechSynthesis.speak(utterance);
  });
}

function splitForNaturalSpeech(text) {
  const chunks = String(text || "")
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  return chunks.length ? chunks : [String(text || "").trim()];
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
    const qualityPattern = /(premium|enhanced|natural|siri|yelda|cem|turkish|türk|apple)/i;
    const roboticPattern = /(compact|espeak|festival)/i;

    const ranked = [...candidates].sort((a, b) => {
      const score = v => {
        const name = String(v.name || "");
        let s = 0;
        if (qualityPattern.test(name)) s += 6;
        if ((v.lang || "").toLowerCase() === "tr-tr") s += 4;
        if (v.localService) s += 3;
        if (v.default) s += 1;
        if (roboticPattern.test(name)) s -= 8;
        return s;
      };
      return score(b) - score(a);
    });

    return ranked[0] || candidates[0];
  }

  return candidates.find(v => v.default) || candidates[0];
}

function cleanSpeechText(text) {
  let out = String(text || "")
    .replace(/[*_#`~>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (preferredLanguage === "tr") {
    out = out
      .replace(/\s*[:;]\s*/g, ", ")
      .replace(/\s*[–—]\s*/g, ", ")
      .replace(/\s*\/\s*/g, " veya ")
      .replace(/\s*&\s*/g, " ve ")
      .replace(/\.{3,}/g, "…");
  }

  return out;
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


function populateVoiceSelect() {
  if (!voiceSelect || !("speechSynthesis" in window)) return;

  const voices = window.speechSynthesis.getVoices();
  const current = preferredVoiceURI;
  voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "هیچ دەنگێک نەدۆزرایەوە";
    voiceSelect.appendChild(option);
    return;
  }

  const sorted = [...voices].sort((a, b) => {
    const aTr = (a.lang || "").toLowerCase().startsWith("tr") ? 0 : 1;
    const bTr = (b.lang || "").toLowerCase().startsWith("tr") ? 0 : 1;
    if (aTr !== bTr) return aTr - bTr;
    return (a.name || "").localeCompare(b.name || "");
  });

  for (const voice of sorted) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} — ${voice.lang}`;
    if (voice.voiceURI === current) option.selected = true;
    voiceSelect.appendChild(option);
  }

  if (!current) {
    const language = preferredLanguage === "tr" ? "tr-TR" : preferredLanguage === "ku" ? "ku" : "en-US";
    const best = chooseVoice(sorted, language);
    if (best) {
      voiceSelect.value = best.voiceURI;
      preferredVoiceURI = best.voiceURI;
      localStorage.setItem("jarvis-voice-uri", preferredVoiceURI);
    }
  }
}

function openSettings() {
  if (!settingsModal) return;
  populateVoiceSelect();
  loadAccountUI();
  setTimeout(updateVoiceQualityHint, 120);

  if (voiceRate) voiceRate.value = String(preferredRate);
  if (voicePitch) voicePitch.value = String(preferredPitch);
  if (voiceRateValue) voiceRateValue.textContent = preferredRate.toFixed(2);
  if (voicePitchValue) voicePitchValue.textContent = preferredPitch.toFixed(2);

  settingsModal.classList.add("open");
  settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsModal?.classList.remove("open");
  settingsModal?.setAttribute("aria-hidden", "true");
}

function loadAccountUI() {
  const profile = JSON.parse(localStorage.getItem("jarvis-local-account") || "null");

  if (profile) {
    accountName.value = profile.name || "";
    accountEmail.value = profile.email || "";
    accountStatus.textContent = `چوویتە ژوورەوە وەک ${profile.name || profile.email || "User"}`;
    logoutAccountBtn.hidden = false;
    saveAccountBtn.textContent = "نوێکردنەوەی هەژمار";
  } else {
    accountName.value = "";
    accountEmail.value = "";
    accountStatus.textContent = "هێشتا هەژمارێکت نییە لەم ئامێرە";
    logoutAccountBtn.hidden = true;
    saveAccountBtn.textContent = "دروستکردنی هەژمار";
  }
}

function saveLocalAccount() {
  const name = accountName.value.trim();
  const email = accountEmail.value.trim();

  if (!name || !email) {
    accountStatus.textContent = "ناو و ئیمەیڵ پڕ بکەرەوە";
    return;
  }

  const profile = {
    name,
    email,
    createdAt: new Date().toISOString()
  };

  localStorage.setItem("jarvis-local-account", JSON.stringify(profile));
  accountStatus.textContent = `هەژمارەکەت دروست بوو: ${name}`;
  logoutAccountBtn.hidden = false;
  saveAccountBtn.textContent = "نوێکردنەوەی هەژمار";
}

function logoutLocalAccount() {
  localStorage.removeItem("jarvis-local-account");
  loadAccountUI();
}

settingsBtn?.addEventListener("click", openSettings);
closeSettingsBtn?.addEventListener("click", closeSettings);
settingsModal?.addEventListener("click", e => {
  if (e.target === settingsModal) closeSettings();
});

voiceSelect?.addEventListener("change", () => {
  preferredVoiceURI = voiceSelect.value;
  localStorage.setItem("jarvis-voice-uri", preferredVoiceURI);
});

voiceRate?.addEventListener("input", () => {
  preferredRate = Number(voiceRate.value);
  localStorage.setItem("jarvis-voice-rate", String(preferredRate));
  voiceRateValue.textContent = preferredRate.toFixed(2);
});

voicePitch?.addEventListener("input", () => {
  preferredPitch = Number(voicePitch.value);
  localStorage.setItem("jarvis-voice-pitch", String(preferredPitch));
  voicePitchValue.textContent = preferredPitch.toFixed(2);
});

testVoiceBtn?.addEventListener("click", async () => {
  const sample =
    preferredLanguage === "tr"
      ? "Merhaba, ben JARVIS. Türkçe ses testi yapıyorum."
      : preferredLanguage === "ku"
        ? "سڵاو، من جارڤیسم. ئەمە تاقیکردنەوەی دەنگە."
        : "Hello, I am JARVIS. This is a voice test.";

  await speakText(sample);
});

saveAccountBtn?.addEventListener("click", saveLocalAccount);
logoutAccountBtn?.addEventListener("click", logoutLocalAccount);

if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", populateVoiceSelect);
}


naturalVoiceBtn?.addEventListener("click", async () => {
  const isAppleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  preferredRate = preferredLanguage === "tr"
    ? (isAppleMobile ? 0.94 : 0.96)
    : 0.98;
  preferredPitch = preferredLanguage === "tr" ? 0.98 : 1.00;

  localStorage.setItem("jarvis-voice-rate", String(preferredRate));
  localStorage.setItem("jarvis-voice-pitch", String(preferredPitch));
  localStorage.setItem("jarvis-voice-natural-v2", "1");

  if (voiceRate) voiceRate.value = String(preferredRate);
  if (voicePitch) voicePitch.value = String(preferredPitch);
  if (voiceRateValue) voiceRateValue.textContent = preferredRate.toFixed(2);
  if (voicePitchValue) voicePitchValue.textContent = preferredPitch.toFixed(2);

  const voices = await getSpeechVoices();
  const language = preferredLanguage === "tr" ? "tr-TR" : preferredLanguage === "ku" ? "ku" : "en-US";
  const best = chooseVoice(voices, language);

  if (best) {
    preferredVoiceURI = best.voiceURI;
    localStorage.setItem("jarvis-voice-uri", preferredVoiceURI);
    if (voiceSelect) voiceSelect.value = preferredVoiceURI;
  }

  await speakText(
    preferredLanguage === "tr"
      ? "Merhaba, şimdi daha doğal ve akıcı konuşuyorum."
      : "سڵاو، ئێستا بە شێوەیەکی سروشتیتر قسە دەکەم."
  );
});


function updateVoiceQualityHint() {
  if (!voiceSelect) return;

  const selected = voiceSelect.options[voiceSelect.selectedIndex];
  const label = String(selected?.textContent || "");
  let hint = document.getElementById("voiceQualityHint");

  if (!hint) return;

  if (preferredLanguage === "tr") {
    if (/(premium|enhanced|natural|siri|yelda|cem|apple)/i.test(label)) {
      hint.textContent = "✅ دەنگی تورکی سروشتی/بەرزکوالێتی هەڵبژێردراوە";
    } else if (/tr-TR/i.test(label)) {
      hint.textContent = "🟡 دەنگی تورکی هەیە، بەڵام Enhanced/Premium ئەگەر هەبێت سروشتیترە";
    } else {
      hint.textContent = "⚠️ دەنگی tr-TR نەدۆزرایەوە؛ لە iPhone Turkish voice دابەزێنە";
    }
  } else {
    hint.textContent = "";
  }
}

voiceSelect?.addEventListener("change", updateVoiceQualityHint);
window.addEventListener("load", () => setTimeout(updateVoiceQualityHint, 300));


function parsePcCommand(text) {
  const raw = String(text || "").toLowerCase().trim();
  const t = raw.replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();

  const wantsOpen =
    /\b(open|launch|start|run|aç|başlat|çalıştır|ouvrir|abre|abrir|öffnen|apri|открой|افتح|باز کن)\b/.test(t) ||
    /(بکەرەوە|بکەوە)/.test(raw);

  const appRules = [
    ["notepad", /notepad|not defteri|نۆتپاد|نۆت پاد|المفكرة|bloc-notes|bloc de notas/],
    ["calculator", /calculator|hesap makinesi|کالکیولەیتەر|حیسابکەر|الحاسبة|calculatrice|rechner|calculadora/],
    ["explorer", /file explorer|explorer|dosya gezgini|فایل ئێکسپلۆرەر|فایل ئەکسپلۆرەر|مستكشف الملفات/],
    ["settings", /settings|ayarlar|سێتینگ|ڕێکخستنەکان|الإعدادات|paramètres|einstellungen|configuración/],
    ["paint", /paint|mspaint|الرسم/],
    ["task_manager", /task manager|görev yöneticisi|مدير المهام/],
    ["control_panel", /control panel|denetim masası|لوحة التحكم/],
    ["chrome", /chrome|google chrome/],
    ["edge", /microsoft edge|\bedge\b/],
    ["vscode", /visual studio code|vs code|vscode/],
    ["word", /microsoft word|\bword\b/],
    ["excel", /microsoft excel|\bexcel\b/],
    ["powerpoint", /powerpoint|power point/]
  ];

  if (wantsOpen) {
    for (const [target, pattern] of appRules) {
      if (pattern.test(raw)) return { action: "open_app", target };
    }

    const siteRules = [
      ["google", /\bgoogle\b/],
      ["youtube", /youtube/],
      ["github", /github/],
      ["gmail", /gmail/],
      ["cloudflare", /cloudflare/],
      ["chatgpt", /chatgpt|chat gpt/]
    ];

    for (const [target, pattern] of siteRules) {
      if (pattern.test(raw)) return { action: "open_site", target };
    }
  }

  if (/volume up|increase volume|sesi aç|sesi yükselt|دەنگ زیاد|ارفع الصوت|augmente le volume|sube el volumen/.test(raw)) {
    return { action: "volume_up", target: "" };
  }

  if (/volume down|decrease volume|sesi kıs|sesi azalt|دەنگ کەم|اخفض الصوت|baisse le volume|baja el volumen/.test(raw)) {
    return { action: "volume_down", target: "" };
  }

  if (/\bmute\b|sessize al|sesi kapat|بێدەنگ|اكتم الصوت|coupe le son|silencio/.test(raw)) {
    return { action: "mute", target: "" };
  }

  if (/screenshot|screen shot|ekran görüntüsü|سكرين شوت|وێنەی شاشە|capture d'écran|captura de pantalla/.test(raw)) {
    return { action: "screenshot", target: "" };
  }

  return null;
}

async function pcFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    return await fetch(PC_AGENT_URL + path, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPcAgent() {
  if (!pcStatusEl) return false;

  pcStatusEl.textContent = "PC: پشکنین...";

  try {
    const r = await pcFetch("/status");
    const data = await r.json();

    if (!r.ok || !data.ok) throw new Error("Agent unavailable");

    pcStatusEl.textContent = "🟢 PC Agent پەیوەستە";
    pcStatusEl.classList.add("connected");
    return true;
  } catch {
    pcStatusEl.textContent = "🔴 PC Agent پەیوەست نییە";
    pcStatusEl.classList.remove("connected");
    return false;
  }
}

async function runPcCommand(command) {
  try {
    const r = await pcFetch("/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: command.action,
        target: command.target || ""
      })
    });

    const data = await r.json();
    const ok = Boolean(r.ok && data.ok);

    if (pcStatusEl) {
      pcStatusEl.textContent = ok
        ? "🟢 PC Agent پەیوەستە"
        : "🔴 PC Agent هەڵەی هەیە";
    }

    return ok;
  } catch {
    if (pcStatusEl) {
      pcStatusEl.textContent = "🔴 PC Agent پەیوەست نییە";
    }
    return false;
  }
}

testPcBtn?.addEventListener("click", checkPcAgent);
window.addEventListener("load", () => setTimeout(checkPcAgent, 500));
