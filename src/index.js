import { showIcon } from './icons.js';

/* 
 * Canvas-related variables for the audio waveform visualization
 * canvas: The HTML canvas element
 * ctx: The 2D rendering context
 * animationId: Reference to the animation frame for cancellation
 */
let canvas;
let ctx;
let animationId;


/* 
 * Expose functions to FileMaker
 * These functions can be called from FileMaker scripts to control
 * the WebRTC connection and audio transmission
 */
window.initializeWebRTC = initializeWebRTC;
window.startAudioTransmission = startAudioTransmission;
window.stopAudioTransmission = stopAudioTransmission;
window.sendResponseCancel = sendResponseCancel;
window.stopLLMGeneration = stopLLMGeneration;
window.hasActiveResponse = hasActiveResponse;
window.cleanupWebRTC = cleanupWebRTC;
window.sendToolResponse = sendToolResponse;
window.createModelResponse = createModelResponse;

/* 
 * Function to send tool response back to OpenAI
 * 
 * This function takes the output from a tool execution in FileMaker
 * and sends it back to the OpenAI API through the WebRTC data channel.
 * 
 * @param {string} toolResponse - JSON string containing the tool response data
 */
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

/* 
 * Function to trigger model response after tools
 * 
 * After a tool has been executed and its response sent back to OpenAI,
 * this function requests the model to generate a new response.
 * It also updates the UI to show the listening icon.
 */
