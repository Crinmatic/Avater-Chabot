const translations = {
    en: { statusInit: "Initializing AvatarConnect...", welcomeMessage: "Hello! I'm AvatarConnect, your emotional support companion from leeLab. I'm here to listen and support you. How are you feeling today?", placeholder: "Share what's on your mind...", sendBtn: "Send", sidebarTitle: "AI Avatar Assistant", newChat: "New Chat", settings: "Settings", historyTitle: "History", theme: "Theme:", voice: "Avatar Voice:", language: "Menu Language:", save: "Save", statusListening: "Listening...", statusThinking: "Thinking...", statusSpeaking: "Speaking...", statusLoading: "Loading avatar...", errorMsg: "Sorry, I encountered an error. Please try again.", loginTitle: "Welcome", loginPlaceholder: "Enter your username", loginBtn: "Start Chatting", logout: "Logout" },
    fa: { statusInit: "در حال راه‌اندازی لی‌بات...", welcomeMessage: "سلام! من لی‌بات هستم. امروز چه احساسی دارید؟", placeholder: "آنچه در ذهن دارید را به اشتراک بگذارید...", sendBtn: "ارسال", sidebarTitle: "دستیار آواتار هوشمند", newChat: "چت جدید", settings: "تنظیمات", historyTitle: "تاریخچه", theme: "تم:", voice: "صدای آواتار:", language: "زبان منو:", save: "ذخیره", statusListening: "در حال گوش دادن...", statusThinking: "در حال فکر کردن...", statusSpeaking: "در حال صحبت...", statusLoading: "در حال بارگذاری آواتار...", errorMsg: "متاسفم، مشکلی پیش آمد.", loginTitle: "خوش آمدید", loginPlaceholder: "نام کاربری خود را وارد کنید", loginBtn: "شروع گفتگو", logout: "خروج" },
    yo: { statusInit: "O n bẹrẹ AvatarConnect...", welcomeMessage: "Kaabo! Emi ni AvatarConnect. Bawo ni o ṣe lero loni?", placeholder: "Pin ohun ti o wa ni ọkan rẹ...", sendBtn: "Fi ranṣẹ", sidebarTitle: "Oluranlọwọ Avatar AI", newChat: "Ifọrọwerọ Tuntun", settings: "Ètò", historyTitle: "Itan", theme: "Àwọ̀:", voice: "Ohùn Avatar:", language: "Ede Akojọ:", save: "Fipamọ", statusListening: "N tẹtisi...", statusThinking: "N ronu...", statusSpeaking: "N sọrọ...", statusLoading: "N kojọpọ avatar...", errorMsg: "Ma binu, mo ni aṣiṣe kan.", loginTitle: "Kaabo", loginPlaceholder: "Tẹ orukọ olumulo rẹ sii", loginBtn: "Bẹrẹ Ifọrọwerọ", logout: "Jade" },
    nan: { statusInit: "AvatarConnect 啟動中...", welcomeMessage: "你好! 我是 AvatarConnect。你今天感覺如何？", placeholder: "分享你在想什麼...", sendBtn: "送出", sidebarTitle: "AI 虛擬助手", newChat: "新開講", settings: "設定", historyTitle: "歷史", theme: "主題:", voice: "聲音:", language: "選單語言:", save: "儲存", statusListening: "聽你在說...", statusThinking: "想看覓...", statusSpeaking: "講話中...", statusLoading: "Avatar 載入中...", errorMsg: "歹勢，出了一點問題。", loginTitle: "歡迎", loginPlaceholder: "輸入你的使用者名稱", loginBtn: "開始講話", logout: "登出" }
};

function setLanguage(lang) {
    if (!translations[lang]) return;
    if (lang === 'fa') document.documentElement.setAttribute('dir', 'rtl');
    else document.documentElement.setAttribute('dir', 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = translations[lang][el.getAttribute('data-i18n')];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = translations[lang][el.getAttribute('data-i18n-placeholder')];
    });

    // Update dynamic instance strings and reload avatar if language changed
    if (window.avatarInstance) {
        const oldLang = window.avatarInstance.currentLang;
        window.avatarInstance.currentLang = lang;

        // Reload avatar if language changed (different avatar models for different languages)
        if (oldLang !== lang) {
            window.avatarInstance.updateSceneBackground();
            window.avatarInstance.reloadAvatar();
        }
    }
}

class AvatarAssistant {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.avatar = null;
        this.mixer = null;
        this.clock = new THREE.Clock();
        this.isLoading = true;
        this.isSpeaking = false;
        this.audioContext = null;
        this.audioAnalyser = null;
        this.currentAudio = null;
        this.morphTargets = null;
        this.sessionId = null; // Track session ID for conversation memory
        this.sessionId = null; // Track session ID for conversation memory
        this.currentLang = 'en'; // Default Menu Language
        this.username = localStorage.getItem('avatar_username'); // Check if logged in

        // --- NEW: Login & History Management Setup ---
        this.setupLogin();
        // ---------------------------------------------

        // Text-to-viseme lip sync system
        this.lipsyncEngine = new LipsyncEn();
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
        this.visemeStartTime = 0;
        this.currentResponseText = '';

        // Idle animation timers
        this.nextBlinkTime = 5; // First blink after 5 seconds
        this.blinkStartTime = 0;
        this.blinkDuration = 0;
        this.isBlinking = false;
        this.nextLookTime = 0;
        this.lookDuration = 0;
        this.lookTarget = { x: 0, y: 0 };
        this.currentLook = { x: 0, y: 0 };

