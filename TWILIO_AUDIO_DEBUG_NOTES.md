# Twilio Audio Integration Debug Notes

## Working Solution

- **ElevenLabs TTS** with PCM format works perfectly
- **Audio Pipeline**: ElevenLabs PCM (16kHz) → μ-law conversion → base64 → Twilio WebSocket
- **Voice**: Rachel (21m00Tcm4TlvDq8ikWAM) - clear female voice
- **Configuration**: `outputFormat: "pcm_16000"` in ElevenLabs config

## Inworld TTS Issues (TO INVESTIGATE LATER)

### Problem Summary

Inworld TTS produces garbled audio when used with Twilio, despite requesting MULAW format.

### What We Tried

1. **MULAW Direct Request**: Set `audioEncoding: "MULAW", sampleRateHertz: 8000` in Inworld API
2. **WAV Container Issue**: Discovered Inworld returns WAV files even when requesting MULAW
   - Audio header shows: `52 49 46 46` = "RIFF" (WAV file signature)
   - Created `extractMulawFromWav()` function to parse WAV container
3. **LINEAR16 with Conversion**: Tried requesting LINEAR16 at 8kHz and converting to μ-law
4. **Downsampling**: Attempted 16kHz→8kHz downsampling with μ-law conversion

### Key Findings

- Inworld **always returns WAV files** regardless of audioEncoding parameter
- WAV parsing approach didn't resolve the garbled audio
- Twilio requires **raw μ-law data** at 8kHz, not WAV containers
- The WAV files contain μ-law data but in unexpected format/structure

### Code Locations for Future Investigation

- `src/services/tts/inworld-tts.ts` - Contains WAV parsing logic
- `extractMulawFromWav()` function - WAV container parsing
- Inworld API call in `sendText()` method

### Next Steps to Try (When Revisiting)

1. **Analyze WAV Structure**: Examine the actual WAV file structure from Inworld

   - Check fmt chunk for audio format details
   - Verify μ-law encoding parameters in WAV header
   - Compare with known working μ-law WAV files

2. **Raw Binary Analysis**:

   - Log raw audio bytes before/after WAV parsing
   - Compare μ-law values with ElevenLabs converted output
   - Check for endianness issues

3. **Alternative Inworld Formats**:

   - Try `LINEAR16` at 8kHz and use proven conversion pipeline
   - Test `ALAW` format as alternative to MULAW
   - Investigate if Inworld has raw audio endpoints

4. **Twilio Compatibility Testing**:
   - Test extracted μ-law data with external tools
   - Verify G.711 μ-law compliance
   - Check for missing/extra header bytes

### Audio Format Reference

- **Twilio Expects**: Raw G.711 μ-law, 8kHz, 8-bit, base64 encoded
- **ElevenLabs Working**: PCM 16kHz → custom μ-law conversion → base64
- **Inworld Returns**: WAV container with μ-law data (format unclear)

### Timing Issues (RESOLVED)

- **Problem**: Greeting sent before WebSocket connection established
- **Solution**: Move greeting to `onConnect()` handler after connection ready
- **Key**: Ensure both `currentStreamSid` and `twilioConnection` are available

## Files Modified

- `src/agent/twilio-voice-agent.ts` - TTS callback and greeting timing
- `src/services/tts/inworld-tts.ts` - WAV parsing and audio extraction
- `src/agent/voice-agent.ts` - TTS service selection (ElevenLabs vs Inworld)

## Testing Commands

- `npm run deploy` - Deploy changes
- `npx wrangler tail --format=pretty` - Monitor real-time logs
- Call Twilio number: +12067371083

---

_Notes created: 2025-08-31_
_Working solution: ElevenLabs with PCM→μ-law conversion_
_Investigation needed: Inworld WAV format compatibility_
