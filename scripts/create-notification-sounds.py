"""Original soft notification tones; deterministic PCM, no external samples."""
import math
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'src/assets/sounds'
root.mkdir(parents=True, exist_ok=True)
rate = 44100
for name, notes, duration in [
    ('complete', [(0, 523.251), (.19, 783.991)], 1.05),
    ('attention', [(0, 440.0), (.18, 523.251), (.36, 659.255)], 1.22),
]:
    samples = []
    for frame in range(round(duration * rate)):
        t = frame / rate
        value = 0.0
        for onset, frequency in notes:
            age = t - onset
            if age < 0:
                continue
            attack = min(1.0, age / .028)
            envelope = math.sin(attack * math.pi / 2) ** 2 * math.exp(-age * 6.8)
            tone = math.sin(2 * math.pi * frequency * age)
            tone += .12 * math.exp(-age * 7) * math.sin(2 * math.pi * frequency * 2.002 * age)
            tone += .045 * math.exp(-age * 12) * math.sin(2 * math.pi * frequency * 3 * age)
            value += envelope * tone
        value *= min(1, max(0, (duration - t) / .12)) ** 2
        samples.append(value)
    peak = max(abs(value) for value in samples)
    pcm = b''.join(struct.pack('<h', round(value / peak * .27 * 32767)) for value in samples)
    with wave.open(str(root / f'{name}.wav'), 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate); output.writeframes(pcm)
    print(f'{name}: {duration}s, peak -11.4 dBFS before volume control')
