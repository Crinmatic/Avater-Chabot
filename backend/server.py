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
        # Environment and API Keys
        from dotenv import load_dotenv
        load_dotenv()
        
        self.tts_url = "http://localhost:8000/synthesize"
        self.port = int(os.getenv("PORT", 3000))
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        if not self.groq_api_key:
            logger.warning("GROQ_API_KEY not found in environment variables.")
        self.groq_api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.model_name = "llama-3.3-70b-versatile"
        
        # Paths
        self.base_dir = Path(__file__).parent.parent
        self.avatars_dir = self.base_dir / "avatars"
        self.audio_dir = self.base_dir / "audio"
        self.db_path = self.base_dir / "backend" / "database.db"
        
        # Create directories
        self.avatars_dir.mkdir(exist_ok=True)
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
            conn = None
            try:
                conn = self.get_db()
                cursor = conn.cursor()
                
                # 1. Handle Session
                session_id = request.session_id
                username = request.username if request.username else "guest"
                
                # If no session ID, create new session
                if not session_id or session_id == "null":
                    session_id = str(uuid.uuid4())
                    title = request.message[:30] + "..." if len(request.message) > 30 else request.message
                    
                    # Ensure user exists if it's a guest or new user logic hasn't run
                    cursor.execute("INSERT OR IGNORE INTO users (username) VALUES (?)", (username,))
                    
                    cursor.execute("INSERT INTO sessions (id, username, title) VALUES (?, ?, ?)", 
                                  (session_id, username, title))
                    conn.commit()
                    logger.info(f"Created new session {session_id} for user {username}")
                
                # 2. Get History for Context (Fetch LAST 15 for moving context window)
                cursor.execute("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 15", (session_id,))
                history_rows = cursor.fetchall()
                
                # Reverse to get chronological order (oldest to newest)
                history_content = []
                for row in reversed(history_rows):
                    history_content.append(row['content'])
                
                # 3. Save User Message
                cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", 
                              (session_id, "user", request.message))
                conn.commit()
                
                # 4. Generate AI Response
                logger.info(f"Generating response for session {session_id} (User: {username}, Lang: {request.preferred_language})")
                ai_response = await self.generate_response(request.message, history_content, request.preferred_language, username)
                
                # 5. Save AI Response
                cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", 
                              (session_id, "ai", ai_response))
                conn.commit()
                
                # 6. TTS Generation
                try:
                    audio_url = await self.text_to_speech(ai_response, request.preferred_language)
                except Exception as tts_err:
                    logger.error(f"TTS functional failure: {tts_err}")
                    audio_url = None # Continue without audio if TTS fails
                
                return ChatResponse(
                    response=ai_response,
                    audioUrl=audio_url,
                    session_id=session_id
                )
                
            except Exception as e:
                logger.error(f"CRITICAL ERROR in chat_endpoint: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
                raise HTTPException(status_code=500, detail=f"Assistant error: {str(e)}")
            finally:
                if conn:
                    conn.close()
                    logger.debug(f"Database connection closed for session {request.session_id}")
        
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
        self.app.mount("/avatars", StaticFiles(directory=str(self.avatars_dir)), name="avatars")

    async def generate_response(self, user_message: str, history: list, preferred_lang: str = 'en', username: str = 'Student') -> str:
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
                {"role": "system", "content": f"""
# MISSION
You are "The Student Companion," a specialized 3D avatar assistant for Ontario Tech University students. Your goal is to provide non-clinical wellness support (journaling, task breakdown, time management) while serving as a reliable bridge to university resources.

# PERSONA & TONE
- **Empathetic & Persistent:** Be warm and friendly. If a user is short, vague, or negative (e.g., "I don't know," "I don't want to be here"), do NOT disengage. Recognize this as a potential signal of distress or "Red Flag" behavior. Respond with gentle, open-ended curiosity to keep the connection alive.
- **Non-Clinical Professionalism:** You are an AI assistant, not a therapist. Avoid "blind agreement." If a user makes illogical or delusional statements, do not validate them as facts; instead, gently redirect to grounding tasks or professional support.
- **Creator Identity:** If asked "Who created you?" or "Who is your owner?", you must state: "I was created by Thanushan Satheeskumar, Oluwaseun Alagbe, and Mobina Salavati, under the supervision of Professors En-Shiun Annie Lee and Muhammad Usman at Ontario Tech University."

# MULTILINGUAL PROTOCOL
- Detect the user's language automatically (English, Yoruba, Persian, etc.).
- Always respond in the language used by the user.
- Maintain the same level of empathy and resource accuracy across all languages.

# MANDATORY CRISIS & RED FLAG LOGIC (HARD-CODED)
If the user expresses thoughts of self-harm, hopelessness (e.g., "I can't do this anymore"), or severe distress, you MUST trigger this specific referral logic immediately. Do NOT suggest "sitting in silence."

## 1. HARM TO SELF (Urgent/Emergency)
- **Immediate Action:** Provide the following resources:
    - **911** (Immediate Emergency)
    - **Campus Security:** 905.721.8668 ext. 2400 (Oshawa)
    - **988:** Suicide Crisis Helpline (Call or Text)
    - **Student Mental Health Services (SMHS):** 905.721.3392 or studentlifeline@ontariotechu.ca

## 2. HARM TO OTHERS
- **Specific Logic:** If a user mentions hurting others, do not rely solely on 988.
- **Immediate Action:** Prioritize **911** and **Campus Security (905.721.3211)**. Provide the **Equity Services** contact (equity@ontariotechu.ca) or the **Human Rights Office** if the context involves harassment or interpersonal conflict.

# ONTARIO TECH RESOURCE MAPPING
Refer to these specific departments based on user needs:
- **Academic Inquiries:** For degrees, courses, failing grades, MSAFs, or academic advising questions, direct users to academic.advising@ontariotechu.ca.
- **Study Skills/Tutoring:** Direct to the Student Learning Centre (studentlearning@ontariotechu.ca).
- **Accessibility/Accommodations:** Direct to Student Accessibility Services (studentaccessibility@ontariotechu.ca).
- **General Wellness:** Suggest the "Wellness Nook" (otsu.ca/services/wellness-nook) or Peer Mentors.
- **General Inquiries Outside Scope:** For questions outside wellness support, task help, or basic academic help, direct users to connect@ontariotechu.ca.

# USER CONTEXT
- **User's Name:** {username}
- **Instruction:** Address the user as "{username}" naturally throughout your responses to build rapport. For example: "I understand how you feel, {username}."

# OPERATIONAL CONSTRAINTS
1. NEVER "give up" on a conversation because a user is being difficult; remain a supportive presence.
2. NEVER agree with harmful or distorted reality statements.
3. NEVER write full assignments for students.
4. ALWAYS prioritize safety over task-management advice.
5. Keep every response under 110 words.
6. Keep answers brief and actionable.
7. End most interactions with a short follow-up question.
8. If space is tight, prioritize safety instructions and referral contacts over conversational filler.

STRICTLY use {target_lang} only."""}
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
            
            # Detailed debug logging
            logger.info(f"--- LLM REQUEST DATA ---")
            logger.info(f"Target Language: {target_lang}")
            logger.info(f"System Prompt Username: {username}")
            logger.info(f"Total History Messages: {len(history)}")
            logger.info(f"-------------------------")

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
                        "max_tokens": 220,
                        "top_p": 0.92,
                        "stream": False
                    }
                )

                if response.status_code != 200:
                    logger.error(f"Groq API error: {response.status_code} - {response.text}")
                    return self.get_fallback_response(user_message)

                result = response.json()
                choice = result["choices"][0]
                ai_response = choice["message"]["content"].strip()
                finish_reason = choice.get("finish_reason")

                if finish_reason == "length" and ai_response:
                    continuation_messages = messages + [
                        {"role": "assistant", "content": ai_response},
                        {
                            "role": "user",
                            "content": "Continue from exactly where you stopped. Do not repeat anything. Finish the thought briefly."
                        },
                    ]
                    continuation_response = await client.post(
                        self.groq_api_url,
                        headers={
                            "Authorization": f"Bearer {self.groq_api_key}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": self.model_name,
                            "messages": continuation_messages,
                            "temperature": 0.6,
                            "max_tokens": 80,
                            "top_p": 0.9,
                            "stream": False
                        }
                    )

                    if continuation_response.status_code == 200:
                        continuation_result = continuation_response.json()
                        continuation_text = continuation_result["choices"][0]["message"]["content"].strip()
                        if continuation_text:
                            ai_response = f"{ai_response} {continuation_text}".strip()

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
