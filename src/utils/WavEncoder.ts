// Encodes a Float32 mono PCM signal to a 16-bit PCM WAV byte buffer.
// Matches the format pyannote/torchaudio happily reads.

export function encodeWavMono16(
    samples: Float32Array,
    sampleRate: number,
): Uint8Array {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample; // mono
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");

    // fmt chunk
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample

    // data chunk
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        let s = samples[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
    }

    return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
