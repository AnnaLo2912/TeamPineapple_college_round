const express = require("express");
const multer = require("multer");

const router = express.Router();

// Memory storage to ensure audio files are held in memory only and never stored permanently on disk
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max size
  }
});

const SARVAM_STT_ENDPOINT = "https://api.sarvam.ai/speech-to-text";

/**
 * POST /api/transcribe
 * Accepts audio file via multipart form-data ('file' field)
 * Forwards audio to Sarvam AI STT service and returns transcript
 */
router.post("/transcribe", upload.single("file"), async (req, res) => {
  try {
    const apiKey = process.env.SARVAM_API_KEY;

    // 1. Validate API Key configuration
    if (!apiKey || apiKey === "your_sarvam_api_key_here") {
      console.error("[Backend] SARVAM_API_KEY missing or unconfigured in .env");
      return res.status(500).json({
        success: false,
        error: "Sarvam API key is not configured in backend .env file. Please add your SARVAM_API_KEY."
      });
    }

    // 2. Validate incoming audio file
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      console.error("[Backend] No audio file or empty file received");
      return res.status(400).json({
        success: false,
        error: "No valid audio file uploaded or audio content was empty."
      });
    }

    console.log(`[Backend] Received audio upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB, type: ${req.file.mimetype})`);

    // 3. Prepare FormData payload for Sarvam STT API
    const formData = new FormData();
    const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" });
    
    // Attach audio file
    formData.append("file", audioBlob, req.file.originalname || "recording.webm");
    
    // Model configuration (saaras:v3 is current Sarvam AI STT model)
    const modelName = req.body.model || "saaras:v3";
    formData.append("model", modelName);

    // Language code (defaults to en-IN to prevent non-English script hallucinations like Gujarati 'છે.')
    const langCode = req.body.language_code || "en-IN";
    formData.append("language_code", langCode);

    // 4. Send request to Sarvam STT Endpoint
    console.log(`[Backend] Forwarding audio to Sarvam AI API (${SARVAM_STT_ENDPOINT})...`);

    const sarvamResponse = await fetch(SARVAM_STT_ENDPOINT, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey
      },
      body: formData
    });

    const responseStatus = sarvamResponse.status;
    const responseText = await sarvamResponse.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }

    // 5. Handle Sarvam API Errors
    if (!sarvamResponse.ok) {
      console.error(`[Backend] Sarvam API returned error status ${responseStatus}:`, data);

      let userErrorMsg = "Sarvam STT service error.";
      if (responseStatus === 401) {
        userErrorMsg = "Sarvam API authentication failed. Check your SARVAM_API_KEY in .env.";
      } else if (responseStatus === 400) {
        userErrorMsg = data.detail || data.message || "Invalid audio format or parameters sent to Sarvam.";
      } else if (responseStatus === 429) {
        userErrorMsg = "Sarvam API rate limit reached. Please try again in a moment.";
      } else if (data.detail) {
        userErrorMsg = data.detail;
      }

      return res.status(responseStatus).json({
        success: false,
        error: userErrorMsg,
        statusCode: responseStatus
      });
    }

    // 6. Extract transcript from response
    // Sarvam API returns { transcript: "...", language_code: "..." }
    const transcript = data.transcript || data.text || "";
    
    console.log(`[Backend] Sarvam STT successful transcript: "${transcript}"`);

    return res.json({
      success: true,
      transcript: transcript,
      language_code: data.language_code || "unknown"
    });

  } catch (error) {
    console.error("[Backend] Error in /api/transcribe:", error);
    return res.status(500).json({
      success: false,
      error: `Server internal error during transcription: ${error.message}`
    });
  }
});

module.exports = router;
