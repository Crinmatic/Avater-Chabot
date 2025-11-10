#!/usr/bin/env python3
"""
AI Avatar Assistant Backend
A Python FastAPI backend for serving AI responses with TTS integration
Optimized for CPU inference with multilingual support
"""

import asyncio
import os
import time
import uuid
import logging
from pathlib import Path
from typing import Optional, Dict, Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from typing import Dict
import uuid

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Request/Response models
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    audioUrl: Optional[str] = None
    session_id: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    tts_available: bool
    cpu_cores: int

class AIAssistantServer:
    def __init__(self):
        self.app = FastAPI(title="AI Avatar Assistant", version="1.0.0")
        # In-memory session storage: session_id -> list of messages
        self.sessions: Dict[str, list] = {}
        
        # Configuration
        self.tts_url = "http://localhost:8000/synthesize"
        self.port = int(os.getenv("PORT", 3000))
        self.groq_api_key = "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"
        self.groq_api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.model_name = "llama-3.1-8b-instant"  # Fast, lightweight, intelligent
        
        # Paths - Initialize BEFORE setup_routes
        self.base_dir = Path(__file__).parent.parent
        self.audio_dir = self.base_dir / "audio"
        
        # Create directories
        self.audio_dir.mkdir(exist_ok=True)
        
        # Model status
        self.model_loaded = True  # Groq API is always available
        
        # Setup middleware and routes AFTER attributes are initialized
        self.setup_middleware()
        self.setup_routes()

    def setup_middleware(self):
        """Setup CORS and other middleware"""
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def setup_routes(self):
        """Setup API routes"""
        
        @self.app.get("/api/health", response_model=HealthResponse)
        async def health_check():
            return HealthResponse(
                status="ok",
                model_loaded=self.model_loaded,
                tts_available=await self.check_tts_service(),
                cpu_cores=os.cpu_count() or 1
            )

        @self.app.post("/api/chat", response_model=ChatResponse)
        async def chat_endpoint(request: ChatRequest):
            try:
                # Manage session
                session_id = request.session_id or str(uuid.uuid4())
                if session_id not in self.sessions:
                    self.sessions[session_id] = []
                history = self.sessions[session_id]
                logger.info(f"Session {session_id}: Received message: {request.message}")
                
                # Generate AI response
                ai_response = await self.generate_response(request.message, history)
                logger.info(f"Generated response: {ai_response[:100]}...")
                
                # Convert to speech
                audio_url = await self.text_to_speech(ai_response)
                if audio_url:
                    logger.info(f"Audio generated: {audio_url}")
                
                # Store conversation memory (cap last 3 pairs)
                history.append(request.message)
                history.append(ai_response)
                if len(history) > 6:
                    history[:] = history[-6:]
                return ChatResponse(
                    response=ai_response,
                    audioUrl=audio_url,
                    session_id=session_id
                )
                
            except Exception as e:
                logger.error(f"Error in chat endpoint: {e}")
                raise HTTPException(status_code=500, detail="Internal server error")
        
        @self.app.get("/app.js")
        async def serve_js():
            return FileResponse(self.base_dir / "frontend" / "app.js", media_type="application/javascript")
        
        @self.app.get("/lipsync-en.js")
        async def serve_lipsync():
            return FileResponse(self.base_dir / "frontend" / "lipsync-en.js", media_type="application/javascript")
        
        @self.app.get("/test")
        async def serve_test():
            return FileResponse(self.base_dir / "frontend" / "test_lipsync.html")

        @self.app.get("/")
        async def serve_index():
            return FileResponse(self.base_dir / "frontend" / "index.html")

        # Mount audio directory
        self.app.mount("/audio", StaticFiles(directory=str(self.audio_dir)), name="audio")

    async def generate_response(self, user_message: str, history: list) -> str:
        """Generate AI response using Groq API"""
        try:
            # Build messages for Groq API
            messages = [
                {"role": "system", "content": """You are AvaterConnect, an empathetic emotional support companion created by leeLab. Your purpose is to provide compassionate, non-judgmental support to people experiencing difficult emotions.

Core principles:
- Listen with empathy and validate feelings without minimizing them
- Ask gentle, open-ended questions to help people explore their emotions
- Offer comfort and reassurance when appropriate
- Respect boundaries - never force advice or solutions
- Be warm, caring, and authentic in your responses
- Use simple, conversational language
- Keep responses brief (2-3 sentences) to encourage dialogue
- Recognize when someone may need professional help and gently suggest it

Remember: You're here to support, not to fix. Sometimes people just need to be heard and understood."""}
            ]
            
            # Add conversation history as alternating user/assistant messages
            for i in range(0, len(history), 2):
                if i < len(history):
                    messages.append({"role": "user", "content": history[i]})
                if i + 1 < len(history):
                    messages.append({"role": "assistant", "content": history[i + 1]})
            
            # Add current message
            messages.append({"role": "user", "content": user_message})
            
            # Call Groq API
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.groq_api_url,
                    headers={
                        "Authorization": f"Bearer {self.groq_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model_name,
                        "messages": messages,
                        "temperature": 0.8,
                        "max_tokens": 150,
                        "top_p": 0.92,
                        "stream": False
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"Groq API error: {response.status_code} - {response.text}")
                    return self.get_fallback_response(user_message)
                
                result = response.json()
                ai_response = result["choices"][0]["message"]["content"].strip()
                
                # Fallback if response is empty
                if not ai_response or len(ai_response) < 5:
                    return self.get_fallback_response(user_message)
                
                return ai_response

        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return self.get_fallback_response(user_message)

    def get_fallback_response(self, user_message: str) -> str:
        """Provide empathetic rule-based fallback responses"""
        message_lower = user_message.lower()
        
        # Emotional support fallbacks
        fallbacks = {
            # Greetings - warm and welcoming
            'hello': "Hello! I'm AvaterConnect from leeLab. I'm here to listen and support you. How are you feeling today?",
            'hi': "Hi there! I'm glad you're here. What's on your mind?",
            'hey': "Hey! I'm here for you. Would you like to talk about something?",
            
            # Emotional states - validation and empathy
            'sad': "I hear that you're feeling sad. That must be really difficult. Would you like to share what's weighing on you?",
            'depressed': "I'm so sorry you're going through this. Depression can feel so heavy. You're not alone in this.",
            'anxious': "Anxiety can be so overwhelming. I'm here to listen without judgment. What's making you feel anxious?",
            'stressed': "Stress can really take a toll. Take a deep breath with me. What's been stressing you out?",
            'lonely': "Feeling lonely is so hard. I'm here with you right now. Would you like to talk about it?",
            'angry': "It's okay to feel angry. Your feelings are valid. What's been bothering you?",
            'tired': "It sounds like you're exhausted. That's completely understandable. How can I support you right now?",
            'overwhelmed': "Being overwhelmed is exhausting. Let's take this one step at a time together. What feels most pressing?",
            
            # Common situations
            'help': "I'm here to help and support you emotionally. You can share anything that's on your mind - I'm listening.",
            'talk': "Of course, I'm here to talk. What would you like to share with me?",
            'listen': "I'm here, and I'm listening. Take your time and share whatever you're comfortable with.",
            'how are you': "Thank you for asking! I'm here and ready to support you. But more importantly - how are *you* doing?",
            
            # Crisis indicators - gentle professional referral
            'suicide': "I'm really concerned about you. Please reach out to a crisis helpline immediately: 988 (US) or your local emergency services. You deserve support from professionals who can help.",
            'hurt myself': "I care about your safety. Please contact a crisis helpline now: 988 (US) or emergency services. You don't have to face this alone.",
            'end it': "Please reach out for help right now: call 988 or your local crisis line. You matter, and there are people who want to help you through this."
        }
        
        # Check for keyword matches
        for key, response in fallbacks.items():
            if key in message_lower:
                return response
        
        # Default empathetic response
        return "I'm here to listen and support you. Whatever you're going through, you don't have to face it alone. Would you like to share what's on your mind?"

    async def check_tts_service(self) -> bool:
        """Check if TTS service is available"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    self.tts_url,
                    json={"text": "test", "voice": "af_bella"}
                )
                return response.status_code == 200
        except:
            return False

    async def text_to_speech(self, text: str) -> Optional[str]:
        """Convert text to speech using Kokoro TTS"""
        try:
            logger.info(f"Converting text to speech: {text[:50]}...")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.tts_url,
                    json={"text": text, "voice": "af_bella"}
                )
                
                if response.status_code != 200:
                    logger.error(f"TTS service error: {response.status_code}")
                    return None
                
                # Generate unique filename
                timestamp = int(time.time() * 1000)
                audio_filename = f"speech_{timestamp}.wav"
                audio_path = self.audio_dir / audio_filename
                
                # Save audio file
                with open(audio_path, "wb") as f:
                    f.write(response.content)
                
                logger.info(f"Audio saved: {audio_filename}")
                return f"/audio/{audio_filename}"
                
        except Exception as e:
            logger.error(f"Error in text-to-speech: {e}")
            return None

    def run(self):
        """Start the server"""
        logger.info(f"🤖 AI Avatar Assistant Server starting on port {self.port}")
        logger.info(f"🌐 Open http://localhost:{self.port} to start chatting!")
        logger.info(f"🎤 TTS Service URL: {self.tts_url}")
        logger.info(f"� Using Groq API with model: {self.model_name}")
        logger.info(f"⚡ Lightning-fast inference enabled!")
        
        uvicorn.run(
            self.app,
            host="0.0.0.0",
            port=self.port,
            log_level="info"
        )

if __name__ == "__main__":
    server = AIAssistantServer()
    server.run()