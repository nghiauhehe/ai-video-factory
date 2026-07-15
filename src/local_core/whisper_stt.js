// src/local_core/whisper_stt.js
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

async function extractAudioAndSTT(videoPath, apiKey) {
    // Tạo file âm thanh tạm dạng RAW PCM (Dữ liệu thô không nén)
    const tempAudioName = `temp_audio_${crypto.randomBytes(4).toString('hex')}.raw`;
    const tempAudioPath = path.join(os.tmpdir(), tempAudioName);

    try {
        console.log(`[FFmpeg Local] Đang trích xuất audio thô (16kHz, Mono, PCM) từ: ${videoPath}`);
        await new Promise((resolve, reject) => {
            // Ép FFmpeg xuất dữ liệu thô (Raw PCM 16-bit little-endian) để Node.js đọc thẳng
            ffmpeg(videoPath)
                .noVideo()
                .audioFrequency(16000)
                .audioChannels(1)
                .audioCodec('pcm_s16le')
                .format('s16le')
                .save(tempAudioPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`[AI Local] Đang nạp mô hình Whisper Offline...`);
        const { pipeline } = await import('@xenova/transformers');
        
        // Nạp mô hình ngôn ngữ
        const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
            quantized: true 
        });

        console.log(`[AI Local] Đang đọc dữ liệu âm thanh và chuyển đổi (Float32)...`);
        const pcmBuffer = await fs.readFile(tempAudioPath);
        
        // Cứ 2 bytes của 16-bit PCM sẽ gộp lại thành 1 giá trị Float
        const float32Audio = new Float32Array(pcmBuffer.length / 2);
        for (let i = 0; i < float32Audio.length; i++) {
            const int16 = pcmBuffer.readInt16LE(i * 2);
            float32Audio[i] = int16 / 32768.0;
        }

        console.log(`[AI Local] Bắt đầu bóc băng thành chữ...`);
        
        // THÊM CHUNKING: Cắt khúc 30s để AI không bị tràn bộ nhớ và sinh ra ảo giác
        const output = await transcriber(float32Audio, {
            language: 'vietnamese',
            task: 'transcribe',
            chunk_length_s: 30, 
            stride_length_s: 5  
        });

        const transcriptText = output.text ? output.text.trim() : "";

        // Dọn rác
        await fs.unlink(tempAudioPath).catch(e => console.error("Lỗi xóa file tạm:", e));
        
        // Bắt lỗi nếu video không có tiếng hoặc AI nhận diện lỗi
        if (!transcriptText || transcriptText.length < 10) {
            throw new Error("Whisper Local không nhận diện được giọng nói trong video (hoặc video chỉ có nhạc).");
        }
        
        return transcriptText;

    } catch (error) {
        // Dọn rác khi lỗi
        await fs.unlink(tempAudioPath).catch(() => {});
        throw new Error(`Lỗi STT Local: ${error.message}`);
    }
}

module.exports = { extractAudioAndSTT };