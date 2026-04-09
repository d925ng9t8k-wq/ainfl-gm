#!/usr/bin/env python3
"""
voice-to-blackhole.py — Route ElevenLabs TTS to BlackHole 2ch virtual audio device.

Usage:
  python3 scripts/voice-to-blackhole.py "Text to speak"
  echo "Text to speak" | python3 scripts/voice-to-blackhole.py

This generates speech via ElevenLabs API, then plays it through BlackHole 2ch.
Grok (or any app) with its mic input set to BlackHole will hear 9's voice.
"""

import sys
import os
import io
import sounddevice as sd
import numpy as np

# Load .env
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
env_vars = {}
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env_vars[k.strip()] = v.strip()

API_KEY = env_vars.get('ELEVENLABS_API_KEY', os.environ.get('ELEVENLABS_API_KEY', ''))
VOICE_ID = env_vars.get('ELEVENLABS_VOICE_ID', os.environ.get('ELEVENLABS_VOICE_ID', ''))

if not API_KEY or not VOICE_ID:
    print("ERROR: ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID required in .env", file=sys.stderr)
    sys.exit(1)

# Find BlackHole device
devices = sd.query_devices()
blackhole_idx = None
for i, d in enumerate(devices):
    if 'BlackHole' in d['name'] and d['max_output_channels'] > 0:
        blackhole_idx = i
        break

if blackhole_idx is None:
    print("ERROR: BlackHole audio device not found", file=sys.stderr)
    sys.exit(1)

def speak(text):
    """Generate speech and route to BlackHole."""
    import urllib.request
    import json

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    data = json.dumps({
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.3,
        }
    }).encode()

    # Request PCM format for direct playback
    headers["Accept"] = "audio/mpeg"

    req = urllib.request.Request(url, data=data, headers=headers)
    print(f"Generating speech for: {text[:80]}...", file=sys.stderr)

    with urllib.request.urlopen(req) as resp:
        audio_bytes = resp.read()

    # Save to temp file and decode with ffmpeg to raw PCM
    import tempfile
    import subprocess

    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        # Decode to raw PCM float32 mono 44100Hz using ffmpeg
        result = subprocess.run([
            'ffmpeg', '-i', tmp_path,
            '-f', 'f32le', '-acodec', 'pcm_f32le',
            '-ac', '1', '-ar', '44100',
            '-v', 'quiet',
            'pipe:1'
        ], capture_output=True, timeout=30)

        audio = np.frombuffer(result.stdout, dtype=np.float32).reshape(-1, 1)
        sample_rate = 44100

        print(f"Playing through BlackHole (device {blackhole_idx}, {sample_rate}Hz, {len(audio)} samples)", file=sys.stderr)
        sd.play(audio, samplerate=sample_rate, device=blackhole_idx)
        sd.wait()
        print("Done.", file=sys.stderr)
    finally:
        os.unlink(tmp_path)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
    else:
        text = sys.stdin.read().strip()

    if not text:
        print("Usage: python3 voice-to-blackhole.py 'Text to speak'", file=sys.stderr)
        sys.exit(1)

    speak(text)
