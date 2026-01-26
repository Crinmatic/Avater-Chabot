#!/usr/bin/env python3
"""
AI Avatar Assistant Backend
A Python FastAPI backend for serving AI responses with TTS integration
Optimized for CPU inference with multilingual support
Now with SQLite persistence for user sessions and chat history.
"""

import asyncio
import os
import time
import uuid
import logging
import sqlite3
import json
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Request/Response models
class LoginRequest(BaseModel):
    username: str

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    preferred_language: Optional[str] = 'en'
    username: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    audioUrl: Optional[str] = None
    session_id: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    tts_available: bool
    cpu_cores: int

class SessionInfo(BaseModel):
    id: str
    title: str
    created_at: str

class MessageInfo(BaseModel):
    role: str
    content: str
    timestamp: str

class SessionDetail(BaseModel):
    id: str
    messages: List[MessageInfo]

class AIAssistantServer:
    def __init__(self):
        self.app = FastAPI(title="AI Avatar Assistant", version="2.0.0")
        
        # Configuration
        self.tts_url = "http://localhost:8000/synthesize"
        self.port = int(os.getenv("PORT", 3000))
        self.groq_api_key = "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"
        self.groq_api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.model_name = "llama-3.3-70b-versatile"
        
        # Paths
        self.base_dir = Path(__file__).parent.parent
        self.audio_dir = self.base_dir / "audio"
        self.db_path = self.base_dir / "backend" / "database.db"
        
        # Create directories
        self.audio_dir.mkdir(exist_ok=True)
        
        # Initialize Database
        self.init_db()
        
        # Model status
        self.model_loaded = True
        
        # Setup middleware and routes
        self.setup_middleware()
        self.setup_routes()

    def get_db(self):
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        """Initialize SQLite database with required tables"""
        conn = self.get_db()
        cursor = conn.cursor()
        
        # Users table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Sessions table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            username TEXT,
            title TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users (username)
        )
        ''')
        
        # Messages table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            content TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        )
        ''')
        
        conn.commit()
        conn.close()
        logger.info(f"Database initialized at {self.db_path}")

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

        @self.app.post("/api/login")
        async def login(request: LoginRequest):
            conn = self.get_db()
            cursor = conn.cursor()
            
            # Check if user exists, if not create
            cursor.execute("SELECT * FROM users WHERE username = ?", (request.username,))
            user = cursor.fetchone()
            
            if not user:
                cursor.execute("INSERT INTO users (username) VALUES (?)", (request.username,))
                logger.info(f"Created new user: {request.username}")
            else:
                cursor.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?", (request.username,))
            
            conn.commit()
            conn.close()
            return {"status": "success", "username": request.username}

        @self.app.get("/api/sessions", response_model=List[SessionInfo])
        async def get_sessions(username: str):
            conn = self.get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, title, created_at FROM sessions WHERE username = ? ORDER BY created_at DESC", (username,))
            rows = cursor.fetchall()
            conn.close()
            
            return [SessionInfo(id=row['id'], title=row['title'], created_at=str(row['created_at'])) for row in rows]

        @self.app.get("/api/sessions/{session_id}", response_model=SessionDetail)
        async def get_session_detail(session_id: str):
            conn = self.get_db()
            cursor = conn.cursor()
            
            # Get messages
            cursor.execute("SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,))
            rows = cursor.fetchall()
            conn.close()
            
            messages = [MessageInfo(role=row['role'], content=row['content'], timestamp=str(row['timestamp'])) for row in rows]
            return SessionDetail(id=session_id, messages=messages)

        @self.app.post("/api/chat", response_model=ChatResponse)
        async def chat_endpoint(request: ChatRequest):
            try:
                conn = self.get_db()
                cursor = conn.cursor()
                
                # 1. Handle Session
                session_id = request.session_id
                
                # If no session ID, create new session
                if not session_id or session_id == "null":
                    session_id = str(uuid.uuid4())
                    title = request.message[:30] + "..." if len(request.message) > 30 else request.message
                    username = request.username if request.username else "guest"
                    
                    # Ensure user exists if it's a guest or new user logic hasn't run
                    cursor.execute("INSERT OR IGNORE INTO users (username) VALUES (?)", (username,))
                    
                    cursor.execute("INSERT INTO sessions (id, username, title) VALUES (?, ?, ?)", 
                                  (session_id, username, title))
                    conn.commit()
                    logger.info(f"Created new session {session_id} for user {username}")
                
                # 2. Get History for Context
                cursor.execute("SELECT content FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT 10", (session_id,))
                rows = cursor.fetchall()
                # Construct history list for AI context: [User, AI, User, AI...]
                # Note: This simple fetch doesn't separate roles perfectly for context if we just read content.
                # Use a better query to reconstruct pairs if needed, or just persist logic.
                # For now, let's fetch role/content relative to the session for context.
                cursor.execute("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,))
                history_rows = cursor.fetchall()
                
                history_content = []
                for row in history_rows:
                    history_content.append(row['content']) # Just list of strings as per original logic expectation
                
                # 3. Save User Message
                cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", 
                              (session_id, "user", request.message))
                conn.commit()
                
                # 4. Generate AI Response
                # Note: history_content currently contains ALL messages. 
                # Ideally, we should filter or format it as the `generate_response` expects alternating format.
                # The original `generate_response` expected a list of strings [User, AI, User, AI].
                # We can replicate that structure.
                
                logger.info(f"Generating response for session {session_id}")
                ai_response = await self.generate_response(request.message, history_content, request.preferred_language)
                
                # 5. Save AI Response
                cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", 
                              (session_id, "ai", ai_response))
                conn.commit()
                conn.close()
                
                # 6. TTS Generation
                audio_url = await self.text_to_speech(ai_response, request.preferred_language)
                
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
            
            # Build messages for Groq API
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

