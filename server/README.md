# Vosk Local STT Server

Local WebSocket server for offline speech-to-text using [Vosk](https://alphacephei.com/vosk/).

## Quick Start

```bash
cd server

# Install dependencies
pip install -r requirements.txt

# Download a model from https://alphacephei.com/vosk/models
# Extract into server/models/ directory:
mkdir models
# Example: extract vosk-model-small-ar-0.22.zip → models/vosk-model-small-ar-0.22/

# Start server
python vosk_server.py
```

## Options

```bash
python vosk_server.py --port 8765 --models ./models
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8765` | WebSocket port |
| `--models` | `./models` | Models directory |

## Extension Setup

1. Start the server: `python vosk_server.py`
2. Open extension popup → switch to **Local** mode
3. Click **Connect** (default: `ws://localhost:8765`)
4. Click mic and speak

## Protocol

| Direction | Type | Format |
|-----------|------|--------|
| → Server | Configure | `{"action": "configure", "lang": "ar-IQ", "sampleRate": 16000}` |
| → Server | Audio | Binary PCM 16-bit LE, 16kHz mono |
| → Server | Stop | `{"action": "stop"}` |
| → Server | Ping | `{"action": "ping"}` |
| ← Client | Partial | `{"type": "partial", "text": "..."}` |
| ← Client | Final | `{"type": "result", "text": "..."}` |
| ← Client | Status | `{"type": "status", "status": "ready\|error\|stopped"}` |

## Model Directory Structure

```
server/models/
├── ar/
│   └── vosk-model-ar-0.22-linto-1.1.0/
│       ├── am/
│       ├── conf/
│       └── ...
├── en/
│   └── vosk-model-small-en-us-0.15/
│       ├── am/
│       └── ...
└── fr/
    └── vosk-model-fr-0.22/
        ├── am/
        └── ...
```