        this.init();
        this.setupChat();
        this.setupAudioContext();
    }

    t(key) {
        return translations[this.currentLang][key] || translations['en'][key];
    }

    updateSceneBackground() {
        if (this.scene) {
            // Dark purple-blue background for all languages
            this.scene.background = new THREE.Color(0x1a1a2e);
        }
    }

    init() {
        const container = document.getElementById('avatar-container');

        // Scene setup
        this.scene = new THREE.Scene();
        this.updateSceneBackground(); // Set background based on language

        // Camera setup - Closer for headshot view
        this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 1.65, 0.5); // Much closer - headshot distance

        // Renderer setup with maximum quality
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Sharp on retina displays
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        container.appendChild(this.renderer.domElement);

        // Balanced Lighting Setup
        // 1. Ambient light - soft overall illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // 2. Key light (main directional light) - from front-right
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(2, 3, 3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        this.scene.add(keyLight);

        // 3. Fill light - soft light from left
        const fillLight = new THREE.DirectionalLight(0xd4e4ff, 0.3);
        fillLight.position.set(-2, 2, 2);
        this.scene.add(fillLight);

        // 4. Rim/Back light - subtle edge lighting
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
        rimLight.position.set(0, 2, -3);
        this.scene.add(rimLight);

        // Load avatar
        this.loadAvatar();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start render loop
        this.animate();
    }

    setupLogin() {
        const modal = document.getElementById('loginModal');
        const usernameInput = document.getElementById('loginUsername');
        const loginBtn = document.getElementById('loginBtn');
        const loginTitle = document.getElementById('loginTitle');

        // Safety Modal Logic
        const safetyModal = document.getElementById('safetyModal');
        const acceptBtn = document.getElementById('acceptBtn');
        const declineBtn = document.getElementById('declineBtn');
        const hasAcceptedSafety = localStorage.getItem('avatar_safety_accepted');

        // Initial check
        if (!hasAcceptedSafety) {
            safetyModal.style.display = 'flex';
            modal.style.display = 'none';
        } else {
            safetyModal.style.display = 'none';
            this.checkLoginState(modal, usernameInput);
        }

        // Attach listeners with cloning to remove old ones
        if (acceptBtn) {
            const newAcceptBtn = acceptBtn.cloneNode(true);
            acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);

            newAcceptBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('✅ Safety Disclaimer Accepted');
                localStorage.setItem('avatar_safety_accepted', 'true');
                safetyModal.style.display = 'none';
                this.checkLoginState(modal, usernameInput);
            });
        }

        if (declineBtn) {
            declineBtn.addEventListener('click', (e) => {
                e.preventDefault();
                alert("You must accept the safety disclaimer to use this application.");
                window.location.href = "https://google.com";
            });
        }

        // Login Logic
        const handleLogin = async () => {
            const username = usernameInput.value.trim();
            if (username) {
                this.username = username;
                localStorage.setItem('avatar_username', username);
                modal.style.display = 'none';

                // Register user in backend
                try {
                    await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username })
                    });
                } catch (e) {
                    console.error("Login sync failed:", e);
                }

                this.displayUsername(); // NEW: Display name on top
                this.loadHistory();
                this.updateStatus(this.t('statusInit'));
            }
        };

        // Attach login listeners
        const newLoginBtn = loginBtn.cloneNode(true);
        loginBtn.parentNode.replaceChild(newLoginBtn, loginBtn);
        newLoginBtn.addEventListener('click', handleLogin);

        // Add Enter key support for login
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });

        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            const newLogoutBtn = logoutBtn.cloneNode(true);
            logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
            newLogoutBtn.addEventListener('click', () => {
                localStorage.removeItem('avatar_username');
                location.reload();
            });
        }
    }

    checkLoginState(modal, usernameInput) {
        // Stronger cleanup of invalid username storage
        if (this.username) {
            // Trim and check validity
            const cleanName = String(this.username).trim();
            if (cleanName === '' || cleanName === 'null' || cleanName === 'undefined') {
                console.log('🧹 Clearing invalid username:', this.username);
                this.username = null;
                localStorage.removeItem('avatar_username');
            } else {
                this.username = cleanName; // Normalize
            }
        }

        // Check for existing login
        if (this.username) {
            console.log('✅ Auto-logged in as:', this.username);
            modal.style.display = 'none';
            this.displayUsername(); // NEW: Display name on top
            this.loadHistory();
            this.updateStatus(this.t('statusInit'));
        } else {
            console.log('👤 No valid session. Waiting for user login...');
            // Force display and clear input
            modal.style.display = 'flex';
            usernameInput.value = '';
            usernameInput.focus();
        }
    }


    displayUsername() {
        const displayEl = document.getElementById('userNameDisplay');
        if (displayEl && this.username) {
            displayEl.textContent = `Logged in as: ${this.username}`;
            displayEl.style.display = 'block';
        }
    }

    async loadHistory() {
        if (!this.username) return;

        try {
            const response = await fetch(`/api/sessions?username=${this.username}`);
            const sessions = await response.json();

            const chatList = document.querySelector('.chat-list');
            chatList.innerHTML = ''; // Clear existing

            sessions.forEach(session => {
                const li = document.createElement('li');
                li.textContent = session.title || new Date(session.created_at).toLocaleString();
                li.dataset.sessionId = session.id;

                // Highlight active session
                if (session.id === this.sessionId) {
                    li.classList.add('active');
                }

                li.onclick = () => this.loadSession(session.id);
                chatList.appendChild(li);
            });

        } catch (e) {
            console.error("Failed to load history:", e);
        }
    }

    async loadSession(sessionId) {
        this.sessionId = sessionId;
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = ''; // Clear current chat

        try {
            const response = await fetch(`/api/sessions/${sessionId}`);
            const data = await response.json();

            data.messages.forEach(msg => {
                this.addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai');
            });

            // Update active session highlight
            this.loadHistory();

            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
                document.getElementById('openSidebar').style.display = 'block';
            }

        } catch (e) {
            console.error("Failed to load session:", e);
        }
    }

    getAvatarUrl() {
        // Avatar mapping based on selected language
        // Avatar mapping with high-quality presets for each language
        // All avatars use Ready Player Me modular characters
        const avatarMapping = {
            'en': 'https://models.readyplayer.me/68dfbe6efedc24530045d33f.glb',
            'fa': 'https://models.readyplayer.me/691df9fa1aa3af821a157927.glb',
            'nan': 'https://models.readyplayer.me/691dfb04fb99478e41171cd4.glb',
            'yo': 'https://models.readyplayer.me/69273d8a132e61458cd9f86e.glb'
        };

        const baseUrl = avatarMapping[this.currentLang] || avatarMapping['en'];
        // Highest quality settings:
        // - morphTargets: ARKit + Oculus Visemes for lip sync
        // - lod=0: Highest geometry detail
        // - textureAtlas=none: Separate high-res textures
        // - quality=high: Maximum texture resolution
        return `${baseUrl}?morphTargets=ARKit,Oculus%20Visemes&lod=0&textureAtlas=none&quality=high`;
    }

    loadAvatar() {
        const loader = new THREE.GLTFLoader();

        // Ready Player Me API - Request avatar with morph targets
        // Documentation: https://docs.readyplayer.me/ready-player-me/api-reference/rest-api/avatars/get-3d-avatars
        // Options: "ARKit", "Oculus Visemes", or both "ARKit,Oculus Visemes"

        // Using ARKit which includes: jawOpen, mouthOpen, mouthSmile, etc.
        // AND Oculus Visemes for better lip sync
        const avatarUrl = this.getAvatarUrl();

        console.log('🔄 Loading avatar with morph targets from:', avatarUrl);
        this.updateStatus(this.t('statusLoading'));

        loader.load(
            avatarUrl,
            (gltf) => {
                this.avatar = gltf.scene;
                this.avatar.scale.set(1, 1, 1);
                this.avatar.position.set(0, 0, 0);

                // Enable shadows
                this.avatar.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Find the HEAD mesh with morph targets for lip sync
                        // Ready Player Me avatars use Wolf3D_Head or Wolf3D_Avatar for facial animation
                        if (child.morphTargetInfluences && child.morphTargetInfluences.length > 0) {
                            // Only use the head mesh, not eyes or teeth
                            if (child.name === 'Wolf3D_Head' || child.name === 'Wolf3D_Avatar' || child.name === 'head') {
                                this.morphTargets = child;
                                console.log('✅ Found LIP SYNC mesh:', child.name);
                                console.log('Morph target dictionary:', child.morphTargetDictionary);
                                console.log('Total morph targets:', child.morphTargetInfluences.length);

                                // Check for Ready Player Me blend shapes (both ARKit and Oculus)
                                console.log('--- Checking for Lip Sync Blend Shapes ---');
                                const blendShapeChecks = {
                                    // ARKit blend shapes (Apple)
                                    'jawOpen': this.findMorphTarget(['jawOpen']),
                                    'mouthOpen': this.findMorphTarget(['mouthOpen']),
                                    'mouthSmileLeft': this.findMorphTarget(['mouthSmileLeft']),
                                    'mouthSmileRight': this.findMorphTarget(['mouthSmileRight']),
                                    'mouthFunnel': this.findMorphTarget(['mouthFunnel']),
                                    'mouthPucker': this.findMorphTarget(['mouthPucker']),
                                    // Oculus Viseme blend shapes
                                    'viseme_aa': this.findMorphTarget(['viseme_aa']),
                                    'viseme_E': this.findMorphTarget(['viseme_E']),
                                    'viseme_I': this.findMorphTarget(['viseme_I']),
                                    'viseme_O': this.findMorphTarget(['viseme_O']),
                                    'viseme_PP': this.findMorphTarget(['viseme_PP']),
                                    'viseme_SS': this.findMorphTarget(['viseme_SS'])
                                };

                                let foundCount = 0;
                                Object.keys(blendShapeChecks).forEach(key => {
                                    const found = blendShapeChecks[key] !== -1;
                                    const icon = found ? '✅' : '❌';
                                    console.log(`  ${key}: ${icon}${found ? ' (index: ' + blendShapeChecks[key] + ')' : ''}`);
                                    if (found) foundCount++;
                                });
                                console.log(`Found ${foundCount}/${Object.keys(blendShapeChecks).length} lip sync blend shapes`);
                            }
                        }
                    }
                });

                // Debug: Log all avatar children for troubleshooting
                console.log('--- Avatar Structure Debug ---');
                console.log('Avatar children count:', this.avatar.children.length);
                this.avatar.traverse((child) => {
                    if (child.name) {
                        console.log('- ' + child.name,
                            child.type,
                            child.morphTargetInfluences ? `(${child.morphTargetInfluences.length} morphs)` : '');
                    }
                });
                console.log('--- End Avatar Structure ---');

                // Setup animations if available
                if (gltf.animations && gltf.animations.length > 0) {
                    this.mixer = new THREE.AnimationMixer(this.avatar);
                    // You can add specific animations here
                }

                this.scene.add(this.avatar);
                this.isLoading = false;

                // Check if we found morph targets for lip sync
                if (this.morphTargets) {
                    this.updateStatus('Avatar loaded! Lip sync: ✅ ENABLED');
                    console.log('🎤 Lip sync is ENABLED with morph targets');
                } else {
                    this.updateStatus('Avatar loaded! Lip sync: ⚠️ Using fallback (no morph targets)');
                    console.warn('⚠️ No morph targets found - using fallback jaw animation');
                    console.log('This avatar may not support lip sync. Consider using a newer Ready Player Me avatar.');
                }

                this.enableChat();
            },
            (progress) => {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                this.updateStatus(`Loading avatar... ${percent}%`);
            },
            (error) => {
                console.error('Error loading avatar:', error);
                this.updateStatus('Failed to load avatar. Please check your connection.');
            }
        );
    }

    reloadAvatar() {
        // Stop any current audio/speech
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        this.isSpeaking = false;
        this.visemeQueue = [];

        // Remove old avatar from scene completely
        if (this.avatar) {
            // Dispose of all materials and geometries
            this.avatar.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
            this.scene.remove(this.avatar);
            this.avatar = null;
            this.morphTargets = null;
        }

        // Reset mixer if exists
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }

        // Load new avatar with updated language
        this.isLoading = true;
        this.loadAvatar();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        // Update animations
        if (this.mixer) {
            this.mixer.update(delta);
        }

        // Natural idle animations
        if (this.avatar && !this.isLoading) {
            // Procedural head movements DISABLED for static body pose
            /*
            if (this.avatar.children[0] && !this.isSpeaking) {
                // Very subtle head sway (side to side - Y rotation)
                this.avatar.children[0].rotation.y = Math.sin(time * 0.3) * 0.02;

                // Tiny head tilt (Z rotation)
                this.avatar.children[0].rotation.z = Math.sin(time * 0.25) * 0.01;
            }
            */

            // Eye blinking using morph targets
            this.updateBlink(time);

            // Occasional eye/head look around
            this.updateLookAround(time, delta);
        }

        // Update lip sync if speaking
        if (this.isSpeaking && this.audioAnalyser) {
            if (this.morphTargets) {
                // Use morph target-based lip sync (best quality)
                this.updateLipSync();
            } else if (this.avatar && this.avatar.children[0]) {
                // Fallback: Use jaw rotation if no morph targets
                this.updateJawAnimation();
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const container = document.getElementById('avatar-container');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }

    enableChat() {
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendButton').disabled = false;
    }

    setupAudioContext() {
        // Create audio context for lip sync analysis
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.audioAnalyser = this.audioContext.createAnalyser();

        // Higher FFT size for better frequency resolution (more detailed phoneme detection)
        this.audioAnalyser.fftSize = 1024; // Increased from 512 for finer detail

        // Less smoothing for more responsive lip sync (was 0.7)
        this.audioAnalyser.smoothingTimeConstant = 0.6;

        console.log('🎤 Audio analyzer configured: FFT size =', this.audioAnalyser.fftSize,
            'Frequency bins =', this.audioAnalyser.frequencyBinCount);
    }

    updateLipSync() {
        if (!this.morphTargets) {
            return;
        }

        // Audio-driven lip sync for non-English languages (or when no viseme queue)
        if (this.visemeQueue.length === 0 && this.isSpeaking) {
            this.updateAudioDrivenLipSync();
            return;
        }

        // Text-based lip sync (English only)
        if (this.visemeQueue.length === 0) {
            return;
        }

        const influences = this.morphTargets.morphTargetInfluences;
        const currentTime = performance.now() - this.speechStartTime;

        // REAL-TIME AUDIO ANALYSIS - Detect actual speech vs silence
        let audioVolume = 0;
        let isActuallySpeaking = false;

        if (this.audioAnalyser) {
            const bufferLength = this.audioAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.audioAnalyser.getByteFrequencyData(dataArray);

            // Calculate RMS volume for speech detection
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            audioVolume = Math.sqrt(sum / bufferLength) / 255;

            // Speech threshold - only animate when actually speaking
            isActuallySpeaking = audioVolume > 0.02; // Adjust threshold as needed

            // Debug logging (throttled)
            if (!this.lastAudioLog || Date.now() - this.lastAudioLog > 500) {
                console.log(`🎵 Audio: ${(audioVolume * 100).toFixed(1)}% | Speaking: ${isActuallySpeaking ? '✅' : '❌'}`);
                this.lastAudioLog = Date.now();
            }
        }

        // TalkingHead-style coarticulation: Multiple visemes active simultaneously
        const activeVisemes = new Map();

        for (const viseme of this.visemeQueue) {
            if (currentTime < viseme.attackTime) continue; // Not started yet
            if (currentTime > viseme.releaseTime) continue; // Already finished

            let intensity = 0;

            if (currentTime < viseme.peakTime) {
                // Attack phase: blend in
                const progress = (currentTime - viseme.attackTime) / (viseme.peakTime - viseme.attackTime);
                intensity = this.easeInOut(progress);
            } else {
                // Release phase: blend out
                const progress = (currentTime - viseme.peakTime) / (viseme.releaseTime - viseme.peakTime);
                intensity = 1.0 - this.easeInOut(progress);
            }

            // Different max intensities for different viseme types (REDUCED for subtle movement)
            let maxIntensity = 0.35; // Reduced from 0.6 - much more subtle
            if (['PP', 'FF'].includes(viseme.name)) {
                maxIntensity = 0.5; // Reduced from 0.9 - still visible but not exaggerated
            }

            // Accumulate intensity (allows blending of multiple visemes)
            const current = activeVisemes.get(viseme.name) || 0;
            activeVisemes.set(viseme.name, Math.min(current + intensity * maxIntensity, 1.0));
        }

        // Apply all active visemes with AUDIO-GATED blending
        const allVisemes = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'CH', 'FF', 'kk', 'nn', 'RR', 'DD', 'sil'];

        for (const visemeName of allVisemes) {
            const index = this.findMorphTarget([`viseme_${visemeName}`]);
            if (index === -1) continue;

            if (activeVisemes.has(visemeName) && isActuallySpeaking) {
                // Active AND audio is present: set to calculated intensity
                const targetIntensity = activeVisemes.get(visemeName) * (0.5 + audioVolume * 0.5);
                influences[index] = targetIntensity;
            } else {
                // Inactive OR no audio: fast decay (mouth closes during pauses)
                influences[index] *= 0.65; // Even faster decay during silence
                if (influences[index] < 0.01) influences[index] = 0;
            }
        }

        // During silence, show neutral/rest position
        if (!isActuallySpeaking) {
            const silIndex = this.findMorphTarget(['viseme_sil']);
            if (silIndex !== -1) {
                influences[silIndex] = Math.min(influences[silIndex] + 0.1, 0.3);
            }
        }

        // Jaw movement for vowels (AUDIO-GATED - only when actually speaking)
        let maxJaw = 0;
        if (isActuallySpeaking) {
            for (const [name, intensity] of activeVisemes) {
                if (['aa', 'E', 'I', 'O', 'U'].includes(name)) {
                    maxJaw = Math.max(maxJaw, intensity);
                }
            }
        }

        const jawIndex = this.findMorphTarget(['jawOpen']);
        if (jawIndex !== -1) {
            if (isActuallySpeaking) {
                // Speaking: subtle jaw movement
                const targetJaw = maxJaw * 0.25 * (0.7 + audioVolume * 0.3); // Volume-modulated
                influences[jawIndex] = influences[jawIndex] * 0.9 + targetJaw * 0.1;
            } else {
                // Silent: jaw closes quickly
                influences[jawIndex] *= 0.6;
            }
        }
    }

    easeInOut(t) {
        // Sigmoid-like easing for smooth coarticulation (TalkingHead uses sigmoid(5))
        return t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    getFrequencyAverage(dataArray, startIndex, endIndex) {
        let sum = 0;
        const count = endIndex - startIndex;
        for (let i = startIndex; i < endIndex && i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        return (sum / count) / 255; // Normalize to 0-1
    }

    updateAudioDrivenLipSync() {
        // Real-time audio-driven lip sync for Persian, Hokkien, and Yoruba
        if (!this.audioAnalyser || !this.morphTargets) return;

        const influences = this.morphTargets.morphTargetInfluences;
        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.audioAnalyser.getByteFrequencyData(dataArray);

        // Analyze frequency bands for different mouth shapes
        const lowFreq = this.getFrequencyAverage(dataArray, 0, 10);        // Low: 0-500Hz (vowels)
        const midFreq = this.getFrequencyAverage(dataArray, 10, 40);      // Mid: 500-2kHz (consonants)
        const highFreq = this.getFrequencyAverage(dataArray, 40, 80);     // High: 2-4kHz (sibilants)

        // Calculate overall volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const volume = Math.sqrt(sum / bufferLength) / 255;
        const isSpeaking = volume > 0.01;  // Lower threshold for Persian/Hokkien/Yoruba sensitivity

        if (isSpeaking) {
            // Get all viseme indices
            const aaIndex = this.findMorphTarget(['viseme_aa']);  // "ah" - open mouth
            const oIndex = this.findMorphTarget(['viseme_O']);    // "oh" - rounded lips
            const eIndex = this.findMorphTarget(['viseme_E']);    // "eh" - spread lips
            const iIndex = this.findMorphTarget(['viseme_I']);    // "ee" - wide smile
            const uIndex = this.findMorphTarget(['viseme_U']);    // "oo" - pursed lips
            const ppIndex = this.findMorphTarget(['viseme_PP']);  // "p/b/m"
            const ssIndex = this.findMorphTarget(['viseme_SS']);  // "s/z"
            const thIndex = this.findMorphTarget(['viseme_TH']);  // "th/f/v"

            // Determine dominant viseme based on frequency profile
            let dominantViseme = null;
            let dominantIntensity = 0;

            // Low frequencies (vowels) - choose which vowel shape
            if (lowFreq > 0.15) {
                if (midFreq < 0.2) {
                    dominantViseme = aaIndex; // "ah" - open
                    dominantIntensity = lowFreq * 0.25;
                } else {
                    dominantViseme = oIndex; // "oh" - rounded
                    dominantIntensity = lowFreq * 0.22;
                }
            } else if (midFreq > 0.15) {
                if (highFreq > 0.2) {
                    dominantViseme = iIndex; // "ee" - high front
                    dominantIntensity = (midFreq + highFreq) * 0.12;
                } else {
                    dominantViseme = eIndex; // "eh" - mid
                    dominantIntensity = midFreq * 0.18;
                }
            } else if (highFreq > 0.2) {
                if (midFreq > 0.1) {
                    dominantViseme = ssIndex; // Sibilant
                    dominantIntensity = highFreq * 0.15;
                } else {
                    dominantViseme = thIndex; // Fricative
                    dominantIntensity = highFreq * 0.12;
                }
            }

            // Apply dominant viseme with very gentle transitions
            const allVisemes = [aaIndex, oIndex, eIndex, iIndex, uIndex, ppIndex, ssIndex, thIndex];
            for (const idx of allVisemes) {
                if (idx === -1) continue;

                if (idx === dominantViseme) {
                    // Reduce intensity by 60%
                    influences[idx] = this.smoothValue(influences[idx], dominantIntensity * 0.4, 0.2);
                } else {
                    influences[idx] = this.smoothValue(influences[idx], 0, 0.35); // Faster decay
                }
            }

            // Minimal jaw movement - barely visible
            const jawIndex = this.findMorphTarget(['jawOpen']);
            if (jawIndex !== -1) {
                const jawTarget = Math.min(volume * 0.15 + lowFreq * 0.08, 0.08);
                influences[jawIndex] = this.smoothValue(influences[jawIndex], jawTarget, 0.15);
            }
        } else {
            // Smooth decay to neutral when not speaking
            for (let i = 0; i < influences.length; i++) {
                influences[i] *= 0.7;
                if (influences[i] < 0.01) influences[i] = 0;
            }
        }
    }

    smoothValue(current, target, smoothing) {
        // Exponential smoothing for natural transitions
        return current + (target - current) * smoothing;
    }

    updateJawAnimation() {
        // Fallback animation when no morph targets are available
        // Only affects jaw bone, not the whole avatar
        if (!this.audioAnalyser || !this.avatar) return;

        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.audioAnalyser.getByteFrequencyData(dataArray);

        // Calculate volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const volume = (sum / bufferLength) / 255;

        // Try to find and animate ONLY the jaw/mouth bones
        let jawAnimated = false;
        this.avatar.traverse((child) => {
            const name = child.name ? child.name.toLowerCase() : '';

            // Only target specific jaw/mouth bones, not head or body
            if (name === 'jaw' ||
                name === 'jawbone' ||
                name === 'lower_jaw' ||
                name === 'mandible') {

                // Rotate jaw bone based on volume
                if (child.isObject3D) {
                    child.rotation.x = volume * 0.3; // Jaw open rotation
                    jawAnimated = true;
                }
            }
        });

        // If no jaw bone found, log a warning once
        if (!jawAnimated && !this.jawWarningLogged) {
            console.warn('⚠️ No jaw bone found for fallback animation. Lip sync disabled.');
            console.log('Tip: Use a Ready Player Me avatar with morph targets for proper lip sync.');
            this.jawWarningLogged = true;
        }
    }

    updateBlink(time) {
        // Natural blinking animation using eye morph targets
        if (!this.morphTargets || !this.morphTargets.morphTargetInfluences) return;

        // Random blink timing (every 5-8 seconds)
        if (time > this.nextBlinkTime && !this.isBlinking) {
            this.isBlinking = true;
            this.blinkStartTime = time; // Record when blink started
            this.blinkDuration = 0.15; // 150ms blink
            this.nextBlinkTime = time + 5 + Math.random() * 3; // Next blink in 5-8 seconds
        }

        // Animate blink
        if (this.isBlinking) {
            const blinkProgress = time - this.blinkStartTime;
            const blinkPhase = Math.min(blinkProgress / this.blinkDuration, 1.0);

            // Smooth blink curve (close and open)
            const blinkValue = Math.sin(blinkPhase * Math.PI);

            // Find eye blink morph targets
            const eyeBlinkLeft = this.findMorphTarget(['eyeBlinkLeft', 'eye_blink_left', 'Blink_Left']);
            const eyeBlinkRight = this.findMorphTarget(['eyeBlinkRight', 'eye_blink_right', 'Blink_Right']);

            if (eyeBlinkLeft >= 0) {
                this.morphTargets.morphTargetInfluences[eyeBlinkLeft] = blinkValue;
            }
            if (eyeBlinkRight >= 0) {
                this.morphTargets.morphTargetInfluences[eyeBlinkRight] = blinkValue;
            }

            // End blink
            if (blinkPhase >= 1.0) {
                this.isBlinking = false;
            }
        }
    }

    updateLookAround(time, delta) {
        // Subtle eye/head movement to simulate looking around
        if (!this.avatar || !this.avatar.children[0]) return;

        // Update look target occasionally (every 3-8 seconds)
        if (time > this.nextLookTime) {
            this.lookTarget.x = (Math.random() - 0.5) * 0.03; // Small random look left/right
            this.lookTarget.y = (Math.random() - 0.5) * 0.02; // Small random look up/down
            this.nextLookTime = time + 3 + Math.random() * 5;
        }

        // Smooth interpolation to look target
        const lookSpeed = 0.5 * delta;
        this.currentLook.x += (this.lookTarget.x - this.currentLook.x) * lookSpeed;
        this.currentLook.y += (this.lookTarget.y - this.currentLook.y) * lookSpeed;

        // Apply subtle eye direction changes to head rotation (only when not speaking)
        // Only side-to-side, no up/down
        if (!this.isSpeaking && this.avatar.children[0]) {
            // Set rotation directly instead of adding to it to prevent "spinning"
            this.avatar.children[0].rotation.y = this.currentLook.x;
        }
    }

    findMorphTarget(names) {
        if (!this.morphTargets || !this.morphTargets.morphTargetDictionary) return -1;

        for (const name of names) {
            if (this.morphTargets.morphTargetDictionary[name] !== undefined) {
                return this.morphTargets.morphTargetDictionary[name];
            }
        }
        return -1;
    }

    setupChat() {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const chatMessages = document.getElementById('chatMessages');

        const sendMessage = async () => {
            const message = messageInput.value.trim();
            if (!message) return;

            // Add user message to chat
            this.addMessage(message, 'user');
            messageInput.value = '';
            sendButton.disabled = true;
            sendButton.innerHTML = `<div class="loading"></div>${this.t('statusThinking')}`;
            this.updateStatus(this.t('statusThinking'));

            try {
                // Send message to backend with session ID for memory
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message,
                        session_id: this.sessionId, // Send session ID to maintain conversation
                        preferred_language: this.currentLang, // Send user's selected language
                        username: this.username // Tie session to logged-in user
                    }),
                });

                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }

                const data = await response.json();

                // Store session ID from response for future messages
                if (data.session_id) {
                    this.sessionId = data.session_id;
                }

                // Add AI response to chat
                this.addMessage(data.response, 'ai');

                // Refresh sidebar to show new session
                this.loadHistory();

                // Play the speech with the response text for lip sync
                if (data.audioUrl) {
                    await this.playAudio(data.audioUrl, data.response);
                }

            } catch (error) {
                console.error('Error:', error);
                this.addMessage(this.t('errorMsg'), 'ai');
            } finally {
                sendButton.disabled = false;
                sendButton.textContent = this.t('sendBtn');
            }
        };

        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    addMessage(text, sender) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async playAudio(audioUrl, responseText) {
        return new Promise((resolve, reject) => {
            console.log('🎵 Playing audio:', audioUrl);

            // Store the response text for lip sync
            this.currentResponseText = responseText || '';

            // Create new audio element
            const audio = new Audio(audioUrl);
            this.currentAudio = audio;

            // Resume audio context if suspended (browser autoplay policy)
            if (this.audioContext && this.audioContext.state === 'suspended') {
                console.log('Resuming audio context...');
                this.audioContext.resume();
            }

            // Connect to Web Audio API for analysis (only if analyser exists)
            if (this.audioContext && this.audioAnalyser) {
                try {
                    const source = this.audioContext.createMediaElementSource(audio);
                    source.connect(this.audioAnalyser);
                    this.audioAnalyser.connect(this.audioContext.destination);
                    console.log('✅ Audio connected to analyser for lip sync');
                } catch (error) {
                    console.warn('Could not connect to analyser:', error);
                    // Continue playing audio even if analyser connection fails
                }
            }

            audio.onloadedmetadata = () => {
                console.log('📊 Audio metadata loaded');
                console.log('  Duration:', audio.duration.toFixed(2), 'seconds');
                // Pass audio duration to startSpeaking for accurate timing
                this.startSpeaking(audio.duration);
            };

            audio.onplay = () => {
                console.log('▶️ Audio playing');
            };

            audio.onended = () => {
                console.log('Audio ended');
                this.stopSpeaking();
                resolve();
            };

            audio.onerror = (error) => {
                console.error('❌ Audio error:', error);
                this.stopSpeaking();
                reject(error);
            };

            // Attempt to play
            audio.play().then(() => {
                console.log('✅ Audio playback started successfully');
            }).catch(err => {
                console.error('Play failed:', err);
                // Show user they need to interact first
                alert('Click anywhere on the page to enable audio, then try again.');
                reject(err);
            });
        });
    }

    startSpeaking(audioDuration) {
        this.isSpeaking = true;
        const container = document.getElementById('avatar-container');
        container.classList.add('speaking');
        this.updateStatus(this.t('statusSpeaking'));

        // Use text-based lip sync only for English, audio-driven for Persian/Hokkien/Yoruba
        const useTextLipSync = this.currentLang === 'en' && this.currentResponseText && this.lipsyncEngine;

        console.log(`🎙️ Language: ${this.currentLang} | Text-based lip sync: ${useTextLipSync ? 'YES' : 'NO (using audio-driven)'}`);

        // Convert text to viseme sequence using TalkingHead approach (English only)
        if (useTextLipSync) {
            const result = this.lipsyncEngine.wordsToVisemes(this.currentResponseText);

            console.log('📝 Text-to-Viseme conversion (TalkingHead method):');
            console.log('  Visemes:', result.visemes.slice(0, 10).join(', ') + '...');
            console.log('  Total visemes:', result.visemes.length);

            // Calculate total duration from viseme durations (in relative units)
            const totalRelativeDuration = result.durations.reduce((sum, d) => sum + d, 0);
            const scaleFactor = audioDuration
                ? (audioDuration * 1000) / totalRelativeDuration  // Convert to ms and scale
                : 100; // Fallback: 100ms per duration unit

            // TalkingHead-style coarticulation: Overlapping viseme envelopes
            // Formula: [time - 2*duration/3, time, time + 1.5*duration]
            this.visemeQueue = [];
            let cumulativeTime = 0;

            for (let i = 0; i < result.visemes.length; i++) {
                const duration = result.durations[i] * scaleFactor;
                const visemeCenter = cumulativeTime + duration / 2;

                // 3-point envelope for natural coarticulation
                this.visemeQueue.push({
                    name: result.visemes[i],
                    attackTime: visemeCenter - (2 * duration / 3),  // Start BEFORE peak
                    peakTime: visemeCenter,                          // Center
                    releaseTime: visemeCenter + (duration * 1.5),    // Extend AFTER
                    duration: duration
                });

                cumulativeTime += duration;
            }

            this.speechStartTime = performance.now();
            console.log('⏱️ Timing:', audioDuration ? audioDuration.toFixed(2) + 's' : 'estimated');
            console.log('🎯 Coarticulation: ✅ ENABLED (overlapping visemes)');
            console.log('  Example timing:', this.visemeQueue.slice(0, 2).map(v =>
                `${v.name}[${v.attackTime.toFixed(0)}→${v.peakTime.toFixed(0)}→${v.releaseTime.toFixed(0)}]`
            ).join(' '));
        }

        // Log lip sync status
        if (this.morphTargets) {
            if (useTextLipSync) {
                console.log('🎤 Lip sync: Text-to-viseme (English) with coarticulation');
            } else {
                console.log('🎤 Lip sync: Audio-driven (for ' + this.currentLang + ')');
            }
        } else {
            console.log('⚠️ Lip sync FALLBACK - no morph targets available');
        }
    }

    stopSpeaking() {
        this.isSpeaking = false;
        const container = document.getElementById('avatar-container');
        container.classList.remove('speaking');
        this.updateStatus(this.t('statusListening'));

        // Clear viseme queue
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
        this.currentResponseText = '';

        // Reset logging flags for next speech
        this.lipSyncLogged = false;
        this.morphTargetSetLogged = false;

        // Stop speaking animation (if any)
        if (this.speakingAnimation) {
            clearInterval(this.speakingAnimation);
            this.speakingAnimation = null;
        }

        // DON'T reset head rotation - let natural movement continue
        // (Head movement will be handled by continuous animation loop)

        // Reset mouth morph targets
        if (this.morphTargets && this.morphTargets.morphTargetInfluences) {
            for (let i = 0; i < this.morphTargets.morphTargetInfluences.length; i++) {
                this.morphTargets.morphTargetInfluences[i] = 0;
            }
            console.log('🔄 Reset all morph targets to 0');
        }
    }

    startNewChat() {
        console.log('🔄 Starting new chat...');
        this.sessionId = null;
        this.updateStatus(this.t('statusInit'));

        // Clear chat messages
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = `
                <div class="message ai-message" data-i18n="welcomeMessage">
                    ${this.t('welcomeMessage')}
                </div>
            `;
        }

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById("sidebar");
            const openBtn = document.getElementById("openSidebar");
            if (sidebar && openBtn) {
                sidebar.classList.remove("open");
                openBtn.style.display = "block";
            }
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Theme from LocalStorage
    const storedTheme = localStorage.getItem('avatar_theme');
    if (storedTheme === 'light') {
        document.body.classList.add('light-mode');
        const themeSelect = document.getElementById("themeSelect");
        if (themeSelect) themeSelect.value = 'light';
    }

    // 2. Initialize Avatar Assistant
    window.avatarInstance = new AvatarAssistant();
    console.log('💡 Debug: Access avatar instance via window.avatarInstance');

    // 3. Setup New Chat Button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (window.avatarInstance) {
                window.avatarInstance.startNewChat();
            }
        });
    }
});

