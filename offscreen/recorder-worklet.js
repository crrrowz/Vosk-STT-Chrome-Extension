// AudioWorklet processor to capture microphone audio and send it to the main thread in chunks
class VoskRecorderWorklet extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.framesRecorded = 0;
        this.port.postMessage({ type: 'log', message: '[Vosk Worklet] Initialized' });
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channelData = input[0];

            // Append incoming 128-sample chunk to our buffer
            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.framesRecorded++] = channelData[i];

                // When buffer is full, send a clone to the main thread
                if (this.framesRecorded >= this.bufferSize) {
                    const chunk = new Float32Array(this.buffer);
                    this.port.postMessage({ type: 'audio', data: chunk });
                    this.framesRecorded = 0;
                }
            }
        }
        return true;
    }
}

registerProcessor('vosk-recorder-worklet', VoskRecorderWorklet);
