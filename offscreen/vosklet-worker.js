// WASM Worker extracted from Vosklet.js for MV3 CSP compliance
onmessage = function (d) {
    onmessage = null;
    d = d.data;
    d["instantiateWasm"] = (i, r) => {
        var n = new WebAssembly.Instance(d["wasm"], i);
        return r(n, d["wasm"]);
    };
    importScripts(d.js);
    loadVosklet(d);
    d.wasm = d.mem = d.js = 0;
};
