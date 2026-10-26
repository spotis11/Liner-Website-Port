"""Generate a bass-heavy test WAV (60 Hz sine + quiet 1 kHz marker tone).

Used to verify the web equalizer's Bass Boost actually changes the audible
spectrum: an AnalyserNode tapped at the effects graph output should show the
60 Hz bin rise when bass boost goes 0 -> 100%.
"""
import math
import struct
import wave

SR = 44100
DUR = 10.0

frames = []
for n in range(int(SR * DUR)):
    t = n / SR
    # 0.6 amplitude 60 Hz bass + 0.15 amplitude 1 kHz marker (keeps it audible)
    sample = 0.6 * math.sin(2 * math.pi * 60.0 * t) + 0.15 * math.sin(
        2 * math.pi * 1000.0 * t
    )
    # 10ms fade in/out to avoid clicks
    fade = min(1.0, t / 0.01, (DUR - t) / 0.01)
    frames.append(struct.pack("<h", int(max(-1.0, min(1.0, sample * fade)) * 32000)))

with wave.open("/home/z/my-project/scripts/bass_test.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b"".join(frames))

print("wrote /home/z/my-project/scripts/bass_test.wav")
