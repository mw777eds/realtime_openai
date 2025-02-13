document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector("button");
  let isConnected = false;
  let pc = null;

  // Toggle WebRTC connection on button click
  btn.onclick = async function () {
    if (isConnected) {
      // Stop the connection
      pc.close();
      pc = null;
      isConnected = false;
      btn.textContent = "Start Talking";
    } else {
      // Start the connection
      pc = await initWebRTC();
      isConnected = true;
      btn.textContent = "Stop Talking";
    }
  };
});

// Initialize WebRTC connection
async function initWebRTC() {
  let pc;
  try {
    // Get an ephemeral key from the specified URL
    const tokenResponse = await fetch("https://n8n.empowereddatasolutions.com/webhook/realtime");
    if (!tokenResponse.ok) {
      throw new Error(`HTTP error! status: ${tokenResponse.status}`);
    }
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data[0]?.client_secret?.value;
    if (!EPHEMERAL_KEY) {
      throw new Error("Failed to retrieve ephemeral key");
    }

  // Create a peer connection
    pc = new RTCPeerConnection();

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

    if (!sdpResponse.ok) {
      throw new Error(`SDP response error! status: ${sdpResponse.status}`);
    }

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);
    return pc;
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
    alert("Failed to initialize WebRTC. Please try again.");
  }
}

// this function is called by FileMaker.
window.loadWidget = function () {
  console.log("FileMaker called this function");
};
