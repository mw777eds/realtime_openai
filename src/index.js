import { loadSpeakingIndicator } from "./imageLoader.js";
import { loadLogoIndicator } from "./imageLoader_logo.js";

let estimatedDuration = 0;
let currentTimeout = null;

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

// Expose functions to FileMaker
window.initializeWebRTC = initializeWebRTC;
window.startAudioTransmission = startAudioTransmission;
window.stopAudioTransmission = stopAudioTransmission;
window.cleanupWebRTC = cleanupWebRTC;

// Function to start audio transmission
function startAudioTransmission() {
  console.log("Attempting to start audio transmission");
  
  // Unmute microphone input
  if (audioTrack) {
    audioTrack.enabled = true;
    console.log("Unmuted microphone input");
  } else {
    console.error("Microphone track not available");
  }

  // Unmute AI output
  if (audioEl && audioEl.srcObject) {
    const audioTracks = audioEl.srcObject.getAudioTracks();
    audioTracks.forEach(track => track.enabled = true);
    console.log("Unmuted AI output");
  } else {
    console.error("AI audio output not available");
  }
}

// Function to stop audio transmission
function stopAudioTransmission() {
  // Mute microphone input
  if (audioTrack) {
    audioTrack.enabled = false;
    console.log("Muted microphone input");
  }
  
  // Mute AI output and stop current response
  if (audioEl && audioEl.srcObject) {
    const audioTracks = audioEl.srcObject.getAudioTracks();
    audioTracks.forEach(track => track.enabled = false);
    console.log("Muted AI output");
    
    // Send stop event to cut off remaining content
    if (dc && dc.readyState === "open") {
      const stopEvent = {
        type: "response.stop"
      };
      dc.send(JSON.stringify(stopEvent));
      console.log("Sent stop event to cut off remaining content");
    }
  }

  // Immediately show logo and hide speaking indicator
  showLogoIndicator();
  hideSpeakingIndicator();
  // Clear any existing timeout
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
  estimatedDuration = 0;
}

// Function to cleanup WebRTC connection
function cleanupWebRTC() {
  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  console.log("WebRTC connection cleaned up");
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
let isPaused = false;
let audioTrack = null;
let audioEl = null;

function toggleAudioTransmission() {
  isPaused = !isPaused;
  const pausedOverlay = document.getElementById('pausedOverlay');
  
  if (isPaused) {
    stopAudioTransmission();
    pausedOverlay.style.display = 'flex';
  } else {
    startAudioTransmission();
    pausedOverlay.style.display = 'none';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSpeakingIndicator();
  loadLogoIndicator();
  
  // Add click handlers to both indicators and overlay
  document.getElementById('speakingIndicator').addEventListener('click', toggleAudioTransmission);
  document.getElementById('logoIndicator').addEventListener('click', toggleAudioTransmission);
  document.getElementById('pausedOverlay').addEventListener('click', toggleAudioTransmission);
});

async function initializeWebRTC(ephemeralKey, model, instructions, toolsStr, toolChoice) {
  try {
    pc = new RTCPeerConnection();

    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = e => {
      audioEl.srcObject = e.streams[0];
      // Get the audio tracks from the stream
      const audioTracks = audioEl.srcObject.getAudioTracks();
      if (isPaused) {
        audioTracks.forEach(track => track.enabled = false);
      }
    };

    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioTrack = ms.getTracks()[0];
    pc.addTrack(audioTrack);

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", () => {
      console.log("Data channel opened, sending session update");
      const sessionUpdateEvent = {
        type: "session.update",
        session: {
          instructions: instructions || "You are a helpful AI assistant.",
          tools: toolsStr ? JSON.parse(toolsStr) : [],
          tool_choice: toolChoice || "auto"
        }
      };
      dc.send(JSON.stringify(sessionUpdateEvent));
      console.log("Starting audio transmission after session update");
      startAudioTransmission();
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

      if (realtimeEvent.type === "response.audio_transcript.done" || 
          realtimeEvent.type === "error" || 
          realtimeEvent.type === "conversation.stopped") {
        // Clear any existing timeout
        if (currentTimeout) {
          clearTimeout(currentTimeout);
        }
        // Reset immediately for errors and stops
        if (realtimeEvent.type === "error" || realtimeEvent.type === "conversation.stopped") {
          showLogoIndicator();
          hideSpeakingIndicator();
          estimatedDuration = 0;
        } else {
          // Set new timeout for normal completion
          currentTimeout = setTimeout(() => {
            console.log("Hiding indicator after duration:", estimatedDuration);
            showLogoIndicator();
            hideSpeakingIndicator();
            estimatedDuration = 0; // Reset for the next response
            currentTimeout = null;
          }, estimatedDuration);
        }
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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
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
    } else {
      console.log("SDP response ok");
    }

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);
    console.log("WebRTC connection established");
    return pc;
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
    alert("Failed to initialize WebRTC. Please try again.");
  }
}


