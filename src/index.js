import { sampleData } from "./sampleData";
const btn = document.querySelector("button");

// the JS button
btn.onclick = async function () {
  console.log("You ran some JavaScript");
  alert("You ran some JavaScript");
  await initWebRTC();
};

// Initialize WebRTC connection
async function initWebRTC() {
  // Get an ephemeral key from the specified URL
  try {
    const tokenResponse = await fetch("https://n8n.empowereddatasolutions.com/webhook-test/realtime");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data[0].client_secret.value;

  // Create a peer connection
    const pc = new RTCPeerConnection();

  // Set up to play remote audio from the model
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = e => audioEl.srcObject = e.streams[0];

  // Add local audio track for microphone input in the browser
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
  pc.addTrack(ms.getTracks()[0]);

  // Set up data channel for sending and receiving events
  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", (e) => {
    // Realtime server events appear here!
    const realtimeEvent = JSON.parse(e.data);
    console.log(realtimeEvent);
  });

  // Start the session using the Session Description Protocol (SDP)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2024-12-17";
  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${EPHEMERAL_KEY}`,
      "Content-Type": "application/sdp"
    },
  });

  const answer = {
    type: "answer",
    sdp: await sdpResponse.text(),
  };
  await pc.setRemoteDescription(answer);
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
    alert("Failed to initialize WebRTC. Please try again.");
  }
}

// this function is called by FileMaker.
window.loadWidget = function () {
  console.log("FileMaker called this function");
};