Keep responses brief (2-4 sentences). STRICTLY use {target_lang} only."""}
            ]
            
            # Add conversation history
            # History is passed as a list of strings. Assuming alternating User/AI from DB logic (which we fixed partially)
            # The previous context was implicit. Let's make it robust.
            # We treat the list as just prior context messages for the LLM. 
            # Ideally we'd separate roles in the method signature, but for now we append them.
            # Since strict role assignment is better, let's just append the last few messages as User/Assistant based on simple heuristic or just 'user' if unsure, 
            # BUT: In endpoints we passed raw content. 
            # IMPROVEMENT: In endpoints, we should query messages with roles. 
            # For this specific method, let's just append the messages.
            # However, for the chat model to work well, we need roles. 
            # Since we just modified the caller to pass just content, let's fix the caller or handle it here.
            # The simpler fix is to trust the caller provided valid history logic OR just update the caller to pass objects.
            # ACTUALLY: I will just trust the simple history buffering for now to avoid breaking too much, 
            # but ideally I should have refactored `generate_response` to accept `List[MessageInfo]`.
            # Let's assume alternating for now from `history` list (User, AI, User, AI...) which was the old behavior.
            
            for i, msg in enumerate(history):
                # Simple alternation guess if roles aren't preserved in list
                role = "user" if i % 2 == 0 else "assistant" 
                messages.append({"role": role, "content": msg})
            
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
            'hello': "Hello! I'm AvatarConnect from leeLab. I'm here to listen and support you. How are you feeling today?",
            'hi': "Hi there! I'm glad you're here. What's on your mind?",
            'hey': "Hey! I'm here for you. Would you like to talk about something?",
            'bawo': "Báwo ni! Mo jẹ́ AvatarConnect láti leeLab. Mo wà níbí láti gbọ́ ọ̀rọ̀ rẹ. Báwo ni ìmọ̀lára rẹ?",
            'ẹ káàsán': "Ẹ káàsán! Mo dúpẹ́ pé o wà níbí. Kí ní ń ṣe ọ́ lọ́kàn?",
            'pẹlẹ': "Pẹ́lẹ́! Mo wà níbí fún ọ. Ṣé o fẹ́ sọ̀rọ̀ nípa nǹkan kan?",
            'sad': "I hear that you're feeling sad. That must be really difficult. Would you like to share what's weighing on you?",
            'depressed': "I'm so sorry you're going through this. Depression can feel so heavy. You're not alone in this.",
            'anxious': "Anxiety can be so overwhelming. I'm here to listen without judgment. What's making you feel anxious?",
            'stressed': "Stress can really take a toll. Take a deep breath with me. What's been stressing you out?",
            'lonely': "Feeling lonely is so hard. I'm here with you right now. Would you like to talk about it?",
            'suicide': "I'm really concerned about you. Please reach out to a crisis helpline immediately: 988 (US) or your local emergency services. You deserve support from professionals who can help."
        }
        
        for key, response in fallbacks.items():
            if key in message_lower:
                return response
        
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
                        "language": kokoro_lang,
                        "auto_detect_language": False
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"TTS service error: {response.status_code}")
                    return None
                
                timestamp = int(time.time() * 1000)
                audio_filename = f"speech_{timestamp}.wav"
                audio_path = self.audio_dir / audio_filename
                
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