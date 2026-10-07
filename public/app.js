const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const mic = document.getElementById("mic");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const history = [];

let pc = null;
let dc = null;
let localStream = null;
let remoteAudio = null;
let liveActive = false;

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

function setLiveUI(active) {
  liveActive = active;
  mic.textContent = active ? "⏹" : "🎙️";
  mic.setAttribute("aria-label", active ? "Stop live voice" : "Start live voice");
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
      statusEl.textContent = "JARVIS گوێ دەگرێت... قسە بکە";
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
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        stopLiveVoice();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch("/api/realtime", {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: offer.sdp
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Realtime connection failed");
    }

    const answer = {
      type: "answer",
      sdp: await response.text()
    };

    await pc.setRemoteDescription(answer);
  } catch (error) {
    console.error(error);
    stopLiveVoice();

    const message = String(error?.message || "");
    if (message.includes("OPENAI_API_KEY")) {
      statusEl.textContent = "OPENAI_API_KEY لە Cloudflare دانەنراوە";
    } else if (error?.name === "NotAllowedError") {
      statusEl.textContent = "ڕێگە بە Microphone بدە";
    } else {
      statusEl.textContent = "Realtime voice پەیوەست نەبوو";
    }
  }
}

mic.addEventListener("click", () => {
  if (liveActive || pc) {
    stopLiveVoice();
  } else {
    startLiveVoice();
  }
});

window.addEventListener("pagehide", stopLiveVoice);
