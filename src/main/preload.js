const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    listProjects: () => ipcRenderer.invoke('project:list'),
    createProject: (name) => ipcRenderer.invoke('project:create', name),
    deleteProject: (name) => ipcRenderer.invoke('project:delete', name),
    getProjectConfig: (name) => ipcRenderer.invoke('project:getConfig', name),
    saveProjectConfig: (name, data) => ipcRenderer.invoke('project:saveConfig', name, data),
    
    openVideoFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    openAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    
    openImageFiles: () => ipcRenderer.invoke('dialog:openImageFiles'),
    uploadProductImages: (projectName, filePaths) => ipcRenderer.invoke('source:uploadImages', projectName, filePaths),
    listProductImages: (projectName) => ipcRenderer.invoke('source:listImages', projectName),

    openFolder: (folderPath) => ipcRenderer.invoke('os:openFolder', folderPath),
    openPath: (path) => ipcRenderer.invoke('os:openPath', path),
    openDefaultOutputDir: (projectName) => ipcRenderer.invoke('os:openDefaultOutputDir', projectName),
    getSystemFonts: () => ipcRenderer.invoke('system:getFonts'),
    
    downloadAndAnalyze: (projectName, url, apiKey, fps) => ipcRenderer.invoke('video:downloadAndAnalyze', projectName, url, apiKey, fps),
    
    uploadSources: (projectName, filePaths) => ipcRenderer.invoke('source:upload', projectName, filePaths),
    listSources: (projectName) => ipcRenderer.invoke('source:list', projectName),
    analyzeSource: (projectName, fileName, apiKey, fps) => ipcRenderer.invoke('ai:analyze', projectName, fileName, apiKey, fps),
    getMetadata: (projectName, fileName) => ipcRenderer.invoke('metadata:get', projectName, fileName),
    saveMetadata: (projectName, fileName, data) => ipcRenderer.invoke('metadata:save', projectName, fileName, data),
    
    fixMetadata: (projectName, fileName, jsonStr, prompt, apiKey) => ipcRenderer.invoke('metadata:fix', projectName, fileName, jsonStr, prompt, apiKey),
    
    generateShotlist: (projectName, apiKey, correctionPrompt, oldData) => ipcRenderer.invoke('ai:generateShotlist', projectName, apiKey, correctionPrompt, oldData),

    listPrompts: () => ipcRenderer.invoke('prompt:list'),
    savePrompt: (data) => ipcRenderer.invoke('prompt:save', data),
    updatePrompt: (id, data) => ipcRenderer.invoke('prompt:update', id, data),
    deletePrompt: (id) => ipcRenderer.invoke('prompt:delete', id),

    runAutoPipeline: (projectName, aiConfig, voiceConfig, promptContent, count, productInfo, dur, subConf, maxCon, customOut) => 
        ipcRenderer.invoke('pipeline:runAuto', projectName, aiConfig, voiceConfig, promptContent, count, productInfo, dur, subConf, maxCon, customOut),

    generateScriptsBatch: (projectName, aiConfig, promptContent, count, productInfo, duration) => 
        ipcRenderer.invoke('script:generateBatch', projectName, aiConfig, promptContent, count, productInfo, duration),
        
    listScripts: (projectName) => ipcRenderer.invoke('script:list', projectName),
    saveScriptRecord: (projectName, data) => ipcRenderer.invoke('script:saveRecord', projectName, data),
    deleteScriptRecord: (projectName, id) => ipcRenderer.invoke('script:deleteRecord', projectName, id),
    onScriptGenerated: (callback) => ipcRenderer.on('script-generated', (event, data) => callback(data)), 
    
    getLarVoices: (apiKey) => ipcRenderer.invoke('voice:list', apiKey),
    generateVoiceBatch: (projectName, voiceConfig) => ipcRenderer.invoke('voice:generateBatch', projectName, voiceConfig),
    
    renderVideoBatch: (projectName, aiConfig, subConfig, targetScriptIds, maxConcurrent, customOut) => ipcRenderer.invoke('video:renderBatch', projectName, aiConfig, subConfig, targetScriptIds, maxConcurrent, customOut),
    listFinalVideos: (projectName, customOut) => ipcRenderer.invoke('video:listFinals', projectName, customOut),

    checkProxy: (projectName, fileName) => ipcRenderer.invoke('proxy:check', projectName, fileName),
    generateProxy: (projectName, fileName) => ipcRenderer.invoke('proxy:generate', projectName, fileName),
    clearProxies: () => ipcRenderer.invoke('proxy:clear'),

    getApiLogs: () => ipcRenderer.invoke('api:getLogs'),
    onApiUsage: (callback) => ipcRenderer.on('api-usage', (event, data) => callback(data)),

    getWorkspacePath: () => ipcRenderer.invoke('app:getWorkspacePath'),
    setWorkspacePath: (newPath) => ipcRenderer.invoke('app:setWorkspacePath', newPath),
    
    uninstallApp: () => ipcRenderer.invoke('app:uninstall'),

    onTerminalLog: (callback) => ipcRenderer.on('backend-log', (event, data) => callback(data)),
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    
    stopProcess: () => ipcRenderer.invoke('process:stop'),
    resetProcess: () => ipcRenderer.invoke('process:reset'),

    // --- CÁC HÀM MỚI CHO TÍNH NĂNG AUTO UPDATE ---
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
    restartToUpdate: () => ipcRenderer.invoke('app:restartToUpdate')
});