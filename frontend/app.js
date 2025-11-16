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
        
        // Text-to-viseme lip sync system
        this.lipsyncEngine = new LipsyncEn();
        this.visemeQueue = [];
        this.currentVisemeIndex = 0;
        this.visemeStartTime = 0;
        this.currentResponseText = '';
        
        this.init();
        this.setupChat();
        this.setupAudioContext();
    }

    init() {
        const container = document.getElementById('avatar-container');
        
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);

        // Camera setup - Closer for headshot view
        this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 1.65, 0.5); // Much closer - headshot distance

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // Load avatar
        this.loadAvatar();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        // Start render loop
        this.animate();
    }

    loadAvatar() {
        const loader = new THREE.GLTFLoader();
        
        // Ready Player Me API - Request avatar with morph targets
        // Documentation: https://docs.readyplayer.me/ready-player-me/api-reference/rest-api/avatars/get-3d-avatars
        // Options: "ARKit", "Oculus Visemes", or both "ARKit,Oculus Visemes"
        
        // Using ARKit which includes: jawOpen, mouthOpen, mouthSmile, etc.
        // AND Oculus Visemes for better lip sync
        const avatarUrl = 'https://models.readyplayer.me/68dfbe6efedc24530045d33f.glb?morphTargets=ARKit,Oculus%20Visemes&lod=0&textureAtlas=none';
        
        console.log('🔄 Loading avatar with morph targets from:', avatarUrl);
        this.updateStatus('Loading your avatar...');
        
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

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        
        // Update animations
        if (this.mixer) {
            this.mixer.update(delta);
        }

        // Continuous human-like movements (both idle and speaking)
        if (this.avatar && !this.isLoading) {
            const time = this.clock.getElapsedTime();
            
            // Breathing animation (always active)
            this.avatar.position.y = Math.sin(time * 1.8) * 0.008; // Slightly slower, more subtle
            
            // Natural head movements (always active)
            if (this.avatar.children[0]) {
                // Gentle head sway
                this.avatar.children[0].rotation.y = Math.sin(time * 0.4) * 0.04;
                
                // Slight head tilt variation
                this.avatar.children[0].rotation.z = Math.sin(time * 0.3) * 0.02;
                
                // Very subtle head nod
                this.avatar.children[0].rotation.x = Math.sin(time * 0.6) * 0.015;
                
                // Additional speaking gestures when talking
                if (this.isSpeaking) {
                    // Slight forward lean when speaking
                    this.avatar.children[0].rotation.x += Math.sin(time * 2.5) * 0.01;
                    
                    // More expressive head movement during speech
                    this.avatar.children[0].rotation.y += Math.sin(time * 1.2) * 0.02;
                }
            }
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
        if (!this.morphTargets || this.visemeQueue.length === 0) {
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
            sendButton.innerHTML = '<div class="loading"></div>Thinking...';

            try {
                // Send message to backend with session ID for memory
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        message,
                        session_id: this.sessionId // Send session ID to maintain conversation
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
                
                // Play the speech with the response text for lip sync
                if (data.audioUrl) {
                    await this.playAudio(data.audioUrl, data.response);
                }

            } catch (error) {
                console.error('Error:', error);
                this.addMessage('Sorry, I encountered an error. Please try again.', 'ai');
            } finally {
                sendButton.disabled = false;
                sendButton.textContent = 'Send';
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
        this.updateStatus('Speaking...');
        
        // Convert text to viseme sequence using TalkingHead approach
        if (this.currentResponseText && this.lipsyncEngine) {
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
            console.log('🎤 Lip sync ACTIVE - using text-to-viseme with coarticulation');
        } else {
            console.log('⚠️ Lip sync FALLBACK - no morph targets available');
        }
    }

    stopSpeaking() {
        this.isSpeaking = false;
        const container = document.getElementById('avatar-container');
        container.classList.remove('speaking');
        this.updateStatus('Listening...');
        
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
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.avatarInstance = new AvatarAssistant();
    console.log('💡 Debug: Access avatar instance via window.avatarInstance');
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

// Settings Modal Logic
document.addEventListener("DOMContentLoaded", () => {
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const closeSettings = document.getElementById("closeSettings");

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
  }
});