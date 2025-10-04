/**
 * English Syllable-Based Lip Sync Engine
 * Natural speech animation using syllable rhythm (not phoneme-by-phoneme)
 */

class LipsyncEn {
    constructor() {
        // Vowel patterns - these are the CORE of each syllable
        this.vowelPatterns = {
            // Long A sounds
            'AI': 'E', 'AY': 'E', 'A_E': 'E',
            // Long E sounds  
            'EE': 'I', 'EA': 'I', 'E_E': 'I',
            // Long I sounds
            'IGH': 'I', 'I_E': 'I', 'IE': 'I',
            // Long O sounds
            'OA': 'O', 'OW': 'O', 'O_E': 'O', 'OU': 'O',
            // Long U sounds
            'OO': 'U', 'U_E': 'U', 'UE': 'U',
            // Short vowels (default)
            'A': 'aa', 'E': 'E', 'I': 'I', 'O': 'O', 'U': 'U'
        };
        
        // Consonant clusters that affect mouth shape
        this.consonantShapes = {
            'PP': ['P', 'B', 'M'],           // Lips closed
            'FF': ['F', 'V'],                 // Lip-teeth
            'TH': ['TH'],                     // Tongue-teeth
            'SS': ['S', 'Z', 'SH', 'CH'],    // Sibilants
            'DD': ['T', 'D', 'N'],           // Tongue-alveolar
            'kk': ['K', 'G', 'C', 'Q'],      // Back throat
            'nn': ['L', 'N'],                // Tongue tip
            'RR': ['R']                       // R-colored
        };
        
        // Syllable duration weights (relative)
        this.syllableWeights = {
            'stressed': 1.2,    // Stressed syllables longer
            'unstressed': 0.8,  // Unstressed shorter
            'final': 1.5        // Final syllable longest
        };
    }

    /**
     * Split text into syllables and convert to viseme sequence
     * @param {string} text - Input text
     * @returns {Object} Syllables with visemes and timing
     */
    wordsToVisemes(text) {
        const words = text.toUpperCase().split(/\s+/);
        const syllables = [];
        
        // Process each word into syllables
        words.forEach((word, wordIndex) => {
            const wordSyllables = this.splitIntoSyllables(word);
            const isLastWord = wordIndex === words.length - 1;
            
            wordSyllables.forEach((syllable, sylIndex) => {
                const isLastSyllable = isLastWord && sylIndex === wordSyllables.length - 1;
                const viseme = this.syllableToViseme(syllable);
                
                syllables.push({
                    text: syllable,
                    viseme: viseme,
                    duration: this.getSyllableDuration(syllable, isLastSyllable),
                    stressed: sylIndex === 0 || wordSyllables.length === 1
                });
            });
            
            // Add brief pause between words
            if (!isLastWord) {
                syllables.push({
                    text: ' ',
                    viseme: 'sil',
                    duration: 0.3,
                    stressed: false
                });
            }
        });
        
        // Build timeline
        let time = 0;
        const result = {
            words: text.toUpperCase(),
            visemes: [],
            times: [],
            durations: []
        };
        
        syllables.forEach(syl => {
            result.visemes.push(syl.viseme);
            result.times.push(time);
            result.durations.push(syl.duration);
            time += syl.duration;
        });
        
        return result;
    }

    /**
     * Split word into syllables (simple heuristic)
     */
    splitIntoSyllables(word) {
        if (word.length <= 3) return [word];
        
        const syllables = [];
        const vowels = 'AEIOU';
        let currentSyllable = '';
        
        for (let i = 0; i < word.length; i++) {
            const char = word[i];
            const isVowel = vowels.includes(char);
            const nextIsVowel = i < word.length - 1 && vowels.includes(word[i + 1]);
            
            currentSyllable += char;
            
            // Split after vowel if next is consonant
            if (isVowel && !nextIsVowel && currentSyllable.length >= 2) {
                // Look ahead for consonant cluster
                let consonantCount = 0;
                for (let j = i + 1; j < word.length && !vowels.includes(word[j]); j++) {
                    consonantCount++;
                }
                
                // Split after vowel, or after first consonant in cluster
                if (consonantCount > 0) {
                    if (consonantCount === 1 && i < word.length - 2) {
                        syllables.push(currentSyllable);
                        currentSyllable = '';
                    } else if (consonantCount > 1 && i < word.length - 3) {
                        currentSyllable += word[i + 1]; // Include one consonant
                        syllables.push(currentSyllable);
                        currentSyllable = '';
                        i++; // Skip the consonant we just added
                    }
                }
            }
        }
        
        if (currentSyllable) {
            syllables.push(currentSyllable);
        }
        
        return syllables.length > 0 ? syllables : [word];
    }

    /**
     * Convert syllable to dominant viseme
     */
    syllableToViseme(syllable) {
        // Find the vowel (core of syllable)
        const vowels = 'AEIOU';
        let vowel = null;
        let vowelIndex = -1;
        
        // Check for vowel digraphs first
        for (let pattern in this.vowelPatterns) {
            if (pattern.length > 1 && syllable.includes(pattern)) {
                return this.vowelPatterns[pattern];
            }
        }
        
        // Find single vowel
        for (let i = 0; i < syllable.length; i++) {
            if (vowels.includes(syllable[i])) {
                vowel = syllable[i];
                vowelIndex = i;
                break;
            }
        }
        
        if (!vowel) {
            // No vowel - check for consonant-only syllable
            const firstChar = syllable[0];
            for (let shape in this.consonantShapes) {
                if (this.consonantShapes[shape].includes(firstChar)) {
                    return shape;
                }
            }
            return 'sil';
        }
        
        // Return vowel viseme
        return this.vowelPatterns[vowel] || 'aa';
    }

    /**
     * Get syllable duration based on content
     */
    getSyllableDuration(syllable, isFinal = false) {
        const baseLength = syllable.length;
        let duration = 0.8; // Base duration
        
        // Longer syllables take more time
        if (baseLength > 4) duration = 1.2;
        else if (baseLength > 2) duration = 1.0;
        else duration = 0.8;
        
        // Final syllables are longer
        if (isFinal) {
            duration *= this.syllableWeights.final;
        }
        
        return duration;
    }

    /**
     * Preprocess text (remove special chars)
     */
    preProcessText(text) {
        return text
            .toUpperCase()
            .replace(/[^A-Z\s]/g, '');
    }
}

// Make available globally
window.LipsyncEn = LipsyncEn;