// Sidebar Toggle Logic
document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const openBtn = document.getElementById("openSidebar");
    const closeBtn = document.getElementById("closeSidebar");

    openBtn.addEventListener("click", () => {
        sidebar.classList.add("open");
        openBtn.style.display = "none";
    });

    closeBtn.addEventListener("click", () => {
        sidebar.classList.remove("open");
        openBtn.style.display = "block";
    });
});

// Settings Modal Logic, Language & Theme Switcher
document.addEventListener("DOMContentLoaded", () => {
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsModal = document.getElementById("settingsModal");
    const closeSettings = document.getElementById("closeSettings");
    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    const languageSelect = document.getElementById("languageSelect");
    const themeSelect = document.getElementById("themeSelect"); // NEW

    if (settingsBtn && settingsModal && closeSettings) {
        settingsBtn.addEventListener("click", () => {
            settingsModal.style.display = "flex";
        });

        closeSettings.addEventListener("click", () => {
            settingsModal.style.display = "none";
        });

        window.addEventListener("click", (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = "none";
            }
        });

        // Handle Save Button
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener("click", () => {
                // 1. Handle Language
                if (languageSelect) {
                    setLanguage(languageSelect.value);
                }

                // 2. Handle Theme
                if (themeSelect) {
                    const theme = themeSelect.value;
                    if (theme === 'light') {
                        document.body.classList.add('light-mode');
                        localStorage.setItem('avatar_theme', 'light');
                    } else {
                        document.body.classList.remove('light-mode');
                        localStorage.setItem('avatar_theme', 'dark');
                    }
                    console.log("Theme set to:", theme);
                }

                // Close Modal
                settingsModal.style.display = "none";
            });
        }
    }
});
