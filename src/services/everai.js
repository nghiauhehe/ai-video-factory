// src/services/everai.js
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { processSRT } = require('./srt_processor');

async function generateEverAIVoice(text, voiceId, speed, vol, pitch, apiKey, outputDir) {
    if (!apiKey) throw new Error("Chưa có API Key EverAI.");
    const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();

    try {
        const initResponse = await axios.post(
            'https://www.everai.vn/api/v1/tts',
            {
                response_type: "indirect",
                input_text: text,
                voice_code: voiceId || "vi_female_kieunhi_mn",
                audio_type: "mp3",
                bitrate: 128,
                speed_rate: parseFloat(speed) || 1.0,
                pitch_rate: parseFloat(pitch) || 1.0,
                generate_srt: true 
            },
            { headers: { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' } }
        );

        if (initResponse.data.status !== 1) {
            throw new Error(`[Từ máy chủ EverAI]: ${initResponse.data.error_message || "Từ chối request"}`);
        }

        const reqId = initResponse.data.result.request_id;
        if (!reqId) throw new Error("Không nhận được Request ID từ EverAI");

        let isDone = false;
        let audioUrl = "";
        let srtUrl = "";
        let retryCount = 0;

        while (!isDone) {
            if(retryCount > 60) throw new Error("Timeout: EverAI xử lý quá lâu (hơn 2 phút).");
            await new Promise(r => setTimeout(r, 2000)); 
            
            const checkRes = await axios.get(`https://www.everai.vn/api/v1/tts/${reqId}`, {
                headers: { 'Authorization': `Bearer ${cleanKey}` }
            });

            if (checkRes.data.status === 1) {
                const reqStatus = checkRes.data.result.status;
                if (reqStatus === 'done' || reqStatus === 'SUCCESS') {
                    audioUrl = checkRes.data.result.audio_link;
                    srtUrl = checkRes.data.result.srt_link;
                    isDone = true;
                } else if (reqStatus === 'FAILURE' || reqStatus === 'error') {
                    throw new Error("[Từ máy chủ EverAI]: Quá trình sinh Audio bị lỗi.");
                }
            }
            retryCount++;
        }

        if(!audioUrl || !srtUrl) throw new Error("EverAI không trả về Link tải.");

        const randomHex = crypto.randomBytes(4).toString('hex');
        const audioFilePath = path.join(outputDir, `everai_${randomHex}.mp3`);
        const srtFilePath = path.join(outputDir, `everai_${randomHex}.srt`);
        
        await fs.mkdir(outputDir, { recursive: true });

        const audioReq = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(audioFilePath, audioReq.data);

        const srtReq = await axios.get(srtUrl, { responseType: 'text' });
        await fs.writeFile(srtFilePath, srtReq.data, 'utf8');
        
        await processSRT(srtFilePath);
        
        const charsUsed = text.length;
        return { filePath: audioFilePath, srtPath: srtFilePath, usage: charsUsed };

    } catch (error) {
        let errorMsg = error.response?.data ? (error.response.data.error_message || JSON.stringify(error.response.data)) : error.message;
        throw new Error(`API EverAI lỗi: ${errorMsg}`);
    }
}

module.exports = { generateEverAIVoice };