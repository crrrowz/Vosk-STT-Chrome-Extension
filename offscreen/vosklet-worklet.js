// AudioWorklet processor extracted from Vosklet.js for MV3 CSP compliance
registerProcessor("VoskletTransferer", class extends AudioWorkletProcessor {
    constructor(e) {
        super();
        this.pa = 0;
        this.xa = e.processorOptions[0];
        this.ua = new Float32Array(this.xa);
    }
    process(e) {
        e[0][0] && (
            this.ua.set(e[0][0], this.pa),
            this.pa += 128,
            this.pa >= this.xa && (
                this.pa = 0,
                this.port.postMessage(this.ua, [this.ua.buffer]),
                this.ua = new Float32Array(this.xa)
            )
        );
        return true;
    }
});
