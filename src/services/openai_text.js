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
                        if (parsed.response || parsed.output || parsed.choices) {
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
        return { content: text, credits: jsonObj.credits_consumed || 0, tokens: jsonObj.usage?.total_tokens || 0 };
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
    const s1 = new Set(str1.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(/\s+/));
    const s2 = new Set(str2.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(/\s+/));
    let intersect = 0;
    for (let w of s1) if (s2.has(w)) intersect++;
    const union = s1.size + s2.size - intersect;
    return union === 0 ? 0 : intersect / union;
}

const fs = require('fs/promises');
const path = require('path');

async function generateNewScripts(apiKey, userPromptContent, historyData, count, productInfo, duration, projectPath = null) {
    if (!apiKey) throw new Error("Chưa cấu hình API Key Kie.ai.");

    let targetWords = 100;
    if (duration === '60s') targetWords = 200;
    if (duration === '90s') targetWords = 320; 

    // Đọc dữ liệu lịch sử Góc nhìn (Angle) để tiết kiệm token
    let anglesStr = "";
    let historyContents = [];
    if (typeof historyData === 'object') {
        anglesStr = historyData.anglesStr || "";
        historyContents = historyData.contents || [];
    } else if (typeof historyData === 'string') {
        anglesStr = historyData; 
    }

    let historyInstruction = "";
    if (anglesStr && anglesStr.trim().length > 0) {
        historyInstruction = `
# LỊCH SỬ CÁC GÓC NHÌN ĐÃ SỬ DỤNG (CẤM TRÙNG LẶP)
Dưới đây là các Góc nhìn (Angle) / Nỗi đau khách hàng mà bạn đã dùng trước đó. 
YÊU CẦU TỐI THƯỢNG: Bạn phải tìm ra một "Góc nhìn" hoặc "Vấn đề" HOÀN TOÀN MỚI, KHÔNG ĐƯỢC NẰM TRONG DANH SÁCH DƯỚI ĐÂY.
"""
${anglesStr}
"""
`;
    }

    const baseSystemPrompt = `
# VAI TRÒ
Bạn là một KOC Top 1 TikTok có doanh thu khủng, sở hữu khả năng storytelling đỉnh cao, ngôn từ đời thường, chân thực và cực kỳ cuốn hút.

# NHIỆM VỤ
Viết ${count} kịch bản video review sản phẩm.
- Độ dài: Khoảng ${targetWords} từ (vừa đủ ${duration}).

# THÔNG TIN SẢN PHẨM CẦN BÁN
- Tên SP: ${productInfo?.name || "Không rõ"}
- Công dụng cốt lõi: ${productInfo?.desc || "Không rõ"}
${historyInstruction}
# YÊU CẦU NỘI DUNG TỪ ĐẠO DIỄN
"""
${userPromptContent || "Hãy tự do sáng tạo kịch bản hấp dẫn, bắt trend, kể chuyện tự nhiên."}
"""

# QUY TẮC VIẾT LỜI THOẠI (BẮT BUỘC)
- Nhịp điệu và Dấu câu: BẮT BUỘC sử dụng dấu phẩy (,) và dấu chấm (.) để tạo nhịp ngắt nghỉ tự nhiên cho AI TTS.
- Ký hiệu: KHÔNG dùng icon/emoji.
- Quy tắc chữ số: Viết số bằng chữ (VD: "bảy trong một").

# ĐỊNH DẠNG ĐẦU RA (JSON BẮT BUỘC)
Trả về duy nhất định dạng mảng JSON sau:
{
  "scripts": [
    {
      "angle": "Tóm tắt Góc nhìn / Ý tưởng / Nỗi đau của kịch bản này (Siêu ngắn gọn, VD: Review đập hộp / So sánh giá rẻ...)",
      "content": "Lời thoại hoàn chỉnh...",
      "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"]
    }
  ]
}
- LƯU Ý VỀ KEYWORDS: COPY/PASTE chính xác 2-4 cụm từ đã viết trong content để làm từ khóa.
    `.trim();

    let finalScripts = [];
    let totalCredits = 0;
    let totalTokens = 0;
    
    let attempt = 0;
    const maxAttempts = 5;
    
    // Biến lưu trữ lịch sử lỗi để Feedback ngược cho AI
    let lastRejectedScript = "";
    let maxSimilarityScore = 0;

    while (attempt < maxAttempts) {
        
        // NẾU LÀ LẦN THỬ LẠI (TỪ LẦN 2 TRỞ ĐI): BƠM THÊM PROMPT PHẢN HỒI (FEEDBACK LOOP)
        let currentPrompt = baseSystemPrompt;
        if (attempt > 0 && lastRejectedScript) {
            const correctionPrompt = `

=== 🛑 LỆNH CHỈNH SỬA KHẨN CẤP TỪ ĐẠO DIỄN (LẦN THỬ ${attempt + 1}) 🛑 ===
CẢNH BÁO: Kịch bản bạn vừa viết bị từ chối vì ĐỘ TRÙNG LẶP LÊN TỚI ${maxSimilarityScore}% so với các video cũ!

[KỊCH BẢN BỊ TỪ CHỐI DO QUÁ NHÀM CHÁN]:
"""
${lastRejectedScript}
"""

YÊU CẦU ÉP BUỘC ĐỂ KHẮC PHỤC TRÙNG LẶP CHO LẦN NÀY:
- Sáng tạo một Hook (Câu mở đầu) HOÀN TOÀN MỚI LẠ.
- Thay đổi triệt để bối cảnh, Insight (nỗi đau) và tệp khách hàng mục tiêu. Đừng dùng lại bối cảnh cũ.
- Không lặp lại các từ vựng, tính từ miêu tả đã dùng ở bản nháp trên.
- Đổi mới cấu trúc kêu gọi hành động (CTA).
- Chỉ giữ lại đúng Công dụng (USP) cốt lõi của sản phẩm, còn lại xé nháp làm lại 100%!
========================================================================
`;
            currentPrompt += correctionPrompt;
        }

        try {
            const payload = {
                model: "gpt-5-6-luna",
                input: [{ role: "user", content: [{ type: "input_text", text: currentPrompt }] }],
                reasoning: { effort: "high" }
            };

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
                let highestSim = 0;
                let matchedWithText = "";

                if (historyContents.length > 0) {
                    for (const oldText of historyContents) {
                        const sim = calculateSimilarity(scriptContent, oldText);
                        if (sim > highestSim) {
                            highestSim = sim;
                            matchedWithText = oldText;
                        }
                        // BỘ LỌC LOCAL: VƯỢT NGƯỠNG 55% THÌ ĐÁNH DẤU LÀ TRÙNG LẶP
                        if (sim > 0.55) { 
                            isDuplicate = true;
                        }
                    }
                }

                if (isDuplicate) {
                    maxSimilarityScore = Math.round(highestSim * 100);
                    lastRejectedScript = scriptContent; // Lưu lại để bơm vào prompt lần sau
                    
                    const logMsg = `[AI Local Check] Kịch bản bị trùng lặp ${maxSimilarityScore}% (Vượt ngưỡng 55%). Đang phản hồi và ép AI tạo lại (Lần ${attempt + 1}/${maxAttempts})...`;
                    console.log(logMsg);
                    
                    // Ghi log chi tiết ra file JSON để sếp phân tích
                    if (projectPath) {
                        try {
                            const logFilePath = path.join(projectPath, '03_Script', 'duplicate_debug.json');
                            let logs = [];
                            try { logs = JSON.parse(await fs.readFile(logFilePath, 'utf8')); } catch(e){}
                            logs.push({
                                timestamp: new Date().toISOString(),
                                attempt: attempt + 1,
                                similarity_score: maxSimilarityScore + '%',
                                rejected_new_script: scriptContent,
                                matched_with_old_script: matchedWithText
                            });
                            await fs.writeFile(logFilePath, JSON.stringify(logs, null, 2));
                        } catch (e) {
                            console.log("Không thể ghi file log trùng lặp.");
                        }
                    }
                    
                    // Sang lần lặp tiếp theo
                    attempt++;
                    continue; 
                }

                totalCredits += resObj.credits;
                totalTokens += resObj.tokens;

                // NẾU TỚI ĐÂY THÌ NGHĨA LÀ KHÔNG TRÙNG LẶP HOẶC ĐÃ HẾT CƠ HỘI
                finalScripts = parsedJSON.scripts.map(s => {
                    if (typeof s === 'object' && s.content) {
                        return {
                            angle: s.angle || "Chưa xác định",
                            content: s.content,
                            keywords: Array.isArray(s.keywords) ? s.keywords : []
                        };
                    }
                    if (typeof s === 'string') {
                        return { angle: "Chưa xác định", content: s, keywords: [] };
                    }
                    return null;
                }).filter(s => s !== null);
                
                break; // Thoát vòng lặp thành công
            } else {
                throw new Error("AI không tạo được kịch bản hợp lệ.");
            }
        } catch (error) {
            console.log(`[Lỗi AI Text] Thử lần ${attempt + 1} thất bại: ${error.message}`);
            attempt++;
            if (attempt >= maxAttempts) {
                throw new Error("Lỗi khi sinh kịch bản: " + error.message);
            }
        }
    }

    if(finalScripts.length === 0) throw new Error("AI không tạo được kịch bản mới sau 5 lần thử. Hãy thử đổi Prompt hoặc mô tả sản phẩm.");
    
    return { scripts: finalScripts, credits: totalCredits, tokens: totalTokens };
}

module.exports = { generateNewScripts };