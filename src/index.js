let canvas;
let ctx;
let animationId;


// Expose functions to FileMaker
window.initializeWebRTC = initializeWebRTC;
window.startAudioTransmission = startAudioTransmission;
window.stopAudioTransmission = stopAudioTransmission;
window.cleanupWebRTC = cleanupWebRTC;
window.sendToolResponse = sendToolResponse;
window.createModelResponse = createModelResponse;

// Function to send tool response back to OpenAI
function sendToolResponse(toolResponse) {
  toolResponse = JSON.parse(toolResponse);
  
  if (!toolResponse.call_id) {
    console.error("Missing call_id in toolResponse");
    return;
  }

  if (dc && dc.readyState === "open") {
    const response = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: toolResponse.call_id,
        output: JSON.stringify(toolResponse.output)
      }
    };
    console.log("Preparing to send response:", response);
    console.log("Response stringified:", JSON.stringify(response));
    
    dc.send(JSON.stringify(response));
    console.log("Sent tool response");
  } else {
    console.error("Data channel not ready for tool response. State:", dc ? dc.readyState : "no dc");
  }
}

// Function to trigger model response after tools
function createModelResponse() {
  if (dc && dc.readyState === "open") {
    const responseCreateEvent = {
      type: "response.create",
      response: {
        modalities: ["text", "audio"]
      }
    };
    dc.send(JSON.stringify(responseCreateEvent));
    console.log("Requested new model response");
  } else {
    console.error("Data channel not ready for response creation");
  }
}

// Function to start audio transmission
function startAudioTransmission() {
  
  // Unmute microphone input
  if (audioTrack) {
    audioTrack.enabled = true;
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
async function stopAudioTransmission() {
  return new Promise((resolve) => {
    // Mute microphone input
    if (audioTrack) {
      audioTrack.enabled = false;
      console.log("Muted microphone input");
    }
    
    // Mute AI output
    if (audioEl && audioEl.srcObject) {
      const audioTracks = audioEl.srcObject.getAudioTracks();
      audioTracks.forEach(track => track.enabled = false);
      console.log("Muted AI output");
    }

    // Stop waveform animation
    stopWaveform();
    
    resolve();
  });
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
}

function initializeCanvas() {
  canvas = document.getElementById('waveform');
  ctx = canvas.getContext('2d');
  
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function drawWaveform(dataArray) {
  if (!ctx) return;
  
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#006690';
  ctx.beginPath();
  
  const bufferLength = dataArray.length;
  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;
  
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    
    x += sliceWidth;
  }
  
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

function startWaveform() {
  if (!animationId && audioAnalyser) {
    function draw() {
      animationId = requestAnimationFrame(draw);
      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioAnalyser.getByteTimeDomainData(dataArray);
      drawWaveform(dataArray);
    }
    draw();
  }
}

function stopWaveform() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    if (ctx) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}


let pc = null;
let dc = null;
let isPaused = false;
let audioTrack = null;
let audioEl = null;
let audioContext = null;
let audioAnalyser = null;
let audioDataArray = null;

function initAudioAnalyser() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  }
}

function checkAudioActivity() {
  if (audioAnalyser && !isPaused) {
    audioAnalyser.getByteFrequencyData(audioDataArray);
    const average = audioDataArray.reduce((a, b) => a + b) / audioDataArray.length;
    
    // Use a threshold to determine if there's meaningful audio
    const AUDIO_THRESHOLD = 10; // Adjust this value based on testing
    const hasAudio = average > AUDIO_THRESHOLD;
    
    if (hasAudio) {
      startWaveform();
    } else {
      stopWaveform();
    }
    
    return hasAudio;
  }
  return false;
}

