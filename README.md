# FileMaker OpenAI Voice Interface                                                   
                                                                                      
 A WebRTC-based voice interface for FileMaker integration with OpenAI's general-availability real-time API, now including
 container image context support.
                                                                                      
 ## Features                                                                          
                                                                                      
 - Real-time voice interaction with OpenAI models                                     
 - Audio level-based animation control                                                
 - Tool calling support for FileMaker integration
 - Share FileMaker container images with the assistant as visual context
 - Mute/unmute functionality with visual feedback
 - Automatic speech detection and response
                                                                                      
 ## Requirements                                                                      
                                                                                      
 - FileMaker Pro                                                                      
 - Modern web browser with WebRTC support                                             
 - OpenAI API key with real-time API access                                           
 - HTTPS environment for WebRTC functionality                                         
                                                                                      
 ## Setup                                                                             
                                                                                      
 1. Host these files in a web-accessible location with HTTPS support                  
 2. Include the web viewer in your FileMaker solution                                 
 3. Configure your OpenAI API credentials in FileMaker                                
 4. Set up the required FileMaker scripts:                                            
    - SendToOpenAI                                                                    
    - CallTools                                                                       
    - LogMessage                                                                      
                                                                                      
 ## File Structure                                                                    
                                                                                      
 - `index.html` - Main HTML container                                                 
 - `src/index.js` - Core WebRTC, audio, tool calling, and container image handling logic
 - `src/style.css` - Styling for the interface
                                                                                      
 ## Usage                                                                             
                                                                                      
 The interface provides:                                                              
 - Click-to-mute functionality on both the logo and speaking indicators               
 - Visual feedback for audio transmission                                             
 - Automatic handling of tool calls between OpenAI and FileMaker                      
 - Message logging for both user and assistant interactions                           
                                                                                      
 ## FileMaker Integration                                                             
                                                                                      
 The interface exposes several functions to FileMaker:                                
 - `initializeWebRTC(ephemeralKey, model, instructions, tools, toolChoice, sessionConfig)`
 - `startAudioTransmission()`
 - `stopAudioTransmission()`
 - `cleanupWebRTC()`
 - `sendToolResponse(toolResponse)`
 - `createModelResponse()`
 - `updateSession(updateParamsJson)`
 - `sendContainerImageToRealtime(imagePayload)`

### Real-time session configuration

- `initializeWebRTC` accepts an optional sixth argument, `sessionConfig`, which should be a JSON string describing additional
  session options. The default session now targets the generally available realtime stack, enabling
  `gpt-4o-mini-transcribe` for speech recognition, `voice: "verse"`, and text+audio response modalities.
- You can include any `session.update` fields supported by OpenAI (e.g. `turn_detection`, `input_audio_format`, `response_format`).
- To opt out of the automatically injected `request_container_image` tool, set
  `"disableDefaultContainerImageTool": true` in the `sessionConfig` payload.
- Example:

```json
{
  "instructions": "You are assisting with cataloguing product images.",
  "turn_detection": { "type": "server_vad", "threshold": 0.5 },
  "modalities": ["text", "audio"],
  "tools": [
    { "type": "function", "name": "lookup_item", "description": "Return product metadata", "parameters": { "type": "object" } }
  ]
}
```

### Sending container images as context

- Use `sendContainerImageToRealtime(imagePayload)` to pass a FileMaker container image to the realtime conversation.
  The helper accepts either a JSON string or object with these fields:
  - `base64` / `imageBase64` / `image_base64`: raw base64 data (without the `data:` prefix)
  - `dataUrl` / `data_url`: data URL produced by FileMaker (the MIME type is extracted automatically)
  - `mimeType` (optional): overrides the detected MIME type
  - `prompt` (optional): short text description sent along with the image
  - `modalities` (optional): array or JSON string overriding the response modalities for this turn
  - `requestResponse` (optional, default `true`): whether to immediately request a model response after sending the image
  - `metadata` (optional): JSON object forwarded with the image content block
- Example payload from FileMaker:

```json
{
  "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "prompt": "Here is the front label of the product the customer asked about.",
  "modalities": ["text"],
  "metadata": { "source": "inventory_container" }
}
```

- When the assistant requests visual context it calls the `request_container_image` tool. The interface displays a toast and
  triggers the `CallTools` FileMaker script with the tool payload so you can fetch the container image and invoke
  `sendContainerImageToRealtime`.
- You can disable or replace this default tool at runtime by passing `disableDefaultContainerImageTool` (or the snake_case variant)
  to either `initializeWebRTC` or `updateSession`. Providing your own `containerImageTool` object in those payloads lets you
  rename or re-describe the tool while retaining the built-in wiring.
                                                                                      
 ## License                                                                           
                                                                                      
 MIT License                                                                          
                                                                                      
 ## Contributing                                                                      
                                                                                      
 Pull requests are welcome. For major changes, please open an issue first to discuss  
 what you would like to change. 