const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs'); 
const os = require('os'); 
const ffmpeg = require('fluent-ffmpeg'); 
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const { autoUpdater } = require('electron-updater');

ffmpeg.setFfmpegPath(ffmpegStatic.replace('app.asar', 'app.asar.unpacked'));
ffmpeg.setFfprobePath(ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked'));

const { exec } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');

const { 
    createProjectStructure, getProjectList, copySourcesToProject, getProjectSources, 
    saveMetadata, getMetadata, deleteProject, getScriptHistory, saveScriptHistory,
    listScripts, saveScriptRecord, deleteScriptRecord, getProjectConfig, saveProjectConfig,
    getFinalVideos, getApiLogs, saveApiLog,
    getGlobalPrompts, saveGlobalPrompt, updateGlobalPrompt, deleteGlobalPrompt,
    clearAllProxies
} = require('../utils/file_system');

const { analyzeVideoSource } = require('../services/openai_vision');
const { generateNewScripts } = require('../services/openai_text');
const { generateVoiceFile, getVoices } = require('../services/larvoice');
const { generateEverAIVoice } = require('../services/everai');
const { buildTimeline } = require('../local_core/metadata_matcher');
const { renderFinalVideo } = require('../local_core/ffmpeg_render');

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow;

// CẤU HÌNH AUTO UPDATER
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800, title: "Tool Auto edit - By Nugroup",
        webPreferences: { 
            nodeIntegration: false, 
            contextIsolation: true, 
            webSecurity: false, 
            preload: path.join(__dirname, 'preload.js') 
        }
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
    createWindow();
    
    // Chỉ check Update khi phần mềm đã đóng gói thành file .EXE
    if (app.isPackaged) {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
            console.log("Lỗi check update: " + err.message);
        });
    }

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Sự kiện báo về Giao diện khi tải Update
autoUpdater.on('update-available', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-available', info);
});
autoUpdater.on('download-progress', (progressObj) => {
    if(mainWindow) mainWindow.webContents.send('update-progress', progressObj);
});
autoUpdater.on('update-downloaded', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-downloaded', info);
});

ipcMain.handle('app:restartToUpdate', () => {
    autoUpdater.quitAndInstall();
});

const userDataPath = app.getPath('userData');
const appSettingsPath = path.join(userDataPath, 'app_settings.json');

