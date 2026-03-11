// AudioWorklet processor: converts Float32 audio to Int16 PCM
// Runs on a dedicated audio thread — zero main thread blocking
class PCMProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0] || input[0].length === 0) return true;

        const float32 = input[0]; // mono channel
        const pcm16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            pcm16[i] = s < 0 ? s * 32768 : s * 32767;
        }
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
