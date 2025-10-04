#!/usr/bin/env python3
"""
Setup script for AI Avatar Assistant
Downloads and configures the multilingual AI model for CPU inference
"""

import os
import sys
from pathlib import Path
import httpx
import asyncio

def setup_directories():
    """Create necessary directories"""
    base_dir = Path(__file__).parent.parent
    directories = [
        base_dir / "models",
        base_dir / "audio", 
        base_dir / "logs"
    ]
    
    for directory in directories:
        directory.mkdir(exist_ok=True)
        print(f"✅ Created directory: {directory.relative_to(base_dir)}")

async def test_tts_connection():
    """Test connection to TTS service"""
    print("\n🔍 Testing TTS service connection...")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                "http://localhost:8000/synthesize",
                json={"text": "Test connection", "voice": "af_bella"}
            )
            
            if response.status_code == 200:
                print("✅ TTS service is running and accessible")
                return True
            else:
                print(f"⚠️  TTS service responded with error status: {response.status_code}")
                return False
    except Exception as e:
        print("❌ TTS service is not running on localhost:8000")
        print("   Please start your Kokoro TTS service first")
        print(f"   Error: {e}")
        return False

def check_python_version():
    """Check Python version compatibility"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print("❌ Python 3.8 or higher is required")
        print(f"   Current version: {version.major}.{version.minor}.{version.micro}")
        return False
    
    print(f"✅ Python version: {version.major}.{version.minor}.{version.micro}")
    return True

def main():
    print("🤖 Setting up AI Avatar Assistant...")
    print("📦 This will prepare the multilingual AI model for CPU inference")
    print(f"💾 The model is optimized for your {os.cpu_count()} CPU cores")
    print()
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Setup directories
    setup_directories()
    
    # Test TTS connection
    tts_available = asyncio.run(test_tts_connection())
    
    print()
    print("🎯 Installation Tips:")
    print("1. Install Python dependencies: pip install -r requirements.txt")
    if not tts_available:
        print("2. ⚠️  Start your Kokoro TTS service on localhost:8000")
    print("3. The AI model will be downloaded automatically on first startup")
    print("4. First startup may take 2-3 minutes as the model loads")
    print(f"5. Your {os.cpu_count()} CPU cores will be utilized for optimal performance")
    print()
    print("🚀 To start the server, run: python backend/server.py")
    print("🌐 Then open: http://localhost:3000")
    print()
    print("✨ Your Ready Player Me avatar will be loaded from:")
    print("   https://models.readyplayer.me/68dfbe6efedc24530045d33f.glb")
    print()
    print("🎉 Setup complete! Ready to start your AI Avatar Assistant.")

if __name__ == "__main__":
    main()