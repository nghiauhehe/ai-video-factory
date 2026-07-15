const axios = require('axios');

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
                        if (parsed.response || parsed.output) {
                            jsonObj = parsed;
                            break;
                        }
                    } catch(err2) {}
                }
            }
        }
    }

    if (jsonObj && jsonObj.choices && jsonObj.choices.length > 0) {
        const msg = jsonObj.choices[0].message;
        let text = "";
        if (msg.content) {
            if (typeof msg.content === 'string') text = msg.content;
            else if (Array.isArray(msg.content)) {
                const tNode = msg.content.find(c => c.type === 'text' || c.type === 'output_text');
                if (tNode) text = tNode.text;
            }
        }
        return { content: text, credits: 0, tokens: jsonObj.usage?.total_tokens || 0 };
    }

    const outArr = jsonObj?.response?.output || jsonObj?.output;
    if (!outArr || !Array.isArray(outArr)) return { content: "", credits: 0, tokens: 0 };
    
    const msg = outArr.slice().reverse().find(o => o.type === 'message' && o.phase === 'final_answer') 
             || outArr.slice().reverse().find(o => o.type === 'message');
             
    if (!msg || !msg.content) return { content: "", credits: 0, tokens: 0 };
    
    let text = "";
    if (typeof msg.content === 'string') {
        text = msg.content;
    } else if (Array.isArray(msg.content)) {
        const textNode = msg.content.find(c => c.type === 'output_text' || c.type === 'text');
        text = textNode ? textNode.text : "";
    }
    
    const credits = jsonObj?.credits_consumed || jsonObj?.response?.credits_consumed || 0;
    const tokens = jsonObj?.usage?.total_tokens || jsonObj?.response?.usage?.total_tokens || 0;

    return { content: text, credits: credits, tokens: tokens };
}

function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = new Set(str1.toLowerCase().split(/\s+/));
    const s2 = new Set(str2.toLowerCase().split(/\s+/));
    let intersect = 0;
    for (let w of s1) if (s2.has(w)) intersect++;
    const union = s1.size + s2.size - intersect;
    return union === 0 ? 0 : intersect / union;
}

