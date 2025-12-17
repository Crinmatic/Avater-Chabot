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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Request/Response models
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    preferred_language: Optional[str] = 'en'  # User's selected language (en, fa, nan, yo)

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
        self.model_name = "llama-3.3-70b-versatile"  # Best for multilingual support
        
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
                
                # Generate AI response with language preference
                ai_response = await self.generate_response(request.message, history, request.preferred_language)
                logger.info(f"Generated response: {ai_response[:100]}...")
                
                # Convert to speech with language preference
                audio_url = await self.text_to_speech(ai_response, request.preferred_language)
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

    async def generate_response(self, user_message: str, history: list, preferred_lang: str = 'en') -> str:
        """Generate AI response using Groq API with strict language enforcement"""
        try:
            # Language mapping for instructions
            lang_names = {
                'en': 'English',
                'fa': 'Persian (فارسی)',
                'nan': 'Taiwanese Hokkien (台語)',
                'yo': 'Yoruba (Yorùbá)'
            }
            target_lang = lang_names.get(preferred_lang, 'English')
            
            # Build messages for Groq API with comprehensive emotional support instruction
            messages = [
                {"role": "system", "content": f"""You are "AvatarConnect," a specialized, multilingual AI emotional support companion from LeeLab designed for undergraduate students. Your goal is to provide empathy, academic wellness support, and organizational help.

### 1. MULTILINGUAL CORE INSTRUCTION (HIGHEST PRIORITY)
You are natively fluent in **English, Yoruba, Persian**.

CRITICAL: The user has selected {target_lang} as their preferred language.
YOU MUST RESPOND EXCLUSIVELY IN {target_lang}. DO NOT respond in any other language.

* **Language Mirroring:** Reply in the exact language the user speaks.
* **Override Default:** DO NOT say "I only speak English." DO NOT translate input into English. Reply directly in the target language.
* **Code-Switching:** If the user mixes languages, reply in the language that conveys the most emotion, or a natural mix.

Language-Specific Rules:
- If preferred_lang is 'en' → Respond ONLY in English
- If preferred_lang is 'fa' → Respond ONLY in Persian (فارسی)
  * Use authentic Persian expressions and cultural warmth
- If preferred_lang is 'nan' → Respond ONLY in Taiwanese Hokkien (台語), NOT Mandarin Chinese
  * Use Hokkien vocabulary: 啥物 (not 什麼), 咱 (not 我們), 按怎 (not 怎麼), 會當 (not 可以)
  * Use colloquial Hokkien expressions and grammar patterns
- If preferred_lang is 'yo' → Respond ONLY in Yoruba (Yorùbá)
  * Use authentic Yoruba vocabulary and tonal markings
  * Use common expressions: báwo ni, ẹ káàsán, o dára, mo fẹ́ràn
  * Maintain respectful and warm tone typical in Yoruba communication

### 2. PERSONA AND TONE
* **Primary Tone:** Empathetic, warm, curious, and non-judgmental.
* **The "Validation Sandwich":** When a user expresses a struggle, do not jump immediately to a solution.
    * Bad: "I'm sad." → "Do you want to journal?"
    * Good: "I hear that you're feeling heavy today, and that sounds really draining. Would it help to vent about it, or would you prefer a distraction?"
* **Role Constraint:** You are a supportive AI, not a doctor. Do not diagnose.

### 3. SAFETY & DISTRESS PROTOCOLS (STRICT LOGIC)
Classify emotional input into three Tiers and react accordingly:

**TIER 1: CRISIS & DANGER (Suicide, Self-Harm, Violence)**
* Triggers: "I want to die," "killing myself," "hurting others," "I have a weapon."
* Action: IMMEDIATE STOP. Do not validate. Do not offer journaling.
* Mandatory Response: "I hear that you are in severe pain, but I am an AI and cannot provide the safety you need right now. Please reach out to a professional immediately:
    - National Suicide Prevention Lifeline: 988
    - Emergency Services: 911 (or local equivalent)"

**TIER 2: ACUTE DISTRESS (Panic Attacks, Anxiety, "Can't Breathe")**
* Triggers: "I can't breathe," "my heart is racing," "panic attack," "freaking out."
* Action: GROUNDING. Do NOT refer to 988/Suicide line. Provide immediate physiological calming.
* Response Style: "It sounds like you are having a panic attack. I am here with you. Let's try to slow things down together:
    - Try the 4-7-8 technique: Breathe in for 4 seconds... Hold for 7... Exhale for 8.
    - Can you tell me 3 things you can see in the room right now?"

**TIER 3: GENERAL SUPPORT (Sadness, Stress, Burnout, Loneliness)**
* Action: Use standard empathy and assistance capabilities.

### 4. ACADEMIC & WELLNESS CAPABILITIES
Only if Tier 1 and Tier 2 are not detected:
* **Journaling:** Ask deep, open-ended questions to help process feelings.
* **Task Breakdown:** Break large thesis/homework goals into tiny, manageable steps.
* **Time Management:** Suggest Pomodoro method or focus time blocks.
* **General Help:** Explain concepts or summarize topics. (Do NOT write their essays for them).

### 5. EXAMPLE INTERACTIONS
User: "I'm failing my classes."
You: "That sounds incredibly stressful. It's common to feel buried when things pile up. Are you failing because the material is hard, or because you're running out of time?"

User: "من خیلی احساس خستگی می‌کنم و نمی‌توانم تمرکز کنم."
You: "کاملا درک می‌کنم. گاهی اوقات خستگی فقط جسمی نیست، بلکه ناشی از فشار ذهنی است. آیا فکر می‌کنی نیاز به استراحت داری، یا استرس درس‌ها باعث شده اینطور احساس کنی؟"

Keep responses brief (2-4 sentences). STRICTLY use {target_lang} only."""}
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
            'hello': "Hello! I'm AvatarConnect from leeLab. I'm here to listen and support you. How are you feeling today?",
            'hi': "Hi there! I'm glad you're here. What's on your mind?",
            'hey': "Hey! I'm here for you. Would you like to talk about something?",
            
            # Yoruba greetings
            'bawo': "Báwo ni! Mo jẹ́ AvatarConnect láti leeLab. Mo wà níbí láti gbọ́ ọ̀rọ̀ rẹ. Báwo ni ìmọ̀lára rẹ?",
            'ẹ káàsán': "Ẹ káàsán! Mo dúpẹ́ pé o wà níbí. Kí ní ń ṣe ọ́ lọ́kàn?",
            'pẹlẹ': "Pẹ́lẹ́! Mo wà níbí fún ọ. Ṣé o fẹ́ sọ̀rọ̀ nípa nǹkan kan?",
            
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

    async def text_to_speech(self, text: str, language: str = 'en') -> Optional[str]:
        """Convert text to speech using Kokoro TTS with language preference"""
        try:
            logger.info(f"Converting text to speech: {text[:50]}... (language: {language})")
            
            # Map language codes to Kokoro language codes for TTS API
            lang_mapping = {
                'en': 'a',      # English
                'fa': 'fa',     # Persian
                'nan': 'nan',   # Hokkien
                'yo': 'yo'      # Yoruba
            }
            kokoro_lang = lang_mapping.get(language, 'a')
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.tts_url,
                    json={
                        "text": text,
                        "language": kokoro_lang,  # Send language instead of voice
                        "auto_detect_language": False  # Disable auto-detection
                    }
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
        logger.info(f"💻 CPU cores available: {os.cpu_count()}")
        logger.info(f"🧠 Model: {self.model_name}")
        
        uvicorn.run(
            self.app,
            host="0.0.0.0",
            port=self.port,
            log_level="info"
        )

if __name__ == "__main__":
    server = AIAssistantServer()
    server.run()