async function toggleAudioTransmission() {
  isPaused = !isPaused;
  const mutedOverlay = document.getElementById('mutedOverlay');
  
  if (isPaused) {
    await stopAudioTransmission();
    mutedOverlay.style.display = 'flex';
  } else {
    if (!dc || dc.readyState !== "open") {
      console.log("Data channel not ready, reinitializing WebRTC");
      // Reset the paused state since we're reinitializing
      isPaused = false;
      mutedOverlay.style.display = 'none';
      cleanupWebRTC(); // Clean up old connection
      // Trigger reinitialization from FileMaker
      if (window.FileMaker) {
        window.FileMaker.PerformScript("SendToOpenAI", "");
      }
    } else {
      startAudioTransmission();
      mutedOverlay.style.display = 'none';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSpeakingIndicator();
  loadLogoIndicator();
  
  // Initialize canvas and add click handlers
  initializeCanvas();
  document.getElementById('waveform').addEventListener('click', toggleAudioTransmission);
  document.getElementById('mutedOverlay').addEventListener('click', toggleAudioTransmission);

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
      
      // Set up audio analysis
      initAudioAnalyser();
      const source = audioContext.createMediaStreamSource(e.streams[0]);
      source.connect(audioAnalyser);
      
      // Start monitoring audio levels
      setInterval(checkAudioActivity, 100);
    };

    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioTrack = ms.getTracks()[0];
    pc.addTrack(audioTrack);

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", () => {
      const sessionUpdateEvent = {
        type: "session.update",
        session: {
          instructions: instructions || "You are a helpful AI assistant.",
          tools: toolsStr ? JSON.parse(toolsStr) : [],
          tool_choice: toolChoice || "auto",
          input_audio_transcription: {
            model: "whisper-1"
          },
          modalities: ["text", "audio"]
        }
      };
      dc.send(JSON.stringify(sessionUpdateEvent));
      startAudioTransmission();
    });

    dc.addEventListener("message", async (e) => {
      // Realtime server events appear here!
      const realtimeEvent = JSON.parse(e.data);
      console.log(`[${new Date().toISOString()}] Type:`, realtimeEvent.type);
      console.log(`[${new Date().toISOString()}] Event:`, realtimeEvent);

      if (realtimeEvent.type === "response.done" && realtimeEvent.response.output?.some(item => item.type === "function_call")) {
        const toolCalls = realtimeEvent.response.output.filter(item => item.type === "function_call");
        console.log("Model tool calls:", toolCalls);
        if (window.FileMaker) {
          window.FileMaker.PerformScript("CallTools", JSON.stringify({'toolCalls':toolCalls}));
        }
      }

      if (realtimeEvent.type === "response.done" && realtimeEvent.response.output) {
        console.log("Model response:", realtimeEvent.response.output[0]);
        if (window.FileMaker && realtimeEvent.response.output[0].content?.[0]?.transcript) {
          window.FileMaker.PerformScript("LogMessage", JSON.stringify({
            roll: "assistant",
            message: realtimeEvent.response.output[0].content[0].transcript
          }));
        }
      }

      if (realtimeEvent.type === "conversation.item.input_audio_transcription.completed") {
        // Check if we have a transcript in the expected location
        const transcript = realtimeEvent.item?.content?.transcript || realtimeEvent.transcript || '';
        if (transcript) {
          console.log("User message:", transcript);
          if (window.FileMaker) {
            window.FileMaker.PerformScript("LogMessage", JSON.stringify({
              roll: "user",
              message: transcript
            }));
          }
        }
      }



      if (realtimeEvent.type === "error" || 
          realtimeEvent.type === "conversation.stopped") {
        showLogoIndicator();
        hideSpeakingIndicator();
      }

      if (realtimeEvent.type === "error") {
        console.error("Error event received:", realtimeEvent.error);
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


            // After sending the tool response, request the model to generate a response
            const responseCreateEvent = {
              type: "response.create",
              response: {
                modalities: ["text"]
              }
            };
            dc.send(JSON.stringify(responseCreateEvent));
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
    }

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);
    /* TODO: Change the UI from loading to showing the logo */
    return pc;
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
    alert("Failed to initialize WebRTC. Please try again.");
  }
}
