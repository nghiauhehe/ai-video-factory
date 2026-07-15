// src/services/larvoice.js
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { processSRT } = require('./srt_processor');

async function getVoices(apiKey) {
    if (!apiKey) throw new Error("Chưa có API Key LarVoice.");
    try {
        const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();
        const response = await axios.get('https://larvoice.com/api/v1/voices?voice_type=all&language=vi&limit=50', {
            headers: { 'Authorization': `Bearer ${cleanKey}` }
        });
        
        return response.data?.data?.voices || [];
    } catch (error) {
        throw new Error("Không thể tải danh sách giọng. Hãy kiểm tra lại API Key.");
    }
}

async function generateVoiceFile(text, voiceId, speed, vol, pitch, apiKey, outputDir) {
    if (!apiKey) throw new Error("Chưa có API Key LarVoice.");
    
    try {
        const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();

        const response = await axios.post(
            'https://larvoice.com/api/v1/tts',
            {
              "voice_id": voiceId || "1",
              "voice_type": "public",
              "language": "vi",
              "post_speed": parseFloat(speed) || 1,
              "post_volume": parseFloat(vol) || 0,
              "post_pitch": parseFloat(pitch) || 1,
              "return_srt": true,
              "sentence_pause_ms": 350,
              "line_break_pause_ms": 350,
              "ellipsis_pause_ms": 350,
              "gen_text": text
            },
            { headers: { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' } }
        );

        const resData = response.data;
        if (!resData.data || !resData.data.output_url || !resData.data.aligned_srt_url) {
            throw new Error("LarVoice trả về thiếu dữ liệu Audio hoặc SRT.");
        }

        const randomHex = crypto.randomBytes(4).toString('hex');
        const audioFilePath = path.join(outputDir, `larvoice_${randomHex}.wav`);
        const srtFilePath = path.join(outputDir, `larvoice_${randomHex}.srt`);
        
        await fs.mkdir(outputDir, { recursive: true });

        const audioReq = await axios.get(resData.data.output_url, { responseType: 'arraybuffer' });
        await fs.writeFile(audioFilePath, audioReq.data);

        const srtReq = await axios.get(resData.data.aligned_srt_url, { responseType: 'text' });
        await fs.writeFile(srtFilePath, srtReq.data, 'utf8');
        
        await processSRT(srtFilePath);
        
        return { filePath: audioFilePath, srtPath: srtFilePath, usage: text.length };

    } catch (error) {
        let errorMsg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
        throw new Error(`API LarVoice từ chối: ${errorMsg}`);
    }
}

module.exports = { generateVoiceFile, getVoices };