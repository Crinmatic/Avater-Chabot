# AI Avatar Assistant

An interactive AI assistant featuring your Ready Player Me avatar with multilingual support and text-to-speech capabilities.

## Features

- 🤖 **Ready Player Me Avatar**: Your personalized 3D avatar with animations
- 🗣️ **Multilingual AI**: Supports multiple languages with CPU-optimized inference
- 🎤 **Text-to-Speech**: Integrated with Kokoro TTS for natural speech
- 💬 **Real-time Chat**: Interactive web interface for conversations
- 🎭 **Avatar Animations**: Speaking animations and idle behaviors
- 🖥️ **CPU Optimized**: Designed for high-performance CPU inference (48 cores)

## Your Avatar

Your Ready Player Me avatar is loaded from:
```
https://models.readyplayer.me/68dfbe6efedc24530045d33f.glb
```

## Prerequisites

1. **Python** (3.8 or higher)
2. **Kokoro TTS Service** running on `localhost:8000`

To test your TTS service:
```bash
curl -X POST "http://localhost:8000/synthesize" \
     -H "Content-Type: application/json" \
     -d '{"text": "Hello world! This is a test of Kokoro TTS.", "voice": "af_bella"}' \
     --output test_speech.wav
```

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Run the setup script:
```bash
python setup.py
```

## Usage

1. Start the Python server:
```bash
python backend/server.py
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Start chatting with your AI avatar!

## Development

The server will automatically reload on code changes. For production deployment:
```bash
python backend/server.py
```

## System Requirements

- **CPU**: Multi-core processor (optimized for 48 cores)
- **RAM**: 8GB+ recommended for model loading
- **Network**: Internet connection for avatar loading and TTS service
- **Browser**: Modern browser with WebGL support

## Supported Languages

The AI model supports multiple languages including:
- English
- Spanish (Español)
- French (Français)
- German (Deutsch)
- Japanese (日本語)
- And many more...

## Architecture

```
├── frontend/           # Web interface with Three.js avatar
│   ├── index.html     # Main HTML page
│   └── app.js         # JavaScript application
├── backend/           # Python FastAPI server
│   └── server.py      # Main server with AI and TTS integration
├── setup.py           # Setup script
├── requirements.txt   # Python dependencies
├── audio/             # Generated speech files
└── models/            # AI model cache
```

## API Endpoints

- `GET /` - Main web interface
- `POST /api/chat` - Send message and receive AI response with audio
- `GET /api/health` - Server health check
- `GET /audio/:filename` - Serve generated audio files

## Performance Notes

- First startup may take 2-3 minutes while the AI model loads
- The system is optimized for CPU inference with your 48-core setup
- Audio files are cached in the `/audio` directory
- The AI model uses ONNX runtime for better CPU performance

## Troubleshooting

### Avatar not loading
- Check your internet connection
- Verify the Ready Player Me URL is accessible

### TTS not working
- Ensure Kokoro TTS service is running on localhost:8000
- Test the TTS service with the curl command above

### AI responses slow
- Allow time for initial model loading
- Model performance improves after warm-up

### Browser compatibility
- Use a modern browser (Chrome, Firefox, Safari, Edge)
- Ensure WebGL is enabled

## Customization

### Change Avatar
Replace the avatar URL in `frontend/app.js`:
```javascript
const avatarUrl = 'https://models.readyplayer.me/YOUR_AVATAR_ID.glb';
```

### Modify AI Behavior
Edit the system prompt in `backend/server.js`:
```javascript
const prompt = `<|system|>Your custom system prompt here<|end|>`;
```

### Adjust TTS Voice
Change the voice parameter in `backend/server.js`:
```javascript
voice: 'your_preferred_voice'
```

## License

MIT License - Feel free to customize and extend!

## Support

For issues or questions, check the console logs in both the browser and server terminal for debugging information.# Avater-Chabot
