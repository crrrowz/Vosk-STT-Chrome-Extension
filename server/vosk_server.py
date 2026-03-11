"""
Local Vosk WebSocket Server for Chrome Extension STT.

Usage:
    python vosk_server.py [--port PORT] [--models PATH]

Models are loaded ON-DEMAND based on the language requested by the extension.
The server scans the models directory and maps language prefixes (ar, en, etc.)
to model directories. Models are cached after first load.

Default models path: ./models/
Default port: 8765
"""
import asyncio
import json
import logging
import os
import sys
import signal
from pathlib import Path

try:
    import websockets
except ImportError:
    print("❌ Missing dependency: pip install websockets")
    sys.exit(1)

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
except ImportError:
    print("❌ Missing dependency: pip install vosk")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("vosk-server")

# ─── Connection Limits ───

MAX_CONNECTIONS = 3
SESSION_TIMEOUT = 300  # 5 minutes max per session
_conn_semaphore = asyncio.Semaphore(MAX_CONNECTIONS)
_active_connections = 0

# ─── Model Management ───

_loaded_models = {}   # path -> Model (cache)
_model_map = {}       # lang_prefix -> path (e.g. "ar" -> "models/vosk-model-ar-...")

def scan_models(base_dir):
    """Scan models directory. Expected layout: models/<lang>/model-dir/
    Example: models/ar/vosk-model-ar-0.22-linto-1.1.0/
    """
    global _model_map
    base = Path(base_dir)
    if not base.exists():
        log.warning(f"Models directory not found: {base_dir}")
        return

    _model_map = {}
    for lang_dir in sorted(base.iterdir()):
        if not lang_dir.is_dir():
            continue
        # Each subfolder is a language key (e.g. "ar", "en", "fr")
        for model_dir in sorted(lang_dir.iterdir()):
            if model_dir.is_dir() and (model_dir / "am").exists():
                lang_key = lang_dir.name.lower()
                _model_map[lang_key] = str(model_dir)
                log.info(f"  [{lang_key}] → {lang_dir.name}/{model_dir.name}")
                break  # one model per language folder

    log.info(f"Available models: {list(_model_map.keys())}")

def _extract_lang(dirname):
    """Extract 2-letter language code from model directory name."""
    parts = dirname.replace("vosk-model-", "").split("-")
    skip = {"small", "big", "large", "medium", "cn", "spk"}
    for p in parts:
        if len(p) == 2 and p.isalpha() and p not in skip:
            return p
    return None

def resolve_model_path(lang_code):
    """Resolve a language code (e.g. 'ar-IQ', 'en-US', 'ar') to a model path."""
    if not _model_map:
        return None

    # Try exact match first (e.g. "ar-iq")
    lc = lang_code.lower().replace("_", "-")
    if lc in _model_map:
        return _model_map[lc]

    # Try 2-letter prefix (e.g. "ar" from "ar-IQ")
    prefix = lc.split("-")[0]
    if prefix in _model_map:
        return _model_map[prefix]

    # Try partial match in keys
    for key, path in _model_map.items():
        if prefix in key:
            return path

    return None

def get_model(model_path):
    """Load or return cached Vosk Model."""
    if model_path not in _loaded_models:
        log.info(f"⏳ Loading model: {model_path} ...")
        SetLogLevel(-1)
        _loaded_models[model_path] = Model(model_path)
        log.info(f"✅ Model loaded: {model_path}")
    return _loaded_models[model_path]

# ─── WebSocket Handler ───