function createModelResponse() {
  if (dc && dc.readyState === "open") {
    /* Switch from thinking to listening icon */
    if (!isPaused) {
      showIcon('ear');
    }

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

/* 
 * Function to start audio transmission
 * 
 * Enables both the microphone input and AI audio output tracks.
 * Called when the user unmutes or starts a new conversation.
 */
function startAudioTransmission() {
  
  /* Unmute microphone input */
  if (audioTrack) {
    audioTrack.enabled = true;
  } else {
    console.error("Microphone track not available");
  }

  /* Unmute AI output */
  if (audioEl && audioEl.srcObject) {
    const audioTracks = audioEl.srcObject.getAudioTracks();
    audioTracks.forEach(track => track.enabled = true);
    console.log("Unmuted AI output");
  } else {
    console.error("AI audio output not available");
  }
}

/* 
 * Function to send response.cancel event
 * 
 * Sends a cancel event to the OpenAI API to interrupt the model's
 * current speech. This is used when the user mutes the audio or
 * wants to interrupt the AI's response.
 * 
 * @returns {boolean} - True if cancel event was sent, false otherwise
 */
function sendResponseCancel() {
  if (dc && dc.readyState === "open") {
    /* 
     * Check if there's an active response by checking if audio is playing
     * and if we have an active response ID 
     */
    console.log("sendResponseCancel called, activeResponseId:", window.activeResponseId);
    
    if (window.activeResponseId) {
      const cancelEvent = {
        type: "response.cancel"
      };
      dc.send(JSON.stringify(cancelEvent));
      console.log("Sent response.cancel event to interrupt model's speech");
      return true;
    } else {
      console.log("No active response ID found - skipping cancel event");
      return false;
    }
  } else {
    console.error("Data channel is not open");
    return false;
  }
}

/* 
 * Function to check if there's an active response
 * 
 * Determines if the AI is currently speaking by checking
 * the audio element's state.
 * 
 * @returns {boolean} - True if AI is speaking, false otherwise
 */
function hasActiveResponse() {
  /* Check if audio is currently playing */
  const isPlaying = audioEl && audioEl.srcObject && !audioEl.paused;
  console.log("hasActiveResponse check:", {
    audioEl: !!audioEl,
    srcObject: !!(audioEl && audioEl.srcObject),
    notPaused: !!(audioEl && !audioEl.paused),
    isPlaying: isPlaying
  });
  return isPlaying;
}

/* 
 * Function to stop the LLM from generating more content
 * 
 * Sends a stop event to the OpenAI API to completely halt
 * the language model's generation process. This is more
 * aggressive than just canceling the current response.
 * 
 * @returns {boolean} - True if stop event was sent, false otherwise
 */
function stopLLMGeneration() {
  if (dc && dc.readyState === "open") {
    const stopEvent = {
      type: "stop"
    };
    dc.send(JSON.stringify(stopEvent));
    console.log("Sent stop event to cut off LLM output");
    return true;
  }
  return false;
}

/* 
 * Function to stop audio transmission
 * 
 * Disables both the microphone input and AI audio output tracks.
 * Also stops the waveform animation.
 * 
 * @returns {Promise} - Resolves when audio transmission is stopped
 */
async function stopAudioTransmission() {
  return new Promise((resolve) => {
    /* Mute microphone input */
    if (audioTrack) {
      audioTrack.enabled = false;
      console.log("Muted microphone input");
    }
    
    /* Mute AI output */
    if (audioEl && audioEl.srcObject) {
      const audioTracks = audioEl.srcObject.getAudioTracks();
      audioTracks.forEach(track => track.enabled = false);
      console.log("Muted AI output");
    }

    /* Stop waveform animation */
    stopWaveform();
    
    resolve();
  });
}

/* 
 * Function to cleanup WebRTC connection
 * 
 * Closes the data channel and peer connection,
 * and resets the active response ID.
 * Called when reinitializing the connection or
 * when the application is closed.
 */
function cleanupWebRTC() {
  /* Clear active response ID when cleaning up */
  window.activeResponseId = null;
  
  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
}

/* 
 * Function to initialize the canvas for waveform visualization
 * 
 * Sets up the canvas element and its context, and adds a resize
 * event listener to ensure the canvas always fills the window.
 */
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

/* 
 * Function to draw the audio waveform visualization
 * 
 * Takes audio data and renders it as a waveform on the canvas.
 * 
 * @param {Uint8Array} dataArray - Audio data from the analyzer
 */
function drawWaveform(dataArray) {
  if (!ctx) return;
  
  /* Clear the canvas with white background */
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  /* Set up line style for the waveform */
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-color');
  ctx.beginPath();
  
  const bufferLength = dataArray.length;
  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;
  
  /* Draw the waveform line */
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

/* 
 * Function to start the waveform animation
 * 
 * Begins the animation loop that continuously samples audio data
 * and updates the waveform visualization.
 */
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

/* 
 * Function to display an error message to the user
 * 
 * Creates and shows an error message overlay with the specified text.
 * 
 * @param {string} message - The error message to display
 */
function showErrorMessage(message) {
  // Create error container if it doesn't exist
  let errorContainer = document.getElementById('errorContainer');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'errorContainer';
    document.body.appendChild(errorContainer);
  }
  
  // Set the error message
  errorContainer.textContent = message;
  errorContainer.style.display = 'flex';
  
  // Hide the error after 5 seconds
  setTimeout(() => {
    errorContainer.style.display = 'none';
  }, 5000);
}

/* 
 * Function to stop the waveform animation
 * 
 * Cancels the animation frame, clears the canvas,
 * and shows the ear icon if not paused.
 */
function stopWaveform() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    if (ctx) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const earIcon = document.getElementById('earIcon');
    if (earIcon && !isPaused) {
      earIcon.style.display = 'block';
    }
  }
}


/* 
 * WebRTC and audio processing variables
 * 
 * pc: RTCPeerConnection for WebRTC
 * dc: Data channel for sending/receiving events
 * isPaused: Flag indicating if audio transmission is paused
 * audioTrack: The microphone audio track
 * audioEl: Audio element for playing AI responses
 * audioContext: Web Audio API context
 * audioAnalyser: Analyser node for processing audio data
 * audioDataArray: Buffer for audio data
 */
let pc = null;
let dc = null;
let isPaused = false;
let audioTrack = null;
let audioEl = null;
let audioContext = null;
let audioAnalyser = null;
let audioDataArray = null;

