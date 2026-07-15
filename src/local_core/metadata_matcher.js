const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
ffmpeg.setFfmpegPath(ffmpegStatic.replace('app.asar', 'app.asar.unpacked'));
ffmpeg.setFfprobePath(ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked'));

const { getProjectSources, getMetadata, saveMetadata } = require('../utils/file_system');
const path = require('path');
const fs = require('fs/promises');

function extractKieResponse(responseData) {
    let jsonObj = responseData;
    
    if (typeof responseData === 'string') {
        try {
            jsonObj = JSON.parse(responseData);
        } catch(e) {
            const lines = responseData.split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].startsWith('data: ')) {
                    try {
                        let parsed = JSON.parse(lines[i].substring(6).trim());
                        if (parsed.output || parsed.response) {
                            jsonObj = parsed;
                            break;
                        }
                    } catch(err2) {}
                }
            }
        }
    }

    if (jsonObj && jsonObj.code && jsonObj.msg) {
        throw new Error(`[Từ máy chủ Kie.ai]: ${jsonObj.msg}`);
    }

    const outArr = jsonObj?.output || jsonObj?.response?.output;
    if (!outArr || !Array.isArray(outArr)) {
        throw new Error("API Kie.ai không trả về mảng 'output' hợp lệ.");
    }
    
    // Ép AI trả đúng Final Answer
    const msg = outArr.slice().reverse().find(o => o.type === 'message' && o.phase === 'final_answer') || outArr.slice().reverse().find(o => o.type === 'message');
             
    if (!msg || !msg.content || !Array.isArray(msg.content)) {
        throw new Error("Không tìm thấy nội dung Text trong mảng 'output'.");
    }
    
    const textNode = msg.content.find(c => c.type === 'output_text');
    
    const credits = jsonObj?.credits_consumed || jsonObj?.response?.credits_consumed || 0;
    const tokens = jsonObj?.usage?.total_tokens || jsonObj?.response?.usage?.total_tokens || 0;

    return { 
        content: textNode ? textNode.text : "", 
        credits: credits,
        tokens: tokens 
    };
}

function getAudioDuration(audioPath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err || !metadata || !metadata.format) resolve(15); 
            else resolve(parseFloat(metadata.format.duration));
        });
    });
}

function getClipDuration(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err || !metadata || !metadata.format) resolve(3);
            else resolve(parseFloat(metadata.format.duration));
        });
    });
}

async function parseSrtFile(srtPath) {
    try {
        const content = await fs.readFile(srtPath, 'utf8');
        const blocks = content.replace(/\r/g, '').split('\n\n').filter(b => b.trim());
        const parsed = [];
        
        const timeToSec = (t) => {
            if (!t) return 0;
            const parts = t.split(':');
            if (parts.length !== 3) return 0;
            const [h, m, s_ms] = parts;
            const [s, ms] = s_ms.split(',');
            return (+h)*3600 + (+m)*60 + (+s) + (+ms)/1000;
        };

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const text = lines.slice(2).join(' ').trim();
                const [startStr, endStr] = timeLine.split(' --> ');
                
                parsed.push({
                    start: Number(timeToSec(startStr).toFixed(1)),
                    end: Number(timeToSec(endStr).toFixed(1)),
                    text: text
                });
            }
        }
        return parsed;
    } catch (err) {
        return [];
    }
}