async def handle_client(websocket):
    """Handle one WebSocket client connection with limits."""
    global _active_connections
    peer = websocket.remote_address

    # Check connection limit
    if not _conn_semaphore._value:
        log.warning(f"Connection rejected (limit {MAX_CONNECTIONS}): {peer}")
        await websocket.send(json.dumps({
            "type": "status", "status": "error",
            "msg": f"Server full ({MAX_CONNECTIONS} max connections)"
        }))
        await websocket.close()
        return

    async with _conn_semaphore:
        _active_connections += 1
        log.info(f"Client connected: {peer} (active: {_active_connections}/{MAX_CONNECTIONS})")
        recognizer = None

        try:
            # Session timeout
            async with asyncio.timeout(SESSION_TIMEOUT):
                async for message in websocket:
                    # ── Text message: control commands ──
                    if isinstance(message, str):
                        try:
                            cmd = json.loads(message)
                        except json.JSONDecodeError:
                            await websocket.send(json.dumps({"type": "status", "status": "error", "msg": "Invalid JSON"}))
                            continue

                        action = cmd.get("action", "")

                        if action == "configure":
                            lang = cmd.get("lang", cmd.get("model", ""))
                            sample_rate = cmd.get("sampleRate", 16000)

                            model_path = resolve_model_path(lang)

                            if not model_path:
                                available = list(_model_map.keys())
                                await websocket.send(json.dumps({
                                    "type": "status", "status": "error",
                                    "msg": f"No model for '{lang}'. Available: {available}"
                                }))
                                continue

                            try:
                                model = get_model(model_path)
                                recognizer = KaldiRecognizer(model, sample_rate)
                                recognizer.SetWords(True)
                                log.info(f"Recognizer ready: {lang} → {os.path.basename(model_path)} @ {sample_rate}Hz")
                                await websocket.send(json.dumps({
                                    "type": "status", "status": "ready",
                                    "msg": f"Model loaded: {os.path.basename(model_path)}"
                                }))
                            except Exception as e:
                                log.error(f"Model load error: {e}")
                                await websocket.send(json.dumps({
                                    "type": "status", "status": "error", "msg": str(e)
                                }))

                        elif action == "stop":
                            if recognizer:
                                final = json.loads(recognizer.FinalResult())
                                text = final.get("text", "").strip()
                                if text:
                                    await websocket.send(json.dumps({"type": "result", "text": text}))
                                recognizer = None
                            await websocket.send(json.dumps({"type": "status", "status": "stopped"}))

                        elif action == "ping":
                            await websocket.send(json.dumps({
                                "type": "status", "status": "pong",
                                "models": list(_model_map.keys()),
                                "connections": f"{_active_connections}/{MAX_CONNECTIONS}"
                            }))

                    # ── Binary message: audio data ──
                    elif isinstance(message, bytes):
                        if not recognizer:
                            continue
                        if recognizer.AcceptWaveform(message):
                            result = json.loads(recognizer.Result())
                            text = result.get("text", "").strip()
                            if text:
                                await websocket.send(json.dumps({"type": "result", "text": text}))
                        else:
                            partial = json.loads(recognizer.PartialResult())
                            text = partial.get("partial", "").strip()
                            if text:
                                # Backpressure: skip partials if send buffer is congested
                                try:
                                    await asyncio.wait_for(
                                        websocket.send(json.dumps({"type": "partial", "text": text})),
                                        timeout=0.5
                                    )
                                except asyncio.TimeoutError:
                                    pass  # Drop partial, keep processing

        except TimeoutError:
            log.warning(f"Session timeout ({SESSION_TIMEOUT}s): {peer}")
            try:
                await websocket.send(json.dumps({
                    "type": "status", "status": "error",
                    "msg": f"Session timeout ({SESSION_TIMEOUT}s)"
                }))
            except Exception:
                pass
        except websockets.ConnectionClosed:
            log.info(f"Client disconnected: {peer}")
        except Exception as e:
            log.error(f"Client error: {e}")
        finally:
            recognizer = None
            _active_connections -= 1
            log.info(f"Session ended: {peer} (active: {_active_connections}/{MAX_CONNECTIONS})")

# ─── Main ───

async def main(port, models_base):
    log.info(f"Scanning for models in: {models_base}")
    scan_models(models_base)

    if not _model_map:
        log.warning(f"⚠️  No models found in {models_base}")
        log.warning(f"   Download models from https://alphacephei.com/vosk/models")
        log.warning(f"   Extract to: {models_base}/<model-name>/")
    else:
        log.info(f"Models will be loaded on-demand when requested by the extension")

    stop = asyncio.get_event_loop().create_future()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_event_loop().add_signal_handler(sig, stop.set_result, None)
        except NotImplementedError:
            pass  # Windows

    async with websockets.serve(
        handle_client, "localhost", port,
        max_size=65536,          # 64KB max message size
        max_queue=16,            # Limit queued messages
        close_timeout=5,         # 5s close timeout
    ):
        log.info(f"✅ Vosk server listening on ws://localhost:{port}")
        log.info(f"   Max connections: {MAX_CONNECTIONS}")
        log.info(f"   Session timeout: {SESSION_TIMEOUT}s")
        log.info(f"   Press Ctrl+C to stop")
        try:
            await stop
        except asyncio.CancelledError:
            pass

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Vosk WebSocket STT Server")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default: 8765)")
    parser.add_argument("--models", type=str, default="./models",
                        help="Models directory (default: ./models)")
    parser.add_argument("--max-conn", type=int, default=3,
                        help="Max concurrent connections (default: 3)")
    args = parser.parse_args()

    MAX_CONNECTIONS = args.max_conn
    _conn_semaphore = asyncio.Semaphore(MAX_CONNECTIONS)

    try:
        asyncio.run(main(args.port, args.models))
    except KeyboardInterrupt:
        log.info("Server stopped.")