/* 
 * Function to initialize the audio analyzer
 * 
 * Creates an audio context and analyzer for processing
 * audio data to visualize the waveform and detect activity.
 */
function initAudioAnalyser() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  }
}

/* 
 * Function to check for audio activity
 * 
 * Analyzes the audio data to determine if there's meaningful
 * audio input. If there is, shows the waveform; otherwise,
 * shows the ear icon.
 * 
 * @returns {boolean} - True if audio activity is detected, false otherwise
 */
function checkAudioActivity() {
  if (audioAnalyser && !isPaused) {
    audioAnalyser.getByteFrequencyData(audioDataArray);
    const average = audioDataArray.reduce((a, b) => a + b) / audioDataArray.length;
    
    /* Use a threshold to determine if there's meaningful audio */
    const AUDIO_THRESHOLD = 10; /* Adjust this value based on testing */
    const hasAudio = average > AUDIO_THRESHOLD;
    const iconOverlay = document.getElementById('iconOverlay');
    
    if (hasAudio && !isPaused) {
      startWaveform();
      iconOverlay.style.display = 'none';
    } else {
      stopWaveform();
      if (!isPaused) {
        iconOverlay.style.display = 'flex';
        showIcon('ear');
      }
    }
    
    return hasAudio;
  }
  return false;
}

/* 
 * Function to toggle audio transmission on/off
 * 
 * Handles the mute/unmute functionality when the user clicks
 * the interface. When pausing, it stops audio transmission and
 * cancels any active response. When resuming, it either restarts
 * the existing connection or reinitializes WebRTC if needed.
 */
async function toggleAudioTransmission() {
  console.log('Toggle clicked. Current isPaused:', isPaused);
  isPaused = !isPaused;
  console.log('New isPaused state:', isPaused);
  
  const iconOverlay = document.getElementById('iconOverlay');
  console.log('Icon overlay display:', iconOverlay.style.display);

  if (isPaused) {
    console.log('Pausing audio transmission');
    await stopAudioTransmission();
    
    /* Only attempt to cancel if we have an active response ID */
    console.log('Checking for active response before canceling, activeResponseId:', window.activeResponseId);
    if (window.activeResponseId) {
      sendResponseCancel();
    }
    
    showIcon('sleep');
  } else {
    console.log('Resuming audio transmission');
    if (!dc || dc.readyState !== "open") {
      console.log("Data channel not ready, reinitializing WebRTC");
      /* Reset the paused state since we're reinitializing */
      isPaused = false;
      showIcon('ear');
      cleanupWebRTC(); /* Clean up old connection */
      /* Trigger reinitialization from FileMaker */
      if (window.FileMaker) {
        /* This needs to be looked at this script should not be used */
        //window.FileMaker.PerformScript("SendToOpenAI", "");
      }
    } else {
      startAudioTransmission();
      showIcon('ear');
    }
  }
}

/* 
 * Initialize the application when the DOM is fully loaded
 * 
 * Sets up the canvas, adds event listeners, and shows the initial ear icon.
 */
document.addEventListener("DOMContentLoaded", () => {
  /* Initialize canvas */
  initializeCanvas();
  
  /* Add click handler to the click overlay */
  document.getElementById('clickOverlay').addEventListener('click', toggleAudioTransmission);
  
  /* Show ear icon by default */
  showIcon('ear');
});

/* 
 * Function to initialize the WebRTC connection with OpenAI
 * 
 * Sets up the peer connection, data channel, and audio tracks
 * for real-time communication with the OpenAI API.
 * 
 * @param {string} ephemeralKey - OpenAI API key
 * @param {string} model - The model to use (e.g., "gpt-4o")
 * @param {string} instructions - System instructions for the AI
 * @param {string} toolsStr - JSON string of available tools
 * @param {string} toolChoice - Tool selection strategy
 * @returns {RTCPeerConnection} - The established peer connection
 */