async function buildTimeline(projectPath, scriptText, voicePath, srtPath, apiKey) {
    const sources = await getProjectSources(projectPath);
    const availableClips = [];
    
    // Nạp toàn bộ metadata
    for (const src of sources) {
        if (src.status === 'done') {
            const meta = await getMetadata(projectPath, src.fileName);
            const absPath = path.join(projectPath, '01_Source', src.fileName);
            const realDuration = await getClipDuration(absPath);
            
            availableClips.push({
                file: src.fileName,
                max_duration: Number(realDuration.toFixed(1)),
                usage_count: meta.usageCount || 0,
                main_content: meta.MainContent || meta.Description,
                purpose: meta.Purpose,
                action: meta.Action,     
                camera: meta.Camera,     
                tags: meta.Keyword       
            });
        }
    }

    if (availableClips.length === 0) {
        throw new Error("Dự án chưa có video nào được AI quét! Vui lòng quay lại Tab 1.");
    }

    // --- BỘ LỌC PHÁ VỠ THIÊN KIẾN VỊ TRÍ CỦA AI ---
    // Xáo trộn mảng ngẫu nhiên để AI không bao giờ thấy danh sách giống nhau ở 2 lần render
    availableClips.sort(() => Math.random() - 0.5);

    const audioDuration = await getAudioDuration(voicePath);
    const audioDurRounded = Number(audioDuration.toFixed(1));
    const srtData = await parseSrtFile(srtPath);

    // PROMPT CẮT CẢNH MỚI: VOICE-DRIVEN EDITING
    const prompt = `Bạn là Đạo diễn Video Cắt Cảnh (Master Video Editor). Tiêu chí số 1 của bạn là Hình ảnh phải KHỚP CHUẨN XÁC với Lời thoại đang phát ra.
    
    [TIMING VÀ NỘI DUNG TỪ FILE SRT (LỜI THOẠI VOICE ĐANG ĐỌC)]:
    ${JSON.stringify(srtData, null, 2)}
    
    [TỔNG THỜI LƯỢNG AUDIO YÊU CẦU ĐÚNG BẰNG]: ${audioDurRounded} giây.
    
    [TÀI NGUYÊN VIDEO CÓ SẴN CỦA BẠN]:
    ${JSON.stringify(availableClips, null, 2)}
    
    1. THỨ TỰ ƯU TIÊN CHỌN CẢNH (RẤT QUAN TRỌNG):
    - Ưu tiên 1 (CHỐNG TRÙNG LẶP): BẮT BUỘC ưu tiên bốc các clip có chỉ số "usage_count" = 0 hoặc thấp nhất. Tuyệt đối không "lười biếng" dùng đi dùng lại 1 clip cho nhiều video. Phải vắt kiệt toàn bộ tài nguyên clip đang có.
    - Ưu tiên 2: Khớp nội dung lời thoại (Voice nói gì, video chiếu nấy). Tìm clip có "tags", "action", "purpose" khớp với dòng SRT đang chạy.
    - Ưu tiên 3: Đúng tổng thời lượng bằng ${audioDurRounded}.
    - Ưu tiên 4: Không bao giờ vượt quá "max_duration" của clip gốc.

    2. QUY ĐỊNH VỀ ĐỘ DÀI CLIP (BÁM SÁT LỜI THOẠI):
    - VOICE-DRIVEN EDITING: Thời lượng (duration) của mỗi clip được ghép BẮT BUỘC phải bám sát theo thời lượng của từng câu thoại trong SRT.
    - Ví dụ: Dòng SRT số 1 nói về "xịt màn hình" kéo dài từ 0.0s đến 3.2s -> DURATION CẦN CHO CLIP ĐÓ LÀ 3.2s. Bạn KHÔNG ĐƯỢC tự ý cắt vụn thành 1.0s, 0.9s.
    - CHỈ CHIA NHỎ CÂU THOẠI KHI:
       + Clip bạn chọn không đủ dài (max_duration < duration cần thiết).
       + Hoặc câu thoại đó nói quá dài (trên 4.5 giây) thì bạn mới chia đôi thành 2 clip khác nhau để màn hình đỡ bị đơ.
    - ĐỘ DÀI TỐI THIỂU: Tuyệt đối hạn chế gán clip có duration quá ngắn (dưới 1.5 giây), trừ khi đoạn thoại thực sự rất nhanh. Cắt lắt nhắt 0.8s, 1.0s sẽ làm video bị chớp giật hỏng mắt người xem.
    
    3. QUY ĐỊNH CHO ĐẦU VÀ CUỐI VIDEO:
    - HOOK (Đoạn đầu): Dùng clip có chuyển động, thao tác (Action rõ ràng).
    - CTA (Đoạn cuối chốt sale): Dùng clip toàn cảnh, sản phẩm sạch sẽ, không tháo lắp.

    4. QUY ĐỊNH TẬN DỤNG TÀI NGUYÊN:
    - Bạn có thể tận dụng 1 clip có max_duration dài (VD: 9.5s) bằng cách lấy duration = 3.0s (tức là chỉ cắt 3s từ video đó).
    - Tối đa dùng 1 "file" 2 lần trong toàn bộ timeline. KHÔNG được đặt 1 file lặp lại liên tiếp.

    5. BƯỚC TỰ KIỂM TRA (SELF-CHECK TRƯỚC KHI TRẢ KẾT QUẢ):
    Trong suy nghĩ của bạn, hãy tự tính toán:
    ✔ Bạn đã chọn những clip có usage_count = 0 chưa?
    ✔ Có clip nào bị cắt quá vụn (0.8s, 1.0s) không? Nếu có, hãy gộp chúng lại cho đủ độ dài một câu nói.
    ✔ Hình ảnh đang chiếu có khớp với ý nghĩa của câu SRT đang phát không?
    ✔ Tổng tất cả duration cộng lại có đúng chính xác = ${audioDurRounded} không?
    ✔ Có clip nào gán duration > max_duration không?
    ✔ Có file nào đặt 2 lần liên tiếp không?
    Nếu vi phạm, tự sửa lại dữ liệu trước khi in ra kết quả cuối.

    ĐỊNH DẠNG ĐẦU RA (THIẾT QUÂN LUẬT):
    - CHỈ trả về DUY NHẤT một mảng JSON có thể parse được.
    - KHÔNG bọc trong thẻ Markdown (như \`\`\`json).
    - KHÔNG giải thích, KHÔNG bình luận, KHÔNG code block. Trả thẳng chuỗi JSON.
    
    MẪU CHUẨN KỲ VỌNG:
    {
      "timeline": [
         { "file": "Tên-file.mp4", "duration": 3.2 }
      ]
    }`;

    console.log(`[Matcher] Yêu cầu Kie.ai phân tích Xếp Timeline (Luật bám sát nhịp Voice)...`);
    const cleanKey = apiKey.trim();
    
    try {
        const payload = {
            model: "gpt-5-6-luna",
            input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
            reasoning: { effort: "high" }
        };

        const response = await axios.post('https://api.kie.ai/codex/v1/responses', payload, {
            headers: { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' }
        });

        let resObj = extractKieResponse(response.data);
        if (!resObj.content) throw new Error("AI trả về rỗng.");

        // Bộ lọc thép bóc tách JSON kể cả khi AI cứng đầu sinh markdown hoặc text nhiễu
        let cleanJSON = resObj.content.replace(/[\`]{3}json/gi, '').replace(/[\`]{3}/g, '').replace(/\u00A0/g, ' ').trim();
        const jsonMatch = cleanJSON.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleanJSON = jsonMatch[0];
        
        const data = JSON.parse(cleanJSON);
        
        // --- CẬP NHẬT TẦN SUẤT SỬ DỤNG CLIP ---
        // Sau khi ghép xong, +1 vào số lần sử dụng để các Video sau tránh bốc lại
        try {
            if (data.timeline && Array.isArray(data.timeline)) {
                for (const item of data.timeline) {
                    if (item.file) {
                        let meta = await getMetadata(projectPath, item.file);
                        if (meta) {
                            meta.usageCount = (meta.usageCount || 0) + 1;
                            await saveMetadata(projectPath, item.file, meta);
                        }
                    }
                }
            }
        } catch(e) {
            console.error("[Matcher] Lỗi cập nhật usageCount:", e.message);
        }
        
        return { timeline: data.timeline, credits: resObj.credits, tokens: resObj.tokens };
    } catch (error) {
        let errMsg = error.message;
        if (error.response && error.response.data) {
            errMsg = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data;
        }
        throw new Error("Lỗi thuật toán Timeline: " + errMsg);
    }
}

module.exports = { buildTimeline, getAudioDuration };