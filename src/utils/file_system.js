const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function getProjectConfig(projectPath) {
    const configPath = path.join(projectPath, 'Project.json');
    try {
        const data = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

async function saveProjectConfig(projectPath, configData) {
    const configPath = path.join(projectPath, 'Project.json');
    let existingConfig = {};
    try {
        const data = await fs.readFile(configPath, 'utf8');
        existingConfig = JSON.parse(data);
    } catch (error) {}
    
    const mergedConfig = { ...existingConfig, ...configData };
    await fs.writeFile(configPath, JSON.stringify(mergedConfig, null, 4), 'utf8');
}

async function getProjectList(workspacePath) {
    try {
        await fs.mkdir(workspacePath, { recursive: true });
        const items = await fs.readdir(workspacePath, { withFileTypes: true });
        let projects = [];
        
        for (const item of items) {
            if (item.isDirectory()) {
                const projectJsonPath = path.join(workspacePath, item.name, 'Project.json');
                try {
                    const data = await fs.readFile(projectJsonPath, 'utf8');
                    const config = JSON.parse(data);
                    const validName = config.projectName || config.name || item.name;
                    projects.push({ id: config.id || Date.now(), name: validName, path: path.join(workspacePath, item.name) });
                } catch (e) {
                    projects.push({ id: Date.now(), name: item.name, path: path.join(workspacePath, item.name) });
                }
            }
        }
        return projects.sort((a, b) => b.id - a.id);
    } catch (error) { return []; }
}

async function createProjectStructure(projectName, basePath) {
    const cleanProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '');
    const projectPath = path.join(basePath, cleanProjectName);
    try {
        try { await fs.access(projectPath); throw new Error('Dự án đã tồn tại.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await fs.mkdir(projectPath, { recursive: true });
        
        const folders = ['00_ProductImages', '01_Source', '02_Metadata', '03_Script', '04_Voice', '05_Sample', '06_Export', '07_Product', '08_AICamera', '09_Proxy'];
        await Promise.all(folders.map(f => fs.mkdir(path.join(projectPath, f))));
        
        const projectConfig = { 
            id: Date.now().toString(), 
            projectName: cleanProjectName, 
            createdAt: new Date().toISOString(),
            renderCount: 0,
            productName: "", productDesc: ""
        };
        await fs.writeFile(path.join(projectPath, 'Project.json'), JSON.stringify(projectConfig, null, 4), 'utf8');
        return projectPath;
    } catch (error) { throw new Error(`Lỗi tạo dự án: ${error.message}`); }
}

async function deleteProject(workspacePath, projectName) {
    const projectPath = path.join(workspacePath, projectName);
    try { await fs.rm(projectPath, { recursive: true, force: true }); } catch (error) { throw new Error(`Lỗi: ${error.message}`); }
}

async function copySourcesToProject(projectPath, filePaths) {
    const sourceDir = path.join(projectPath, '01_Source');
    for (let fp of filePaths) {
        const ext = path.extname(fp);
        const id = 'SRC_' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const dest = path.join(sourceDir, `${id}${ext}`);
        await fs.copyFile(fp, dest);
    }
}

// BẢN NÂNG CẤP: BỔ SUNG GỘP DATA ĐỂ GIAO DIỆN PHÂN LOẠI HOOK/BODY/CTA
async function getProjectSources(projectPath) {
    const sourceDir = path.join(projectPath, '01_Source');
    const metaDir = path.join(projectPath, '02_Metadata');
    try {
        const files = await fs.readdir(sourceDir);
        const sources = [];
        for (let file of files) {
            if (file.endsWith('.mp4') || file.endsWith('.mov')) {
                const baseName = path.basename(file, path.extname(file));
                const metaPath = path.join(metaDir, `${baseName}.json`);
                const absolutePath = path.join(sourceDir, file);
                
                let status = 'pending'; let description = ''; let cameraCheck = null; let isVerified = false; let usageCount = 0;
                let searchData = ''; // Dữ liệu gộp để phục vụ Auto Categorize
                try {
                    const metaContent = await fs.readFile(metaPath, 'utf8');
                    const parsedData = JSON.parse(metaContent);
                    description = parsedData.MainContent || parsedData.Description || '';
                    cameraCheck = parsedData.CameraCheck || null;
                    isVerified = parsedData.isVerified || false;
                    usageCount = parsedData.usageCount || 0;
                    
                    // Gộp toàn bộ Keyword, Purpose, Action để gửi lên Front-end soi phân loại
                    searchData = `${parsedData.Purpose || ''} ${parsedData.Action || ''} ${parsedData.Keyword || ''} ${description}`;
                    status = 'done'; 
                } catch(e) {}
                sources.push({ fileName: file, id: baseName, status, filePath: absolutePath, description, cameraCheck, isVerified, usageCount, searchData });
            }
        }
        return sources;
    } catch (e) { return []; }
}

async function getMetadata(projectPath, fileName) {
    const baseName = path.basename(fileName, path.extname(fileName));
    const metaPath = path.join(projectPath, '02_Metadata', `${baseName}.json`);
    try { return JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch (e) { return null; }
}

async function saveMetadata(projectPath, fileName, data) {
    const baseName = path.basename(fileName, path.extname(fileName));
    const metaPath = path.join(projectPath, '02_Metadata', `${baseName}.json`);
    await fs.writeFile(metaPath, JSON.stringify(data, null, 4), 'utf8');
}

async function listScripts(projectPath) {
    const scriptsPath = path.join(projectPath, '03_Script', 'scripts.json');
    try { return JSON.parse(await fs.readFile(scriptsPath, 'utf8')); } catch (e) { return []; }
}

async function saveScriptRecord(projectPath, scriptData) {
    const scriptsPath = path.join(projectPath, '03_Script', 'scripts.json');
    let scripts = [];
    try { scripts = JSON.parse(await fs.readFile(scriptsPath, 'utf8')); } catch (e) {}
    
    const index = scripts.findIndex(s => s.id === scriptData.id);
    if (index !== -1) scripts[index] = scriptData;
    else scripts.unshift(scriptData);

    await fs.writeFile(scriptsPath, JSON.stringify(scripts, null, 4), 'utf8');
}

async function deleteScriptRecord(projectPath, scriptId) {
    const scriptsPath = path.join(projectPath, '03_Script', 'scripts.json');
    try {
        let scripts = JSON.parse(await fs.readFile(scriptsPath, 'utf8'));
        scripts = scripts.filter(s => s.id !== scriptId);
        await fs.writeFile(scriptsPath, JSON.stringify(scripts, null, 4), 'utf8');
    } catch (e) {}
}

async function getScriptHistory(projectPath) {
    const scriptsPath = path.join(projectPath, '03_Script', 'scripts.json');
    try { 
        const scripts = JSON.parse(await fs.readFile(scriptsPath, 'utf8')); 
        const angles = scripts.map(s => s.angle).filter(a => a);
        const contents = scripts.map(s => s.content).filter(c => c);
        const anglesStr = angles.slice(0, 20).map((a, i) => `${i+1}. ${a}`).join('\n');
        return { anglesStr, contents };
    } catch (e) { 
        return { anglesStr: "", contents: [] }; 
    }
}

async function saveScriptHistory(projectPath, newScriptsArray) { return true; }

async function getGlobalPrompts(workspacePath) {
    const p = path.join(workspacePath, 'global_prompts.json');
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { return []; }
}

async function saveGlobalPrompt(workspacePath, promptData) {
    const p = path.join(workspacePath, 'global_prompts.json');
    let prompts = await getGlobalPrompts(workspacePath);
    if (!promptData.id) promptData.id = 'PROMPT_' + Date.now();
    prompts.push(promptData);
    await fs.writeFile(p, JSON.stringify(prompts, null, 4), 'utf8');
    return promptData;
}

async function updateGlobalPrompt(workspacePath, id, updatedData) {
    const p = path.join(workspacePath, 'global_prompts.json');
    let prompts = await getGlobalPrompts(workspacePath);
    const index = prompts.findIndex(s => String(s.id) === String(id));
    if (index !== -1) {
        prompts[index] = { ...prompts[index], ...updatedData };
        await fs.writeFile(p, JSON.stringify(prompts, null, 4), 'utf8');
    } else { throw new Error("Không tìm thấy Prompt để cập nhật."); }
}

async function deleteGlobalPrompt(workspacePath, id) {
    const p = path.join(workspacePath, 'global_prompts.json');
    let prompts = await getGlobalPrompts(workspacePath);
    prompts = prompts.filter(s => String(s.id) !== String(id));
    await fs.writeFile(p, JSON.stringify(prompts, null, 4), 'utf8');
}

async function getFinalVideos(projectPath, customOutputDir = null) {
    const outputDir = customOutputDir || path.join(projectPath, '07_Product');
    try {
        const files = await fs.readdir(outputDir);
        const mp4Files = files.filter(f => f.endsWith('.mp4'));
        const results = [];
        for (const f of mp4Files) {
            const filePath = path.join(outputDir, f);
            const stat = await fs.stat(filePath);
            let metaCost = { total: 0, text: 0, voice: 0, render: 0 };
            try {
                const metaData = JSON.parse(await fs.readFile(filePath + '.meta.json', 'utf8'));
                metaCost = {
                    total: metaData.total || metaData.cost || 0,
                    text: metaData.text || 0,
                    voice: metaData.voice || 0,
                    render: metaData.render || 0
                };
            } catch(e){}
            results.push({ name: f, path: filePath, birthtime: stat.mtimeMs || stat.birthtimeMs, costObj: metaCost });
        }
        return results.sort((a,b) => b.birthtime - a.birthtime);
    } catch (e) { return []; }
}

async function getApiLogs(workspacePath) {
    const logPath = path.join(workspacePath, 'api_logs.json');
    try {
        const data = await fs.readFile(logPath, 'utf8');
        return JSON.parse(data);
    } catch (e) { return []; }
}

async function saveApiLog(workspacePath, logEntry) {
    const logPath = path.join(workspacePath, 'api_logs.json');
    let logs = [];
    try { logs = JSON.parse(await fs.readFile(logPath, 'utf8')); } catch (e) {}
    logs.unshift(logEntry);
    await fs.writeFile(logPath, JSON.stringify(logs, null, 4), 'utf8');
}

async function clearAllProxies(workspacePath) {
    let totalFreed = 0;
    const projs = await getProjectList(workspacePath);
    for (const p of projs) {
        const proxyDir = path.join(p.path, '09_Proxy');
        try {
            const files = await fs.readdir(proxyDir);
            for (const f of files) {
                const fp = path.join(proxyDir, f);
                const stat = await fs.stat(fp);
                totalFreed += stat.size;
                await fs.unlink(fp);
            }
        } catch(e) {} 
    }
    return totalFreed;
}

module.exports = {
    getProjectList, createProjectStructure, copySourcesToProject, getProjectSources, 
    getMetadata, saveMetadata, deleteProject, getScriptHistory, saveScriptHistory,
    listScripts, saveScriptRecord, deleteScriptRecord, getProjectConfig, saveProjectConfig,
    getFinalVideos, getApiLogs, saveApiLog,
    getGlobalPrompts, saveGlobalPrompt, updateGlobalPrompt, deleteGlobalPrompt,
    clearAllProxies
};