async function initializeWebRTC(ephemeralKey, model, instructions, toolsStr, toolChoice) {
  /* Initialize activeResponseId tracking */
  window.activeResponseId = null;
  
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
  
      // Track response state for debugging
      if (realtimeEvent.type === "response.created") {
        console.log("Response created, setting activeResponseId:", realtimeEvent.response.id);
        window.activeResponseId = realtimeEvent.response.id;
      } else if (realtimeEvent.type === "response.done") {
        console.log("Response done, clearing activeResponseId");
        window.activeResponseId = null;
      }

      if (realtimeEvent.type === "response.done" && realtimeEvent.response.output?.some(item => item.type === "function_call")) {
        const toolCalls = realtimeEvent.response.output.filter(item => item.type === "function_call");
        console.log("Model tool calls:", toolCalls);
        if (window.FileMaker) {
          showIcon('thought');
          
          // Clear any pending timeouts
          if (window.earIconTimeout) {
            clearTimeout(window.earIconTimeout);
            delete window.earIconTimeout;
          }
          
          // Call FileMaker script once
          window.FileMaker.PerformScript("CallTools", JSON.stringify({'toolCalls':toolCalls}));
        }
      }

      // Only handle response.done if it's not a function call
      if (realtimeEvent.type === "response.done") {
        // Check for error status
        if (realtimeEvent.response.status === "failed") {
          console.error("Response failed with status details:", realtimeEvent.response.status_details);
          
          if (realtimeEvent.response.status_details?.error) {
            const errorCode = realtimeEvent.response.status_details.error.code;
            const errorMessage = realtimeEvent.response.status_details.error.message;
            const errorType = realtimeEvent.response.status_details.error.type;
            
            console.error("Error code:", errorCode);
            console.error("Error message:", errorMessage);
            console.error("Error type:", errorType);
            
            // Handle insufficient_quota error specifically
            if (errorCode === "insufficient_quota") {
              // Show the complete error message without truncation
              showErrorMessage(errorMessage);
              
              // Notify FileMaker if available
              if (window.FileMaker) {
                window.FileMaker.PerformScript("HandleAPIError", JSON.stringify({
                  code: errorCode,
                  message: errorMessage,
                  type: errorType
                }));
              }
            }
          }
        }
        
        // Handle normal completion (no function call)
        if (!realtimeEvent.response.output?.some(item => item.type === "function_call")) {
          if (!isPaused) {
            // Set timeout to show ear icon after 500ms
            setTimeout(() => {
              if (!isPaused) {
                showIcon('ear');
              }
            }, 500);
          }
        }

        // Only try to access output if it exists and has elements
        if (realtimeEvent.response.output && realtimeEvent.response.output.length > 0) {
          console.log("Model response:", realtimeEvent.response.output[0]);
          if (window.FileMaker && realtimeEvent.response.output[0].content?.[0]?.transcript) {
            window.FileMaker.PerformScript("LogMessage", JSON.stringify({
              role: "assistant",
              message: realtimeEvent.response.output[0].content[0].transcript
            }));
          }
        } else {
          console.log("Model response: No output available");
        }
      }

      if (realtimeEvent.type === "conversation.item.input_audio_transcription.completed") {
        // Check if we have a transcript in the expected location
        const transcript = realtimeEvent.item?.content?.transcript || realtimeEvent.transcript || '';
        if (transcript) {
          console.log("User message:", transcript);
          if (window.FileMaker) {
            window.FileMaker.PerformScript("LogMessage", JSON.stringify({
              role: "user",
              message: transcript
            }));
          }
        }
      }



      if (realtimeEvent.type === "error" || 
          realtimeEvent.type === "conversation.stopped") {
            showIcon('ear');
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
      if (sdpResponse.status === 429) {
        showErrorMessage("Rate limit error encountered. Please try again later.");
      }
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