function getAppSettings() {
    try {
        if (fsSync.existsSync(appSettingsPath)) {
            return JSON.parse(fsSync.readFileSync(appSettingsPath, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveAppSettings(settings) {
    fsSync.writeFileSync(appSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

let WORKSPACE_PATH = getAppSettings().workspacePath || path.join(app.getPath('documents'), 'AIVideoFactory_Workspace');
global.isProcessStopped = false;

function sendLog(msg, type = 'info') {
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('backend-log', { msg, type });
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

function sendProgress(taskName, percent) {
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('backend-progress', { task: taskName, percent: percent });
}

async function logApiUsage(projectName, service, task, usage, tokens = 0) {
    let costVND = 0;
    if (service === 'kie') costVND = usage * 126;
    else if (service === 'ever') costVND = usage * 0.495;
    else if (service === 'lar') costVND = usage * 0.5;

    const logEntry = {
        id: crypto.randomBytes(4).toString('hex'),
        timestamp: new Date().toISOString(),
        dateStr: new Date().toLocaleDateString('vi-VN'),
        projectName: projectName || 'Hệ thống',
        service: service,
        task: task,
        usage: usage,
        tokens: tokens,
        costVND: Math.round(costVND)
    };

    await saveApiLog(WORKSPACE_PATH, logEntry);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('api-usage', logEntry);
    }
    return Math.round(costVND);
}

ipcMain.handle('app:uninstall', () => {
    const appDir = path.dirname(process.execPath);
    const uninstallerPath = path.join(appDir, 'Uninstall Tool Auto edit - By Nugroup.exe');

    if (fsSync.existsSync(uninstallerPath)) {
        const { spawn } = require('child_process');
        const child = spawn(uninstallerPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        app.quit();
        return { success: true };
    } else {
        return { success: false, error: "Chỉ có thể Gỡ Cài Đặt khi bạn đang chạy bản Build chính thức (File EXE)." };
    }
});

ipcMain.handle('api:getLogs', async () => { return await getApiLogs(WORKSPACE_PATH); });
ipcMain.handle('process:stop', () => { global.isProcessStopped = true; sendLog('Hệ thống đã nhận lệnh DỪNG từ người dùng!', 'warning'); return true; });
ipcMain.handle('process:reset', () => { global.isProcessStopped = false; return true; });

ipcMain.handle('app:getWorkspacePath', () => WORKSPACE_PATH);
ipcMain.handle('app:setWorkspacePath', async (e, newPath) => {
    if (!newPath) return { success: false };
    WORKSPACE_PATH = newPath;
    const settings = getAppSettings();
    settings.workspacePath = newPath;
    saveAppSettings(settings);
    return { success: true };
});

ipcMain.handle('system:getFonts', async () => {
    return new Promise((resolve) => {
        const fallbackFonts = ['Arial', 'Times New Roman', 'Tahoma', 'Verdana', 'Helvetica', 'Montserrat', 'Open Sans', 'Roboto', 'SVN-Gotham', 'UTM Avo', 'UTM Bebas', 'Impact', 'Comic Sans MS'];
        if (process.platform !== 'win32') return resolve(fallbackFonts);
        exec('chcp 65001 >nul && powershell -Command "[System.Drawing.Text.InstalledFontCollection]::new().Families.Name"', (err, stdout) => {
            if (err) return resolve(fallbackFonts);
            const fonts = stdout.split('\n').map(f => f.trim()).filter(f => f);
            if(fonts.length < 5) return resolve(fallbackFonts);
            resolve(fonts);
        });
    });
});

ipcMain.handle('project:list', async () => { try { return await getProjectList(WORKSPACE_PATH); } catch (e) { return []; } });
ipcMain.handle('project:create', async (e, n) => { try { return { success: true, path: await createProjectStructure(n, WORKSPACE_PATH), name: n }; } catch (err) { return { success: false, error: err.message }; } });
ipcMain.handle('project:delete', async (e, n) => { if(!n) return {success: false}; try { await deleteProject(WORKSPACE_PATH, n); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
ipcMain.handle('project:getConfig', async (e, n) => { if (!n) return null; try { return await getProjectConfig(path.join(WORKSPACE_PATH, n)); } catch (err) { return null; } });
ipcMain.handle('project:saveConfig', async (e, n, d) => { if (!n) return {success: false}; try { await saveProjectConfig(path.join(WORKSPACE_PATH, n), d); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });

ipcMain.handle('dialog:openFiles', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov'] }] });
    return res.canceled ? [] : res.filePaths;
});
ipcMain.handle('dialog:openAudioFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: 'Chọn âm thanh hiệu ứng', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac'] }] });
    return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('dialog:openImageFiles', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }] });
    return res.canceled ? [] : res.filePaths;
});
ipcMain.handle('dialog:openDirectory', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('os:openFolder', async (e, f) => { try { shell.showItemInFolder(f); } catch (err) {} });
ipcMain.handle('os:openPath', async (e, p) => { try { shell.openPath(p); } catch (err) {} });
ipcMain.handle('os:openDefaultOutputDir', async (e, n) => {
    try { shell.openPath(path.join(WORKSPACE_PATH, n, '07_Product')); } catch (err) {}
});

ipcMain.handle('source:upload', async (e, n, p) => { 
    if (!n) return { success: false, error: "Tên dự án rỗng" };
    try { 
        await copySourcesToProject(path.join(WORKSPACE_PATH, n), p); 
        sendLog(`Đã upload ${p.length} file vào dự án.`); 
        return { success: true }; 
    } catch (err) { return { success: false, error: err.message }; } 
});

ipcMain.handle('source:uploadImages', async (e, n, p) => { 
    if (!n) return { success: false, error: "Tên dự án rỗng" };
    try { 
        const destDir = path.join(WORKSPACE_PATH, n, '00_ProductImages');
        for(let fp of p) {
            const ext = path.extname(fp);
            const id = 'IMG_' + crypto.randomBytes(3).toString('hex').toUpperCase();
            await fs.copyFile(fp, path.join(destDir, `${id}${ext}`));
        }
        sendLog(`Đã tải lên ${p.length} ảnh mẫu sản phẩm.`); 
        return { success: true }; 
    } catch (err) { return { success: false, error: err.message }; } 
});

ipcMain.handle('source:listImages', async (e, n) => { 
    if (!n) return []; 
    try { 
        const destDir = path.join(WORKSPACE_PATH, n, '00_ProductImages');
        const files = await fs.readdir(destDir);
        return files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i)).map(f => path.join(destDir, f));
    } catch (err) { return []; } 
});

ipcMain.handle('source:list', async (e, n) => { 
    if (!n) return []; 
    try { return await getProjectSources(path.join(WORKSPACE_PATH, n)); } catch (err) { return []; } 
});

ipcMain.handle('ai:analyze', async (e, n, f, k, fps) => {
    if (!n) return { success: false, error: "Chưa chọn dự án" };
    try {
        sendLog(`Đang quét AI cho file: ${f}...`);
        const p = path.join(WORKSPACE_PATH, n);
        const config = await getProjectConfig(p) || {};
        const targetFps = parseInt(fps) || 15;
        
        const cleanK = typeof k === 'string' ? k : k?.apiKey;
        const resObj = await analyzeVideoSource(path.join(p, '01_Source', f), cleanK, { name: config.productName||"", desc: config.productDesc||"" }, targetFps, p);
        await saveMetadata(p, f, resObj.meta);
        
        await logApiUsage(n, 'kie', `Quét Video (${f})`, resObj.credits, resObj.tokens);
        
        sendLog(`Quét AI thành công: ${f}`, 'success');
        return { success: true };
    } catch (err) { 
        sendLog(`Lỗi quét AI file ${f}: ${err.message}`, 'error');
        return { success: false, error: err.message }; 
    }
});

ipcMain.handle('video:downloadAndAnalyze', async (e, n, url, k, fps) => {
    if (!n) return { success: false };
    return new Promise((resolve) => {
        sendLog(`Đang gọi yt-dlp tải video từ: ${url}`);
        const sourceDir = path.join(WORKSPACE_PATH, n, '01_Source');
        const randomId = 'DL_' + Date.now();
        const outputTemplate = path.join(sourceDir, `${randomId}.mp4`);
        
        exec(`yt-dlp -f "bestvideo+bestaudio/best" -o "${outputTemplate}" "${url}"`, async (err, stdout, stderr) => {
            if (err) {
                sendLog(`Lỗi tải video: ${err.message}`, 'error');
                return resolve({ success: false, error: err.message });
            }
            sendLog(`Tải video thành công, đang đẩy qua AI quét...`);
            try {
                const config = await getProjectConfig(path.join(WORKSPACE_PATH, n)) || {};
                const targetFps = parseInt(fps) || 15;
                const cleanK = typeof k === 'string' ? k : k?.apiKey;
                const p = path.join(WORKSPACE_PATH, n);
                
                const resObj = await analyzeVideoSource(outputTemplate, cleanK, { name: config.productName||"", desc: config.productDesc||"" }, targetFps, p);
                await saveMetadata(path.join(WORKSPACE_PATH, n), `${randomId}.mp4`, resObj.meta);
                
                await logApiUsage(n, 'kie', 'Quét Video Download', resObj.credits, resObj.tokens);

                sendLog(`Quét video tải về thành công!`, 'success');
                resolve({ success: true });
            } catch(aiErr) {
                sendLog(`Lỗi AI: ${aiErr.message}`, 'error');
                resolve({ success: false, error: aiErr.message });
            }
        });
    });
});

ipcMain.handle('metadata:get', async (e, n, f) => { if (!n) return null; try { return await getMetadata(path.join(WORKSPACE_PATH, n), f); } catch (err) { return null; } });
ipcMain.handle('metadata:save', async (e, n, f, d) => { if (!n) return {success: false}; try { await saveMetadata(path.join(WORKSPACE_PATH, n), f, d); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });

function extractKieResponseForMain(responseData) {
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
                        if (parsed.output || parsed.response || parsed.choices) {
                            jsonObj = parsed;
                            break;
                        }
                    } catch(err2) {}
                }
            }
        }
    }

    if (jsonObj?.choices && jsonObj.choices.length > 0) {
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

    const outArr = jsonObj?.output || jsonObj?.response?.output;
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

ipcMain.handle('metadata:fix', async (e, n, f, jsonStr, userPrompt, apiKey) => {
    if (!n) return { success: false, error: "Dự án không tồn tại" };
    if (!apiKey) return { success: false, error: "Thiếu API Key Kie.ai" };
    
    try {
        const p = path.join(WORKSPACE_PATH, n);
        const cleanKey = apiKey.trim();
        
        const systemPrompt = `Bạn là một Đạo diễn Video. Hãy sửa đổi dữ liệu JSON dưới đây dựa trên yêu cầu của người dùng.
Dữ liệu JSON ban đầu:
${jsonStr}

Yêu cầu chỉnh sửa của sếp (người dùng):
${userPrompt}

TRẢ VỀ DUY NHẤT JSON MỚI THEO CẤU TRÚC SAU (TUYỆT ĐỐI KHÔNG GIẢI THÍCH):
{ "Description": "...", "Action": "...", "Object": "...", "Scene": "...", "Camera": "...", "Purpose": "...", "Keyword": "..." }`;

        const payload = {
            model: "gpt-5-6-luna",
            input: [{ role: "user", content: [{ type: "input_text", text: systemPrompt }] }],
            reasoning: { effort: "low" }
        };

        const response = await axios.post('https://api.kie.ai/codex/v1/responses', payload, {
            headers: { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' }
        });

        const resObj = extractKieResponseForMain(response.data);
        if (!resObj.content) throw new Error("AI trả về kết quả rỗng (Hoặc Stream bị lỗi).");

        let cleanJSON = resObj.content.replace(/[\`]{3}json/gi, '').replace(/[\`]{3}/g, '').trim();
        const jsonMatch = cleanJSON.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleanJSON = jsonMatch[0];

        const newMeta = JSON.parse(cleanJSON);

        await saveMetadata(p, f, newMeta);
        await logApiUsage(n, 'kie', `Chỉnh sửa Metadata (${f})`, resObj.credits, resObj.tokens);
        
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function localCalculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = new Set(str1.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(/\s+/));
    const s2 = new Set(str2.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(/\s+/));
    let intersect = 0;
    for (let w of s1) if (s2.has(w)) intersect++;
    const union = s1.size + s2.size - intersect;
    return union === 0 ? 0 : intersect / union;
}

ipcMain.handle('ai:generateShotlist', async (e, projectName, apiKey, correctionPrompt = null, oldData = null) => {
    if (!projectName || !apiKey) return { success: false, error: "Thiếu dữ liệu hoặc API Key." };
    try {
        const p = path.join(WORKSPACE_PATH, projectName);
        const config = await getProjectConfig(p) || {};
        
        let systemPrompt = "";

        if (correctionPrompt && oldData) {
            systemPrompt = `Bạn là một Đạo diễn Hình ảnh (D.O.P). Bạn vừa lập ra một BẢN NHÁP KẾ HOẠCH QUAY PHIM cho dự án "${config.productName || "Không rõ"}".

[BẢN NHÁP KẾ HOẠCH LẦN TRƯỚC CỦA BẠN]:
${JSON.stringify(oldData, null, 2)}

[YÊU CẦU CHỈNH SỬA TỪ SẾP CỦA BẠN]:
"${correctionPrompt}"

Nhiệm vụ của bạn: Hãy phân tích yêu cầu của sếp, TỰ ĐỘNG ĐIỀU CHỈNH lại số lượng take quay, góc máy, hoặc thêm bớt các phân cảnh cho phù hợp với lệnh trên. Giữ nguyên cấu trúc JSON chuẩn.

TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON SAU (KHÔNG KÈM MARKDOWN, KHÔNG GIẢI THÍCH NGOÀI):
[
  {
    "category": "Tên nhóm cảnh (VD: Mở hộp / Dùng thử / B-roll...)",
    "camera": "Góc máy (VD: Cận cảnh / Toàn cảnh / Góc cao...)",
    "action": "Hành động chi tiết cần diễn viên làm",
    "quantity": "Số lượng cảnh/take cần quay (số nguyên)",
    "note": "Ghi chú thêm về ánh sáng, tốc độ hoặc biểu cảm"
  }
]`;
        } 
        else {
            const scripts = await listScripts(p);
            if (scripts.length === 0) return { success: false, error: "Chưa có kịch bản nào để AI phân tích." };

            let uniqueScripts = [];
            for (let s of scripts) {
                let isDup = false;
                for (let u of uniqueScripts) {
                    if (localCalculateSimilarity(s.content, u.content) > 0.8) {
                        isDup = true;
                        break;
                    }
                }
                if (!isDup) uniqueScripts.push(s);
                if (uniqueScripts.length >= 30) break;
            }

            const scriptTextData = uniqueScripts.map((s, idx) => `[Kịch bản ${idx+1}]: ${s.content}`).join('\n\n');

            systemPrompt = `Bạn là một Đạo diễn Hình ảnh (D.O.P) và Cố vấn Sản xuất Video chuyên nghiệp.
Khách hàng đang phàn nàn rằng họ bị THIẾU TÀI NGUYÊN VIDEO (Các clip gốc bị dùng đi dùng lại quá nhiều lần gây nhàm chán).
Nhiệm vụ của bạn là: Đọc ${uniqueScripts.length} kịch bản dưới đây, phân tích xem nội dung kịch bản đang nhắc đến những hành động, bối cảnh, góc máy nào nhiều nhất. 
Từ đó, TÍNH TOÁN và GỢI Ý MỘT DANH SÁCH CÁC CẢNH QUAY CẦN THIẾT (Shotlist) để khách hàng cầm máy đi quay bổ sung.

[THÔNG TIN SẢN PHẨM]:
Tên: ${config.productName || "Không rõ"}
Công dụng: ${config.productDesc || "Không rõ"}

[DANH SÁCH KỊCH BẢN KHÁCH HÀNG ĐANG CÓ]:
${scriptTextData}

[YÊU CẦU PHÂN TÍCH & TÍNH TOÁN]:
1. Nhóm các ý tưởng trùng lặp. Ví dụ: Nếu thấy rất nhiều kịch bản nhắc đến việc "xịt nước", hãy yêu cầu quay nhiều take xịt nước ở các góc máy khác nhau.
2. Tính toán số lượng (Quantity): Đưa ra con số cụ thể (VD: Cần quay 5 cảnh xịt nước, 3 cảnh cầm sản phẩm, 2 cảnh toàn...). Tổng số lượng cảnh gợi ý nên từ 10 đến 25 cảnh tùy độ phức tạp.

TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON SAU (KHÔNG KÈM MARKDOWN, KHÔNG GIẢI THÍCH NGOÀI):
[
  {
    "category": "Tên nhóm cảnh (VD: Mở hộp / Dùng thử / B-roll...)",
    "camera": "Góc máy (VD: Cận cảnh / Toàn cảnh / Góc cao...)",
    "action": "Hành động chi tiết cần diễn viên làm",
    "quantity": "Số lượng cảnh/take cần quay (số nguyên)",
    "note": "Ghi chú thêm về ánh sáng, tốc độ hoặc biểu cảm"
  }
]`;
        }

        const payload = {
            model: "gpt-5-6-luna",
            input: [{ role: "user", content: [{ type: "input_text", text: systemPrompt }] }],
            reasoning: { effort: "high" }
        };

        const response = await axios.post('https://api.kie.ai/codex/v1/responses', payload, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' }
        });

        const resObj = extractKieResponseForMain(response.data);
        if (!resObj.content) throw new Error("AI không trả về kết quả.");

        let cleanJSON = resObj.content.replace(/[\`]{3}json/gi, '').replace(/[\`]{3}/g, '').trim();
        const jsonMatch = cleanJSON.match(/\[[\s\S]*\]/);
        if (jsonMatch) cleanJSON = jsonMatch[0];

        const shotlist = JSON.parse(cleanJSON);

        await logApiUsage(projectName, 'kie', correctionPrompt ? `AI D.O.P Chỉnh sửa Kế hoạch` : `AI D.O.P Lên Kế Hoạch Quay`, resObj.credits, resObj.tokens);

        let filteredCount = 0;
        if (!correctionPrompt) {
            const scripts = await listScripts(p);
            filteredCount = scripts.length - shotlist.length; 
        }

        return { success: true, data: shotlist, filteredCount: filteredCount };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('proxy:clear', async () => {
    try {
        const bytesFreed = await clearAllProxies(WORKSPACE_PATH);
        const mb = (bytesFreed / (1024 * 1024)).toFixed(2);
        return { success: true, freed: mb };
    } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle('proxy:check', async (e, n, f) => {
    try {
        const proxyFolder = path.join(WORKSPACE_PATH, n, '09_Proxy');
        if (!fsSync.existsSync(proxyFolder)) fsSync.mkdirSync(proxyFolder, {recursive: true});
        const proxyPath = path.join(proxyFolder, f);
        await fs.access(proxyPath);
        return proxyPath;
    } catch(e) { return null; }
});

ipcMain.handle('proxy:generate', async (e, n, f) => {
    return new Promise((resolve) => {
        const srcPath = path.join(WORKSPACE_PATH, n, '01_Source', f);
        const proxyFolder = path.join(WORKSPACE_PATH, n, '09_Proxy');
        if (!fsSync.existsSync(proxyFolder)) fsSync.mkdirSync(proxyFolder, {recursive: true});
        const destPath = path.join(proxyFolder, f);
        
        fsSync.access(destPath, fsSync.constants.F_OK, (err) => {
            if (!err) return resolve({success: true}); 
            
            ffmpeg(srcPath)
                .outputOptions([
                    '-vf', "scale='min(480,iw)':-2",
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast', 
                    '-crf', '30', 
                    '-c:a', 'copy' 
                ])
                .save(destPath)
                .on('end', () => resolve({success: true}))
                .on('error', (err) => resolve({success: false, error: err.message}));
        });
    });
});

ipcMain.handle('prompt:list', async () => await getGlobalPrompts(WORKSPACE_PATH));
ipcMain.handle('prompt:save', async (e, data) => await saveGlobalPrompt(WORKSPACE_PATH, data));
ipcMain.handle('prompt:update', async (e, id, updatedData) => {
    try { await updateGlobalPrompt(WORKSPACE_PATH, id, updatedData); return { success: true }; } 
    catch(err) { return { success: false, error: err.message }; }
});
ipcMain.handle('prompt:delete', async (e, id) => {
    try { await deleteGlobalPrompt(WORKSPACE_PATH, id); return { success: true }; } 
    catch(err) { return { success: false, error: err.message }; }
});

ipcMain.handle('script:list', async (e, n) => { 
    if (!n) return []; 
    try { return await listScripts(path.join(WORKSPACE_PATH, n)); } catch (err) { return []; } 
});

ipcMain.handle('script:saveRecord', async (e, n, d) => { if (!n) return {success: false}; try { await saveScriptRecord(path.join(WORKSPACE_PATH, n), d); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
ipcMain.handle('script:deleteRecord', async (e, n, i) => { if (!n) return {success: false}; try { await deleteScriptRecord(path.join(WORKSPACE_PATH, n), i); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });

ipcMain.handle('pipeline:runAuto', async (e, n, aiConfig, voiceConfig, promptContent, c, productInfo, d, subConfig, maxCon, customOut) => {
    const apiKey = typeof aiConfig === 'string' ? aiConfig : aiConfig?.apiKey;
    if (!n || !apiKey) return { success: false };
    
    sendLog(`--- KHỞI ĐỘNG DÂY CHUYỀN AUTO (${c} VIDEO) ---`, 'success');
    const projPath = path.join(WORKSPACE_PATH, n);
    const history = await getScriptHistory(projPath);

    let totalTasks = c * 3;
    let completedTasks = 0;
    
    const updateGlobal = () => {
        completedTasks++;
        const pct = Math.round((completedTasks / totalTasks) * 100);
        mainWindow.webContents.send('global-progress', pct);
    };

    let activeRenders = 0;
    let renderQueue = [];

    const processRenderQueue = async () => {
        if (global.isProcessStopped || activeRenders >= maxCon || renderQueue.length === 0) return;
        
        activeRenders++;
        const { scriptObj } = renderQueue.shift();
        
        try {
            sendLog(`[Render Video] ${scriptObj.id}: Bắt đầu trộn Timeline...`);
            if (mainWindow) mainWindow.webContents.send('render-start', { id: scriptObj.id });

            const tlObj = await buildTimeline(projPath, scriptObj.content, scriptObj.voicePath, scriptObj.srtPath, apiKey); 
            const costRender = await logApiUsage(n, 'kie', 'Xếp Cảnh Video (Timeline)', tlObj.credits, tlObj.tokens);
            
            let config = await getProjectConfig(projPath) || {};
            config.renderCount = (config.renderCount || 0) + 1;
            await saveProjectConfig(projPath, config);
            
            sendLog(`[Render Video] ${scriptObj.id}: FFMPEG đang chạy...`);
            
            let runSubConfig = { ...subConfig, keywords: scriptObj.keywords || [] };
            const filePath = await renderFinalVideo(projPath, config.projectName || n, config.renderCount, tlObj.timeline, scriptObj.voicePath, scriptObj.srtPath, runSubConfig, customOut);
            
            const totalCost = (scriptObj.costText || 0) + (scriptObj.costVoice || 0) + costRender;
            const costDbObj = { text: scriptObj.costText || 0, voice: scriptObj.costVoice || 0, render: costRender, total: totalCost };
            await fs.writeFile(filePath + '.meta.json', JSON.stringify(costDbObj), 'utf8');

            sendLog(`[HOÀN TẤT VIDEO] ${path.basename(filePath)} | Giá: ${totalCost.toLocaleString('vi-VN')}đ`, 'success');
            
            scriptObj.isRendered = true;
            await saveScriptRecord(projPath, scriptObj);
            
            updateGlobal();
            if(mainWindow) mainWindow.webContents.send('render-done');
        } catch(err) {
            sendLog(`[LỖI RENDER] ${scriptObj.id}: ${err.message}`, 'error');
            updateGlobal(); 
            if(mainWindow) mainWindow.webContents.send('render-done'); 
        } finally {
            activeRenders--;
            processRenderQueue(); 
        }
    };

    for(let i=0; i<c; i++) {
        if (global.isProcessStopped) break;

        let currentPrompt = "";
        if (Array.isArray(promptContent) && promptContent.length > 0) {
            currentPrompt = promptContent[i % promptContent.length];
        } else {
            currentPrompt = promptContent;
        }

        sendLog(`[Auto] Đang tư duy Kịch Bản số ${i+1}/${c}...`);
        try {
            const scriptResObj = await generateNewScripts(apiKey, currentPrompt, history, 1, productInfo, d, projPath); 
            const costText = await logApiUsage(n, 'kie', `Tạo Kịch Bản Auto ${i+1}`, scriptResObj.credits, scriptResObj.tokens);

            const scriptObj = scriptResObj.scripts[0];
            const scriptData = { 
                id: 'SCRIPT_' + Date.now() + '_' + i, 
                angle: scriptObj.angle || "Chưa xác định",
                content: scriptObj.content, 
                keywords: scriptObj.keywords || [],
                createdAt: new Date().toISOString(), 
                isRendered: false, 
                costText: costText 
            };
            await saveScriptRecord(projPath, scriptData);
            updateGlobal(); 
            if (mainWindow) mainWindow.webContents.send('script-generated', scriptData);
            
            (async (sData) => {
                if (global.isProcessStopped) return;
                
                sendLog(`[Voice] Đang thu âm cho ${sData.id}...`);
                try {
                    let voiceRes;
                    let costVoice = 0;
                    if (voiceConfig.provider === 'everai') {
                        voiceRes = await generateEverAIVoice(sData.content, voiceConfig.v, voiceConfig.s, voiceConfig.vo, voiceConfig.pi, voiceConfig.kEver, path.join(projPath, '04_Voice'));
                        costVoice = await logApiUsage(n, 'ever', 'Lồng Tiếng EverAI', voiceRes.usage);
                    } else {
                        voiceRes = await generateVoiceFile(sData.content, voiceConfig.v, voiceConfig.s, voiceConfig.vo, voiceConfig.pi, voiceConfig.kLar, path.join(projPath, '04_Voice'));
                        costVoice = await logApiUsage(n, 'lar', 'Lồng Tiếng LarVoice', voiceRes.usage);
                    }
                    
                    sData.voicePath = voiceRes.filePath;
                    sData.srtPath = voiceRes.srtPath;
                    sData.costVoice = costVoice; 
                    await saveScriptRecord(projPath, sData);
                    sendLog(`[Voice] ${sData.id} hoàn tất! Đẩy qua bộ phận Render...`, 'success');
                    updateGlobal(); 
                    
                    if (global.isProcessStopped) return;
                    renderQueue.push({ scriptObj: sData });
                    processRenderQueue();
                    
                } catch (vErr) {
                    sendLog(`[LỖI VOICE] ${sData.id}: ${vErr.message}`, 'error');
                    updateGlobal(); updateGlobal(); 
                }
            })(scriptData).catch(err => console.error(err));

        } catch (sErr) {
            sendLog(`[LỖI SCRIPT] số ${i+1}: ${sErr.message}`, 'error');
            updateGlobal(); updateGlobal(); updateGlobal(); 
        }
    }

    return { success: true };
});

ipcMain.handle('script:generateBatch', async (e, n, aiConfig, promptContent, c, productInfo, d) => {
    const apiKey = typeof aiConfig === 'string' ? aiConfig : aiConfig?.apiKey;
    if (!n || !apiKey) return { success: false, error: "Thiếu API Key" };
    try {
        const projPath = path.join(WORKSPACE_PATH, n);
        const history = await getScriptHistory(projPath);
        
        let totalCreated = 0;
        let lastError = null;
        for(let i=0; i<c; i++) {
            if(global.isProcessStopped) break;
            sendProgress('script', Math.round(((i) / c) * 100)); 
            
            let currentPrompt = "";
            if (Array.isArray(promptContent) && promptContent.length > 0) {
                currentPrompt = promptContent[i % promptContent.length];
            } else {
                currentPrompt = promptContent;
            }
            
            try {
                const resObj = await generateNewScripts(apiKey, currentPrompt, history, 1, productInfo, d, projPath); 
                const costText = await logApiUsage(n, 'kie', 'Tạo Kịch Bản Thủ Công', resObj.credits, resObj.tokens);

                if (resObj.scripts && resObj.scripts.length > 0) {
                    const scriptObj = resObj.scripts[0];
                    const scriptData = { 
                        id: 'SCRIPT_' + Date.now() + '_' + i, 
                        angle: scriptObj.angle || "Chưa xác định",
                        content: scriptObj.content, 
                        keywords: scriptObj.keywords || [],
                        createdAt: new Date().toISOString(), 
                        isRendered: false, 
                        costText: costText 
                    };
                    await saveScriptRecord(projPath, scriptData);
                    totalCreated++;
                    if (mainWindow) mainWindow.webContents.send('script-generated', scriptData);
                }
            } catch (err) {
                sendLog(`[LỖI TẠO KỊCH BẢN LẦN ${i+1}]: ${err.message}`, 'error');
                lastError = err.message;
            }
        }
        sendProgress('script', 100);
        
        if (totalCreated === 0 && lastError) {
             return { success: false, error: "Lỗi tạo kịch bản: " + lastError };
        }
        
        return { success: true, count: totalCreated };
    } catch (err) { 
        sendLog(`[LỖI API TEXT] ${err.message}`, 'error');
        return { success: false, error: err.message }; 
    }
});

ipcMain.handle('voice:list', async (e, k) => { return await getVoices(k); });

ipcMain.handle('voice:generateBatch', async (e, n, voiceConfig) => {
    if (!n) return { success: false };
    try {
        const p = path.join(WORKSPACE_PATH, n);
        const scripts = await listScripts(p);
        const scriptsToGen = scripts.filter(x => !x.voicePath);
        if(scriptsToGen.length === 0) return { success: true, count: 0 };

        let doneCount = 0;
        for (let i = 0; i < scriptsToGen.length; i++) {
            if (global.isProcessStopped) break;
            const script = scriptsToGen[i];
            sendProgress('voice', Math.round(((i) / scriptsToGen.length) * 100));
            
            try {
                let res; let costVoice = 0;
                if (voiceConfig.provider === 'everai') {
                    res = await generateEverAIVoice(script.content, voiceConfig.v, voiceConfig.s, voiceConfig.vo, voiceConfig.pi, voiceConfig.kEver, path.join(p, '04_Voice'));
                    costVoice = await logApiUsage(n, 'ever', 'Lồng Tiếng Thủ Công', res.usage);
                } else {
                    res = await generateVoiceFile(script.content, voiceConfig.v, voiceConfig.s, voiceConfig.vo, voiceConfig.pi, voiceConfig.kLar, path.join(p, '04_Voice'));
                    costVoice = await logApiUsage(n, 'lar', 'Lồng Tiếng Thủ Công', res.usage);
                }
                
                script.voicePath = res.filePath;
                script.srtPath = res.srtPath;
                script.costVoice = costVoice;
                await saveScriptRecord(p, script);
                doneCount++;
            } catch (voiceErr) {
                sendLog(`Lỗi tại kịch bản ${script.id}: ${voiceErr.message}`, 'error');
            }
        }
        sendProgress('voice', 100);
        return { success: true, count: doneCount };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('video:renderBatch', async (e, n, aiConfig, sub, targetIds, maxConcurrent = 3, customOut = null) => {
    const apiKey = typeof aiConfig === 'string' ? aiConfig : aiConfig?.apiKey;
    if (!n || !apiKey) return { success: false, error: "Thiếu API Key" };
    try {
        const p = path.join(WORKSPACE_PATH, n);
        const scripts = await listScripts(p);
        
        let totalProcessed = 0;
        for (let i = 0; i < targetIds.length; i += maxConcurrent) {
            if(global.isProcessStopped) break;
            const chunkIds = targetIds.slice(i, i + maxConcurrent);
            
            const promises = chunkIds.map(async (id) => {
                const script = scripts.find(x => x.id === id);
                if (script && script.voicePath && script.srtPath) {
                    try {
                        if (mainWindow) mainWindow.webContents.send('render-start', { id: script.id });

                        const tlObj = await buildTimeline(p, script.content, script.voicePath, script.srtPath, apiKey);
                        const costRender = await logApiUsage(n, 'kie', 'Xếp Cảnh Thủ Công', tlObj.credits, tlObj.tokens);
                        
                        let config = await getProjectConfig(p) || {};
                        config.renderCount = (config.renderCount || 0) + 1;
                        await saveProjectConfig(p, config);
                        
                        let runSubConfig = { ...sub, keywords: script.keywords || [] };
                        const filePath = await renderFinalVideo(p, config.projectName || n, config.renderCount, tlObj.timeline, script.voicePath, script.srtPath, runSubConfig, customOut);
                        
                        const totalCost = (script.costText || 0) + (script.costVoice || 0) + costRender;
                        const costDbObj = { text: script.costText || 0, voice: script.costVoice || 0, render: costRender, total: totalCost };
                        await fs.writeFile(filePath + '.meta.json', JSON.stringify(costDbObj), 'utf8');

                        script.isRendered = true;
                        await saveScriptRecord(p, script);
                        
                        totalProcessed++;
                        sendProgress('render', Math.round((totalProcessed / targetIds.length) * 100));
                        return true;
                    } catch(err) {
                        sendLog(`[Video ${id}] LỖI RENDER: ${err.message}`, 'error');
                        totalProcessed++;
                        sendProgress('render', Math.round((totalProcessed / targetIds.length) * 100));
                        return false;
                    }
                }
            });
            await Promise.all(promises); 
        }
        sendProgress('render', 100);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('video:listFinals', async (e, n, customOut) => { 
    if (!n) return []; 
    try { return await getFinalVideos(path.join(WORKSPACE_PATH, n), customOut); } catch (err) { return []; } 
});