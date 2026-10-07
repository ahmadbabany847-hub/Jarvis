const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const dictationBtn = document.getElementById("dictation");
const liveBtn = document.getElementById("liveVoice");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];

let pc = null;
let dc = null;
let localStream = null;
let remoteAudio = null;
let liveActive = false;

let recorder = null;
let recorderStream = null;
let audioChunks = [];
let dictating = false;

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
    if (!r.ok) throw new Error(data.error || "AI request failed");

    const answer = data.response || "وەڵامێک نەگەیشت.";
    ai.textContent = answer;
    history.push({ role: "assistant", content: answer });
    statusEl.textContent = liveActive
      ? "JARVIS گوێ دەگرێت..."
      : "JARVIS ئامادەیە";
  } catch (error) {
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

async function startDictation() {
  if (liveActive || pc) {
    statusEl.textContent = "سەرەتا Live Voice بوەستێنە";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    statusEl.textContent = "Voice typing لەم browser ـەدا پشتگیری ناکرێت";
    return;
  }

  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const preferred = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus"
    ];
    const mimeType = preferred.find(type =>
      MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : false
    );

    recorder = new MediaRecorder(
      recorderStream,
      mimeType ? { mimeType } : undefined
    );

    recorder.ondataavailable = event => {
      if (event.data?.size) audioChunks.push(event.data);
    };

    recorder.onstop = async () => {
      dictating = false;
      dictationBtn.classList.remove("active");
      dictationBtn.textContent = "🎙️";

      const type = recorder.mimeType || audioChunks[0]?.type || "audio/mp4";
      const blob = new Blob(audioChunks, { type });

      recorderStream?.getTracks().forEach(track => track.stop());
      recorderStream = null;

      if (!blob.size) {
        statusEl.textContent = "هیچ دەنگێک تۆمار نەکرا";
        return;
      }

      statusEl.textContent = "دەنگەکەت دەگۆڕم بۆ نووسین...";

      try {
        const r = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "content-type": type },
          body: blob
        });

        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Transcription failed");

        const text = (data.text || "").trim();
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

    recorder.start();
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
  if (recorder && dictating && recorder.state !== "inactive") {
    statusEl.textContent = "دەنگەکەت دەنێرم...";
    recorder.stop();
  }
}

function setLiveUI(active) {
  liveActive = active;
  liveBtn.classList.toggle("active", active);
  liveBtn.textContent = active ? "⏹" : "◉";
  liveBtn.setAttribute(
    "aria-label",
    active ? "Stop live voice" : "Start live voice"
  );
}

function stopLiveVoice() {
  if (dc) {
    try { dc.close(); } catch {}
    dc = null;
  }
  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
    remoteAudio = null;
  }

  setLiveUI(false);
  statusEl.textContent = "JARVIS ئامادەیە";
}

async function startLiveVoice() {
  if (dictating) {
    statusEl.textContent = "سەرەتا Voice typing بوەستێنە";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    statusEl.textContent = "Realtime voice لەم browser ـەدا پشتگیری ناکرێت";
    return;
  }

  try {
    statusEl.textContent = "پەیوەندی Voice دروست دەکەم...";

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    pc = new RTCPeerConnection();

    remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    remoteAudio.style.display = "none";
    document.body.appendChild(remoteAudio);

    pc.ontrack = event => {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => {});
    };

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    dc = pc.createDataChannel("oai-events");

    dc.onopen = () => {
      setLiveUI(true);
      statusEl.textContent = "Live Voice چالاکە — قسە بکە، JARVIS وەڵامت دەدات";
    };

    dc.onmessage = event => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "input_audio_buffer.speech_started") {
        statusEl.textContent = "گوێم لێتە...";
      } else if (data.type === "input_audio_buffer.speech_stopped") {
        statusEl.textContent = "JARVIS بیر دەکاتەوە...";
      } else if (data.type === "output_audio_buffer.started") {
        statusEl.textContent = "JARVIS قسە دەکات...";
      } else if (data.type === "output_audio_buffer.stopped") {
        statusEl.textContent = "JARVIS گوێ دەگرێت...";
      } else if (data.type === "response.output_audio_transcript.done") {
        const transcript = (data.transcript || "").trim();
        if (transcript) add(transcript, "ai");
      } else if (data.type === "error") {
        statusEl.textContent = data.error?.message || "Realtime voice error";
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setLiveUI(true);
        statusEl.textContent = "Live Voice چالاکە — قسە بکە";
      } else if (state === "connecting") {
        statusEl.textContent = "Live Voice پەیوەندی دروست دەکات...";
      } else if (state === "failed" || state === "closed") {
        statusEl.textContent = "Realtime voice connection " + state;
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "checking") {
        statusEl.textContent = "Voice network پشکنین دەکرێت...";
      } else if (state === "failed") {
        statusEl.textContent = "ICE connection failed";
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await waitForIceGatheringComplete(pc);

    const response = await fetch("/api/realtime", {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: pc.localDescription?.sdp || offer.sdp
    });

    if (!response.ok) {
      const raw = await response.text();
      let detail = raw;
      let code = "";

      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error || raw;
        code = parsed?.code || "";
      } catch {}

      if (code === "invalid_key") {
        throw new Error("INVALID_API_KEY");
      }

      if (code === "quota_or_rate_limit") {
        throw new Error("API_QUOTA");
      }

      throw new Error(detail || "Realtime connection failed");
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: await response.text()
    });
  } catch (error) {
    console.error(error);
    stopLiveVoice();

    const message = String(error?.message || "");
    if (message.includes("OPENAI_API_KEY")) {
      statusEl.textContent = "OPENAI_API_KEY لە Cloudflare دانەنراوە";
    } else if (message.includes("INVALID_API_KEY")) {
      statusEl.textContent = "OpenAI API key دروست نییە";
    } else if (message.includes("API_QUOTA")) {
      statusEl.textContent = "OpenAI API billing/credit پێویستە";
    } else if (error?.name === "NotAllowedError") {
      statusEl.textContent = "ڕێگە بە Microphone بدە";
    } else {
      statusEl.textContent = "Realtime voice error: " + message.slice(0, 90);
    }
  }
}

dictationBtn.addEventListener("click", () => {
  if (dictating) stopDictation();
  else startDictation();
});

liveBtn.addEventListener("click", () => {
  if (liveActive || pc) stopLiveVoice();
  else startLiveVoice();
});

window.addEventListener("pagehide", () => {
  stopLiveVoice();
  recorderStream?.getTracks().forEach(track => track.stop());
});


function waitForIceGatheringComplete(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 2500);

    function check() {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }

    peer.addEventListener("icegatheringstatechange", check);
  });
}
