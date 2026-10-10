const express = require("express");
const router = express.Router();

const SARVAM_TTS_ENDPOINT = "https://api.sarvam.ai/text-to-speech";

// In-memory cache to prevent re-generating TTS audio for identical text sections
const ttsCache = new Map();
const MAX_CACHE_ENTRIES = 100;

/**
 * POST /api/tts
 * Accepts JSON: { text: "Text to speak", target_language_code?: "en-IN", speaker?: "meera" }
 * Returns base64 encoded audio playable in browser
 */
router.post("/tts", async (req, res) => {
  try {
    const apiKey = process.env.SARVAM_API_KEY;
    const { text, target_language_code = "en-IN", speaker = "simran_en_narration", model = "bulbul:v4-flash" } = req.body;

    // 1. Validate API Key
    if (!apiKey || apiKey === "your_sarvam_api_key_here") {
      console.error("[Backend TTS] SARVAM_API_KEY missing or unconfigured in .env");
      return res.status(500).json({
        success: false,
        error: "Sarvam API key is not configured in backend .env file."
      });
    }

    // 2. Validate input text
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid text provided for text-to-speech synthesis."
      });
    }

    const cleanText = text.trim();

    // 3. Check in-memory cache
    const cacheKey = `${cleanText}_${target_language_code}_${speaker}_${model}`;
    if (ttsCache.has(cacheKey)) {
      console.log(`[Backend TTS] Cache hit for text: "${cleanText.slice(0, 30)}..."`);
      return res.json({
        success: true,
        audio_base64: ttsCache.get(cacheKey),
        cached: true
      });
    }

    console.log(`[Backend TTS] Requesting Sarvam TTS for text: "${cleanText.slice(0, 35)}..." (${cleanText.length} chars)`);

    // 4. Request Sarvam TTS API
    // Bulbul model options: 'bulbul:v1'
    const payload = {
      inputs: [cleanText],
      target_language_code: target_language_code,
      speaker: speaker,
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: model
    };

    const response = await fetch(SARVAM_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    const status = response.status;
    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }

    if (!response.ok) {
      console.error(`[Backend TTS] Sarvam API returned error status ${status}:`, responseText);
      let errorMsg = data.detail || data.message || responseText || "Sarvam TTS error.";
      if (status === 401) errorMsg = "Sarvam API authentication failed. Check your SARVAM_API_KEY in .env.";

      return res.status(status).json({
        success: false,
        error: errorMsg,
        statusCode: status
      });
    }

    // 5. Extract base64 audio array
    if (!data.audios || !data.audios[0]) {
      throw new Error("Sarvam TTS response did not include audio content.");
    }

    const audioBase64 = data.audios[0];

    // Store in cache (limit cache size)
    if (ttsCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = ttsCache.keys().next().value;
      ttsCache.delete(firstKey);
    }
    ttsCache.set(cacheKey, audioBase64);

    return res.json({
      success: true,
      audio_base64: audioBase64,
      cached: false
    });

  } catch (error) {
    console.error("[Backend TTS] Error in /api/tts:", error);
    return res.status(500).json({
      success: false,
      error: `Server internal error during TTS: ${error.message}`
    });
  }
});

module.exports = router;
