# Voice connection investigation

The September 14 investigation found two partial production attempts with the last saved user transcript near 31 seconds and the session marked ended near 79 seconds. Those timestamps do not identify whether audio transport or transcript delivery failed. The original failure was outside the available function-log history.

## Reproduction

The original deployed frontend completed separate 100-second real OpenAI WebRTC attempts in Chromium and Firefox with an audio fixture containing a roughly 31-second answer followed by silence. Both received user transcript events beyond 31 seconds. That initial fixture did not reproduce the outage.

A controlled Chromium test then closed the Convex WebSocket with code 1011 and reason `InternalServerError` at 30 seconds. The exact reported reconnect message appeared, but WebRTC remained connected and user transcript events continued to 98.6 seconds. A Convex reconnect alone therefore did not reproduce the audio failure in that test.

Sustained speech repeatedly reproduced a matching failure in Firefox 155: transcript events and inbound RTP stopped near 30 seconds, ICE subsequently failed, and the app ended the attempt near 75–80 seconds. Two runs had no injected Convex disconnect. One used a 165-second audio buffer to rule out a short fixture looping at the cutoff. STUN alone did not prevent the failure. Firefox reported selecting a direct TCP candidate pair.

Removing the competing TCP candidates from the provider's answer made Firefox select UDP. The otherwise comparable sustained-speech test then remained connected for 100 seconds, receiving transcript events through 98.4 seconds. However, the rebuilt frontend subsequently failed on UDP with the same 30-second transcript cutoff. UDP-only filtering is therefore not a reliable fix and was removed from application code.

Further controlled tests failed with and without STUN, with an explicit end-of-candidates signal, with `max-bundle`, and with the local server's separate OpenAI listener attached. That listener received `session.closed` with reason `connection_lost`. Firefox native transport logs showed five successful consent refreshes followed by repeated timeouts and `Consent refresh failed`. The failure is in the voice connection; the available evidence does not isolate which peer or network component first stops delivering packets.

Mozilla tracks a closely matching [OpenAI voice disconnect](https://bugzilla.mozilla.org/show_bug.cgi?id=2054513). Its underlying [ICE-lite nomination fix](https://bugzilla.mozilla.org/show_bug.cgi?id=1034964) is marked fixed in Firefox 156. The maintainer explains that Firefox needs regular nomination with ICE-lite peers; our provider's answer advertises `a=ice-lite`. This is strong evidence of the same compatibility issue, not proof from our own capture of the original user's failed call. Mozilla reports the related voice bug working in Nightly. [Firefox 156 is scheduled for September 15, 2026](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/156); we have not independently tested that version.

The practical immediate workaround is Chrome. Chromium also passed a 120-second sustained-speech run against the rebuilt frontend while its Convex socket was interrupted. The app now warns Firefox versions below 156 before practice begins. This is an advisory, not a hard browser block.

A final diagnostic retaining only one UDP candidate per media section, combined with `max-bundle`, survived 100 seconds in Firefox 155. This is consistent with competing candidate paths contributing to the failure, but it is only one run and removes network fallback options. It remains a diagnostic flag rather than production behavior.

The original live smoke test stopped each attempt at 55 seconds. Use the longer diagnostic harness for this regression:

```sh
node scripts/reproduce-voice.mjs \
  --url=https://YOUR-APP.convex.site \
  --audio=/absolute/path/to/synthetic.wav \
  --seconds=100 \
  --output=/tmp/voice-reproduction.json
```

This creates a synthetic test account and runs two paid voice attempts, one in each browser, including the app's normal review flow. Install Playwright Chromium and Firefox first. Headless Linux Firefox needs a working audio output; a PulseAudio null sink works. Supply synthetic WAV audio, preferably continuous speech extending past the suspected cutoff. The script injects the audio into real browser media tracks and uses real WebRTC and backend connections. It does not mock voice events.

Options:

- `--stun` injects the proposed Cloudflare STUN configuration into the browser without deploying it.
- `--disconnect-convex-at=30` deliberately closes the test browser's Convex WebSocket once, 30 seconds after voice connects. It does not stop the Convex server or disconnect other users.
- `--browser=firefox` runs only Firefox voice (Chromium still creates the test passkey login). `chromium` and `both` are also supported.
- `--udp-only` experimentally removes competing TCP answer candidates, independently of the app code.
- `--end-candidates` sends an explicit end-of-candidates marker.
- `--max-bundle` gathers one bundled transport.
- `--single-candidate` retains just the first UDP candidate per media section, as a diagnostic of competing paths. It removes fallback paths and is not an application fix.
- `--frontend-bundle=/absolute/path/to/dist/assets/index-HASH.js` serves a rebuilt frontend to this test browser while exercising the hosted backend.

Output includes connection states, packet counts, candidate types/protocol, transcript timestamps, and selected lifecycle events. It excludes credentials, SDP, IP addresses, audio, and transcript text. A surviving call must still be connected at the requested duration; an early end makes the command fail.

## Implemented changes

- Configure STUN, retaining gathered direct candidates if STUN gathering times out.
- Warn Firefox versions below 156 about the mid-answer disconnect and suggest Chrome or updating when available.
- Warn on a temporary ICE disconnect, allow recovery for up to 15 seconds, and keep the original session clock after recovery.
- Ignore transport changes during intentional shutdown; skip the dead-channel close wait on connection loss.
- Start saving received transcript fragments alongside provider cleanup, retaining failed writes for retry.
- Preserve `connection_lost` when hosted cleanup already marked a row `close_requested`.
- Log connection-state timestamps and provider cleanup failures without including speech or credentials.

These changes add browser guidance, STUN configuration, and improved failure handling. They do not prove that affected Firefox versions will maintain a voice connection. They do not implement TURN relay, renegotiation of an existing OpenAI session, or local audio recording. Speech that never reaches transcription cannot be recovered by retrying transcript saves.

## Verification

Regression tests first demonstrated the missing disconnect warning, close-message send over a failed transport, and lost close reason. The repaired paths pass alongside the existing practice, retry, saving-failure, and hard-limit tests. Backend changes were pushed successfully to the development deployment for validation. The approved production release was subsequently published on September 14, 2026.

Final release validation: the production site had advanced to resume release `c8c6550` while the investigation workspace remained on `608c8e2`. The voice patch was applied cleanly to `c8c6550` in `/tmp/rehearsal-voice-release`, preserving resume support. All 17 unit tests, 18 backend tests, and 16 browser tests passed (51 total), together with the production build. The approved backend and static frontend were deployed to production on September 14, 2026. Hosted HTML and JavaScript matched the release build; authenticated checks confirmed the resume control and the affected-Firefox notice.

Post-deployment Chromium validation: the real hosted voice call remained connected for 120 seconds, with user transcript events through 119.8 seconds, despite an injected Convex socket close at 30 seconds. It ended normally on request.
