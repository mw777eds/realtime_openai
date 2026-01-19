# Bug 04 - Mute shows as active but microphone still drives responses

## Symptoms
- Clicking the Realtime widget toggles to “sleep” (moon/stars), indicating muted.
- Despite the UI state, the assistant continues to react to user speech (server VAD still receiving audio).

## Hypothesis
- We only disabled the local MediaStreamTrack (audioTrack.enabled = false) but left the RTCRtpSender attached.
- Some browsers/drivers may continue sending silence/noise frames that still trigger server VAD, or the sender retains prior track.

## Fix Attempt (landed)
- Detach mic from the peer connection when muting:
  - On mute: audioSender.replaceTrack(null); then stop() the local audioTrack and disable it.
  - On unmute: reacquire getUserMedia({audio:true}) and reattach via replaceTrack(newTrack) (or addTrack if needed).
- Also stop and null audioTrack on cleanupWebRTC() to avoid dangling captures.

## Validation Steps
1) Open the app, connect Realtime, speak → assistant responds.
2) Click the widget to mute (sleep icon).
3) Speak again.
   - Expected: No new responses; no input transcription events arrive.
4) Unmute; speak again.
   - Expected: Assistant resumes listening/responding.

## Status
- Fixed and verified on macOS FileMaker Web Viewer.
- Resolution: Detach RTCRtpSender on mute via audioSender.replaceTrack(null), stop/disable local mic track, and reacquire/reattach on unmute; also release mic on cleanupWebRTC.
- Commit: 71be0ef — fix: detach audio sender on mute and restore on unmute.
- Result: Server VAD no longer triggers while muted; waveform stops; unmute restores mic and listening as expected.
