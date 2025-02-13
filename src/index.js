import { loadSpeakingIndicator } from "./imageLoader.js";
import { loadLogoIndicator } from "./imageLoader_logo.js";

let estimatedDuration = 0;

function estimateDuration(delta) {
  try {
    const words = delta.split(/\s+/).filter(Boolean);
    words.forEach(word => {
      estimatedDuration += 200; // Base time per word
      if (/[.,!?]/.test(word)) {
        estimatedDuration += 300; // Extra time for punctuation
      }
    });
  } catch (error) {
    console.error("Error estimating duration:", error);
  }
}

function showLogoIndicator() {
  const logoIndicator = document.getElementById('logoIndicator');
  logoIndicator.style.display = 'block';
}

function hideLogoIndicator() {
  const logoIndicator = document.getElementById('logoIndicator');
  logoIndicator.style.display = 'none';
}

function showSpeakingIndicator() {
  const indicator = document.getElementById('speakingIndicator');
  indicator.style.display = 'block';
}

function hideSpeakingIndicator() {
  const indicator = document.getElementById('speakingIndicator');
  indicator.style.display = 'none';
}

let pc = null;
let dc = null;

async function initializeWebRTC(ephemeralKey, instructions, tools, toolChoice) {
  try {
    pc = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = e => audioEl.srcObject = e.streams[0];

    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(ms.getTracks()[0]);

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", () => {
      const sessionUpdateEvent = {
        type: "session.update",
        session: {
          instructions,
          tools,
          tool_choice: toolChoice
        }
      };
      dc.send(JSON.stringify(sessionUpdateEvent));
    });

    dc.addEventListener("message", handleRealtimeEvents);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
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
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
  }
}

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
  dc.addEventListener("open", () => {
    // Update session with system prompt and tools
    const sessionUpdateEvent = {
      type: "session.update",
      session: {
        instructions: "You are a helpful AI assistant embedded in a FileMaker WebViewer. You can use your ge_current_datetime tool to find out the time.  If asked anything about date/time do not maek it up.  Use the tools provided or say I don't know.",
        tools: [
          {
            type: "function",
            name: "get_current_datetime",
            description: "Returns the current date and time in ISO 8601 format.",
            parameters: {}
          }
        ],
        tool_choice: "auto"
      }
    };
    dc.send(JSON.stringify(sessionUpdateEvent));
  });

  dc.addEventListener("message", (e) => {
    // Realtime server events appear here!
    const realtimeEvent = JSON.parse(e.data);
    console.log(`[${new Date().toISOString()}] Event:`, realtimeEvent);

    if (realtimeEvent.type === "response.done" && realtimeEvent.response.output) {
      console.log("Model response:", realtimeEvent.response.output[0]);
    }

    console.log(`[${new Date().toISOString()}] Type:`, realtimeEvent.type);
    
    if (realtimeEvent.type === "response.audio_transcript.delta") {
      showSpeakingIndicator();
      hideLogoIndicator();
      estimateDuration(realtimeEvent.delta);
      console.log("Estimated duration:", estimatedDuration);
    }

    if (realtimeEvent.type === "response.audio_transcript.done") {
      setTimeout(() => {
        console.log("Hiding indicator after duration:", estimatedDuration);
        showLogoIndicator();
        hideSpeakingIndicator();
        estimatedDuration = 0; // Reset for the next response
      }, estimatedDuration);
    }

    if (realtimeEvent.tool_calls) {
      for (const tool of realtimeEvent.tool_calls) {
        if (tool.name === "get_current_datetime") {
          const toolResponse = {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: tool.call_id,
              output: {
                current_datetime: new Date().toISOString()
              }
            }
          };

          // Send tool response back to OpenAI
          dc.send(JSON.stringify(toolResponse));

          console.log(`[${new Date().toISOString()}] Tool response sent:`, toolResponse);

          // After sending the tool response, request the model to generate a response
          const responseCreateEvent = {
            type: "response.create",
            response: {
              modalities: ["text"]
            }
          };
          dc.send(JSON.stringify(responseCreateEvent));
          console.log(`[${new Date().toISOString()}] Response create event sent:`, responseCreateEvent);
        }
      }
    }
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
    }else{
      console.log("SDP response ok")
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

