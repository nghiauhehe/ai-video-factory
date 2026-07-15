// src/services/srt_processor.js
const fs = require('fs/promises');

// Đổi chuỗi thời gian SRT (00:00:01,234) ra Mili-giây
function parseTime(timeStr) {
    const [h, m, s_ms] = timeStr.trim().split(':');
    const [s, ms] = s_ms.split(',');
    return (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
}

// Đổi Mili-giây ngược lại chuẩn SRT
function formatTime(ms) {
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000); ms %= 60000;
    const s = Math.floor(ms / 1000);
    const mls = Math.floor(ms % 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(mls).padStart(3,'0')}`;
}

// Hàm chia nhỏ câu dài thành cụm tối đa 3 chữ bám sát thời gian và xóa dấu câu tùy chọn
async function processSRT(srtPath, removePunctuation = false) {
    const content = await fs.readFile(srtPath, 'utf8');
    const blocks = content.replace(/\r/g, '').split('\n\n').filter(b => b.trim());
    let newSrt = '';
    let counter = 1;

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length >= 3) {
            const timeLine = lines[1];
            let text = lines.slice(2).join(' ').trim();
            
            // Xóa dấu câu nếu được cấu hình
            if (removePunctuation) {
                text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
            }

            const [startStr, endStr] = timeLine.split(' --> ');
            
            const startMs = parseTime(startStr);
            const endMs = parseTime(endStr);
            const duration = endMs - startMs;
            
            const words = text.split(/\s+/).filter(w => w.trim() !== '');
            if(words.length === 0) continue;
            
            // Nếu câu ngắn (<= 3 chữ), giữ nguyên
            if (words.length <= 3) {
                newSrt += `${counter++}\n${timeLine}\n${words.join(' ')}\n\n`;
                continue;
            }

            // Chia cụm 3 chữ
            const chunks = [];
            for (let i = 0; i < words.length; i += 3) {
                chunks.push(words.slice(i, i + 3).join(' '));
            }

            // Tính toán lại thời gian tỷ lệ thuận với số chữ
            const timePerWord = duration / words.length;
            let currentStart = startMs;

            for (const chunk of chunks) {
                const chunkWordCount = chunk.split(' ').length;
                const chunkDuration = chunkWordCount * timePerWord;
                const chunkEnd = currentStart + chunkDuration;

                newSrt += `${counter++}\n${formatTime(currentStart)} --> ${formatTime(chunkEnd)}\n${chunk}\n\n`;
                currentStart = chunkEnd;
            }
        }
    }
    
    // Ghi đè lại file SRT đã được xử lý
    await fs.writeFile(srtPath, newSrt, 'utf8');
}

module.exports = { processSRT };