async function generateNewScripts(apiKey, userPromptContent, historyText, count, productInfo, duration) {
    if (!apiKey) throw new Error("Chưa cấu hình API Key Kie.ai.");

    let targetWords = 100;
    if (duration === '60s') targetWords = 200;
    if (duration === '90s') targetWords = 320; 

    const systemPrompt = `
# VAI TRÒ
Bạn là một KOC Top 1 TikTok có doanh thu khủng, sở hữu khả năng storytelling đỉnh cao, ngôn từ đời thường, chân thực và cực kỳ cuốn hút. Bạn nhạy bén với trend và viết kịch bản rất tự nhiên.

# NHIỆM VỤ
Viết ${count} kịch bản video review sản phẩm.
- Độ dài kịch bản: Khoảng ${targetWords} từ (phù hợp thời lượng voice đọc vừa đủ ${duration}).

# THÔNG TIN SẢN PHẨM CẦN BÁN
- Tên SP: ${productInfo?.name || "Không rõ"}
- Công dụng cốt lõi: ${productInfo?.desc || "Không rõ"}

# YÊU CẦU NỘI DUNG VÀ VĂN PHONG TỪ ĐẠO DIỄN (CỰC QUAN TRỌNG)
Dưới đây là Prompt định hướng kịch bản. Hãy tuân thủ 100% phong cách, cách giật tít và tone giọng được yêu cầu ở đây:
"""
${userPromptContent || "Hãy tự do sáng tạo kịch bản hấp dẫn, bắt trend, kể chuyện tự nhiên để review sản phẩm này."}
"""

# QUY TẮC VIẾT LỜI THOẠI (THIẾT QUÂN LUẬT - ÉP BUỘC)
- Nhịp điệu và Dấu câu: BẮT BUỘC sử dụng dấu phẩy (,) và dấu chấm (.) để tạo nhịp ngắt nghỉ tự nhiên cho AI TTS lấy hơi. TUYỆT ĐỐI KHÔNG viết một lèo không dấu.
- Ký hiệu: KHÔNG dùng icon/emoji hay các ký tự lạ. (AI Voice không đọc được hình ảnh).
- Quy tắc chữ số: BẮT BUỘC viết tất cả các số bằng chữ (VD: "bảy trong một", "ba mươi giây").

# ĐỊNH DẠNG ĐẦU RA (JSON BẮT BUỘC)
Trả về duy nhất định dạng mảng JSON sau, KHÔNG kèm giải thích bên ngoài:
{
  "scripts": [
    {
      "angle": "Tên góc nhìn / Ý tưởng chính",
      "content": "Lời thoại hoàn chỉnh...",
      "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"]
    }
  ]
}
- LƯU Ý VỀ KEYWORDS (CẤM SAI LỆCH): Hãy phân tích và BỐC CHÍNH XÁC (COPY/PASTE) 2-4 CỤM TỪ ĐÃ VIẾT TRONG KỊCH BẢN (content) để làm từ khóa chốt sale. TUYỆT ĐỐI KHÔNG tự bịa ra từ khóa, không viết tắt, không thêm số, không bớt chữ nếu nó không có trong lời thoại. Phải Viết chính xác từng chữ, từng khoảng trắng để hệ thống có thể Highlight khớp với video.
    `.trim();

    try {
        const payload = {
            model: "gpt-5-6-luna",
            input: [{ role: "user", content: [{ type: "input_text", text: systemPrompt }] }],
            reasoning: { effort: "high" }
        };

        const historyArray = historyText ? historyText.split('\n---\n').filter(h => h.trim().length > 0) : [];
        
        let finalScripts = [];
        let totalCredits = 0;
        let totalTokens = 0;
        
        let attempt = 0;
        // Tăng số lần thử lên 5 lần vì mốc 30% rất dễ bị vi phạm (do các từ nối giống nhau)
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
            const response = await axios.post('https://api.kie.ai/codex/v1/responses', payload, {
                headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' }
            });

            let resObj = extractKieResponse(response.data);
            if (!resObj.content) throw new Error("API Kie.ai trả về chuỗi rỗng.");

            let cleanJSON = resObj.content.replace(/```json/gi, '').replace(/```/g, '').trim();
            cleanJSON = cleanJSON.replace(/[\u00A0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]/g, ' ');
            const jsonMatch = cleanJSON.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleanJSON = jsonMatch[0];

            let parsedJSON;
            try {
                parsedJSON = JSON.parse(cleanJSON);
            } catch(e) {
                throw new Error("AI trả về sai định dạng JSON. Vui lòng tạo lại.");
            }
            
            if (parsedJSON.scripts && Array.isArray(parsedJSON.scripts) && parsedJSON.scripts.length > 0) {
                let scriptObj = parsedJSON.scripts[0];
                let scriptContent = typeof scriptObj === 'object' ? scriptObj.content : scriptObj;
                
                let isDuplicate = false;
                if (historyArray.length > 0) {
                    for (const oldText of historyArray) {
                        const sim = calculateSimilarity(scriptContent, oldText);
                        // FIX: Đổi ngưỡng trùng lặp từ 0.8 (80%) xuống 0.3 (30%) theo yêu cầu
                        if (sim > 0.3) { 
                            isDuplicate = true;
                            console.log(`[AI Local Check] Kịch bản bị trùng lặp ${Math.round(sim * 100)}% (Vượt ngưỡng 30%). Đang ép AI tạo lại (Lần ${attempt + 1}/${maxAttempts})...`);
                            break;
                        }
                    }
                }

                totalCredits += resObj.credits;
                totalTokens += resObj.tokens;

                if (!isDuplicate || attempt === maxAttempts - 1) {
                    finalScripts = parsedJSON.scripts.map(s => {
                        if (typeof s === 'object' && s.content) {
                            return {
                                content: s.content,
                                keywords: Array.isArray(s.keywords) ? s.keywords : []
                            };
                        }
                        if (typeof s === 'string') {
                            return { content: s, keywords: [] };
                        }
                        return null;
                    }).filter(s => s !== null);
                    break;
                }
            } else {
                throw new Error("AI không tạo được kịch bản hợp lệ.");
            }
            attempt++;
        }

        if(finalScripts.length === 0) throw new Error("AI không tạo được kịch bản hợp lệ.");
        
        return { scripts: finalScripts, credits: totalCredits, tokens: totalTokens };
    } catch (error) {
        throw new Error("Lỗi khi sinh kịch bản: " + (error.response?.data?.error?.message || error.message));
    }
}

module.exports = { generateNewScripts };