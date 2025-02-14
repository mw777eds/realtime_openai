# FileMaker OpenAI Voice Interface                                                   
                                                                                      
 A WebRTC-based voice interface for FileMaker integration with OpenAI's real-time API 
                                                                                      
 ## Features                                                                          
                                                                                      
 - Real-time voice interaction with OpenAI models                                     
 - Audio level-based animation control                                                
 - Tool calling support for FileMaker integration                                     
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
 - `src/index.js` - Core WebRTC and interaction logic                                 
 - `src/style.css` - Styling for the interface                                        
 - `src/imageLoader_*.js` - Image loading utilities                                   
                                                                                      
 ## Usage                                                                             
                                                                                      
 The interface provides:                                                              
 - Click-to-mute functionality on both the logo and speaking indicators               
 - Visual feedback for audio transmission                                             
 - Automatic handling of tool calls between OpenAI and FileMaker                      
 - Message logging for both user and assistant interactions                           
                                                                                      
 ## FileMaker Integration                                                             
                                                                                      
 The interface exposes several functions to FileMaker:                                
 - `initializeWebRTC(ephemeralKey, model, instructions, tools, toolChoice)`           
 - `startAudioTransmission()`                                                         
 - `stopAudioTransmission()`                                                          
 - `cleanupWebRTC()`                                                                  
 - `sendToolResponse(toolResponse)`                                                   
 - `createModelResponse()`                                                            
                                                                                      
 ## License                                                                           
                                                                                      
 MIT License                                                                          
                                                                                      
 ## Contributing                                                                      
                                                                                      
 Pull requests are welcome. For major changes, please open an issue first to discuss  
 what you would like to change. 