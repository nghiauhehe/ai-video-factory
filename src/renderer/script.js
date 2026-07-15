window.alert = msg => {
    const div = document.createElement('div');
    div.style.cssText = "position:fixed; top:20px; right:20px; background:var(--danger); color:#fff; padding:15px 20px; border-radius:8px; z-index:99999; box-shadow:0 4px 15px rgba(0,0,0,0.4); font-weight:bold; transition: 0.3s; transform: translateX(100%); opacity:0;";
    div.innerHTML = `<i class="fa-solid fa-bell"></i> ${msg}`;
    document.body.appendChild(div);
    setTimeout(() => { div.style.transform = 'translateX(0)'; div.style.opacity = '1'; }, 10);
    setTimeout(() => { div.style.transform = 'translateX(100%)'; div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3500);
};
window.confirm = msg => { return true; };

let currentProject = "";
let globalScripts = [];
let globalSources = []; 
let currentSourceIndex = 0; 
let currentSessionCost = 0;
const loadingHtml = `<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>`;

window.toggleCollapse = function(elementId, btnObj) {
    const el = document.getElementById(elementId);
    const icon = btnObj.querySelector('i');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        icon.className = 'fa-solid fa-chevron-up';
    } else {
        el.style.display = 'none';
        icon.className = 'fa-solid fa-chevron-down';
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.ws-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#view-workspace .tab-pane').forEach(p => p.classList.remove('active'));
    
    event.currentTarget.classList.add('active');
    document.getElementById('tab-' + tabId).classList.add('active');

    if(tabId === 'finance') loadFinanceData();
}

window.switchHomeTab = function(tabId) {
    document.querySelectorAll('.home-pane').forEach(p => p.style.display = 'none');
    document.getElementById('home-pane-' + tabId).style.display = tabId === 'dashboard' ? 'flex' : 'block';
    
    document.getElementById('btnHomeProjects').className = tabId === 'projects' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('btnHomeDashboard').className = tabId === 'dashboard' ? 'btn btn-primary' : 'btn btn-secondary';

    if (tabId === 'dashboard') {
        loadGlobalDashboard();
    } else {
        loadHome();
    }
}

let chartServiceInstance = null;
let chartDateInstance = null;

async function loadFinanceData() {
    if(!window.api) return;
    const logs = await window.api.getApiLogs();
    if(!logs || logs.length === 0) return;

    let totalCost = 0;
    let totalCalls = 0;
    let totalVideos = 0;
    
    const serviceCost = { 'kie': 0, 'ever': 0, 'lar': 0 };
    const dateCost = {};

    const tbody = document.getElementById('finTableBody');
    tbody.innerHTML = '';

    logs.forEach(log => {
        if (currentProject && log.projectName !== currentProject && log.projectName !== 'Hệ thống') return;

        totalCalls++;
        totalCost += log.costVND || 0;
        if(serviceCost[log.service] !== undefined) serviceCost[log.service] += log.costVND || 0;
        
        if (log.task && (log.task.includes('Xếp Cảnh') || log.task.includes('Timeline'))) {
            totalVideos++;
        }

        if(!dateCost[log.dateStr]) dateCost[log.dateStr] = 0;
        dateCost[log.dateStr] += log.costVND || 0;

        let badgeClass = log.service === 'kie' ? 'badge-kie' : (log.service === 'ever' ? 'badge-ever' : 'badge-lar');
        let usageStr = log.service === 'kie' ? `${log.usage} cred (${log.tokens} tk)` : `${log.usage} từ`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-muted" style="font-size:11px">${new Date(log.timestamp).toLocaleString('vi-VN')}</td>
            <td style="font-weight:bold">${log.projectName}</td>
            <td><span class="${badgeClass}">${log.service.toUpperCase()}</span></td>
            <td>${log.task}</td>
            <td class="text-muted" style="font-size:11px">${usageStr}</td>
            <td style="text-align:right; color:var(--danger); font-weight:bold">${(log.costVND || 0).toLocaleString('vi-VN')} đ</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('finTotalCost').innerText = totalCost.toLocaleString('vi-VN') + ' đ';
    document.getElementById('finTotalCalls').innerText = totalCalls.toLocaleString('vi-VN');
    document.getElementById('finTotalVideos').innerText = totalVideos.toLocaleString('vi-VN');
    
    let avgCost = totalVideos > 0 ? Math.round(totalCost / totalVideos) : 0;
    document.getElementById('finAvgCost').innerText = avgCost.toLocaleString('vi-VN') + ' đ';

    const ctxService = document.getElementById('costByServiceChart').getContext('2d');
    if(chartServiceInstance) chartServiceInstance.destroy();
    chartServiceInstance = new Chart(ctxService, {
        type: 'doughnut',
        data: {
            labels: ['Kie.ai', 'EverAI', 'LarVoice'],
            datasets: [{
                data: [serviceCost.kie, serviceCost.ever, serviceCost.lar],
                backgroundColor: ['#818CF8', '#34D399', '#FBBF24'],
                borderColor: '#1E293B', borderWidth: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94A3B8' } }, title: {display: true, text: 'TỶ TRỌNG CHI PHÍ', color: '#F8FAFC'} } }
    });

    const sortedDates = Object.keys(dateCost).sort((a,b) => {
        let [da,ma,ya] = a.split('/'); let [db,mb,yb] = b.split('/');
        return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
    }).slice(-7); 

    const dateData = sortedDates.map(d => dateCost[d]);

    const ctxDate = document.getElementById('costByDateChart').getContext('2d');
    if(chartDateInstance) chartDateInstance.destroy();
    chartDateInstance = new Chart(ctxDate, {
        type: 'bar',
        data: {
            labels: sortedDates,
            datasets: [{
                label: 'Chi phí (VNĐ)',
                data: dateData,
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderColor: '#6366F1', borderWidth: 1, borderRadius: 4
            }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { display: false }, title: {display: true, text: 'CHI TIÊU 7 NGÀY GẦN NHẤT', color: '#F8FAFC'} },
            scales: { 
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: {color: '#94A3B8'} },
                x: { grid: { display: false }, ticks: {color: '#94A3B8'} }
            } 
        }
    });
}

let globalChartServiceInstance = null;
let globalChartDateInstance = null;

async function loadGlobalDashboard() {
    if(!window.api) return;
    document.getElementById('globalDashboardLoading').style.display = 'flex';
    
    try {
        const logs = await window.api.getApiLogs() || [];
        const projs = await window.api.listProjects() || [];
        
        let totalCost = 0;
        let projCostMap = {};
        let serviceCostMap = { 'kie': 0, 'ever': 0, 'lar': 0 };
        let dateCostMap = {};
        
        const tbody = document.getElementById('globalFinTableBody');
        tbody.innerHTML = '';
        
        const recentLogs = logs.slice(0, 100);

        logs.forEach(log => {
            const cost = log.costVND || 0;
            totalCost += cost;
            
            const pName = log.projectName || 'Hệ thống';
            projCostMap[pName] = (projCostMap[pName] || 0) + cost;
            
            if(serviceCostMap[log.service] !== undefined) serviceCostMap[log.service] += cost;
            
            const dStr = log.dateStr;
            if(dStr) dateCostMap[dStr] = (dateCostMap[dStr] || 0) + cost;
        });

        recentLogs.forEach(log => {
            let badgeClass = log.service === 'kie' ? 'badge-kie' : (log.service === 'ever' ? 'badge-ever' : 'badge-lar');
            let usageStr = log.service === 'kie' ? `${log.usage} cred (${log.tokens} tk)` : `${log.usage} từ`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-muted" style="font-size:11px">${new Date(log.timestamp).toLocaleString('vi-VN')}</td>
                <td style="font-weight:bold; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.projectName}">${log.projectName}</td>
                <td><span class="${badgeClass}">${log.service.toUpperCase()}</span></td>
                <td>${log.task}</td>
                <td class="text-muted" style="font-size:11px">${usageStr}</td>
                <td style="text-align:right; color:var(--danger); font-weight:bold">${(log.costVND || 0).toLocaleString('vi-VN')} đ</td>
            `;
            tbody.appendChild(tr);
        });
        
        let topCostProj = "Chưa có";
        let maxCost = -1;
        for (const [p, c] of Object.entries(projCostMap)) {
            if (c > maxCost && p !== 'Hệ thống') { maxCost = c; topCostProj = p; }
        }
        
        let topVideoProj = "Chưa có";
        let maxVideos = -1;
        let globalPendingScripts = 0;
        
        const projStatsPromises = projs.map(async (p) => {
            let vids = [];
            let scripts = [];
            try {
                vids = await window.api.listFinalVideos(p.name, null);
                scripts = await window.api.listScripts(p.name);
            } catch(e) {}
            
            const pending = scripts.filter(s => !s.isRendered).length;
            
            return {
                name: p.name,
                vidCount: vids.length,
                pendingCount: pending
            };
        });
        
        const projStats = await Promise.all(projStatsPromises);
        
        projStats.forEach(stat => {
            if (stat.vidCount > maxVideos) {
                maxVideos = stat.vidCount;
                topVideoProj = stat.name;
            }
            globalPendingScripts += stat.pendingCount;
        });
        
        document.getElementById('globalTotalCost').innerText = totalCost.toLocaleString('vi-VN') + ' đ';
        document.getElementById('globalTopCostProj').innerText = maxCost > 0 ? `${topCostProj} (${maxCost.toLocaleString('vi-VN')} đ)` : "Chưa có";
        document.getElementById('globalTopVideoProj').innerText = maxVideos > 0 ? `${topVideoProj} (${maxVideos} video)` : "Chưa có";
        document.getElementById('globalPendingScripts').innerHTML = `${globalPendingScripts} <span style="font-size: 1rem; color: var(--text-muted)">kịch bản</span>`;
        
        const ctxService = document.getElementById('globalCostByServiceChart').getContext('2d');
        if(globalChartServiceInstance) globalChartServiceInstance.destroy();
        globalChartServiceInstance = new Chart(ctxService, {
            type: 'doughnut',
            data: {
                labels: ['Kie.ai (Vision, GPT)', 'EverAI (Voice)', 'LarVoice (Voice)'],
                datasets: [{
                    data: [serviceCostMap.kie, serviceCostMap.ever, serviceCostMap.lar],
                    backgroundColor: ['#818CF8', '#34D399', '#FBBF24'],
                    borderColor: '#1E293B', borderWidth: 2
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94A3B8' } }, title: {display: true, text: 'TỶ LỆ PHÂN BỔ CHI PHÍ', color: '#F8FAFC'} } }
        });

        const sortedDates = Object.keys(dateCostMap).sort((a,b) => {
            let [da,ma,ya] = a.split('/'); let [db,mb,yb] = b.split('/');
            return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
        }).slice(-7); 

        const dateData = sortedDates.map(d => dateCostMap[d]);

        const ctxDate = document.getElementById('globalCostByDateChart').getContext('2d');
        if(globalChartDateInstance) globalChartDateInstance.destroy();
        globalChartDateInstance = new Chart(ctxDate, {
            type: 'bar',
            data: {
                labels: sortedDates,
                datasets: [{
                    label: 'Chi tiêu (VNĐ)',
                    data: dateData,
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderColor: '#F59E0B', borderWidth: 1, borderRadius: 4
                }]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { display: false }, title: {display: true, text: 'CHI TIÊU 7 NGÀY GẦN NHẤT (TOÀN HỆ THỐNG)', color: '#F8FAFC'} },
                scales: { 
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: {color: '#94A3B8'} },
                    x: { grid: { display: false }, ticks: {color: '#94A3B8'} }
                } 
            }
        });

    } catch(e) {
        console.error(e);
    } finally {
        document.getElementById('globalDashboardLoading').style.display = 'none';
    }
}

if (window.api) {
    window.api.onApiUsage((logEntry) => {
        if (document.getElementById('headerProgressBlock').style.display !== 'none') {
            currentSessionCost += (logEntry.costVND || 0);
            document.getElementById('headerSessionCost').innerHTML = `<i class="fa-solid fa-fire"></i> ${currentSessionCost.toLocaleString('vi-VN')} đ`;
        }
        if(document.getElementById('tab-finance').classList.contains('active')) loadFinanceData();
        if(document.getElementById('home-pane-dashboard').style.display === 'flex') loadGlobalDashboard();
    });

    // --- LẮNG NGHE SỰ KIỆN AUTO UPDATE ---
    if (window.api.onUpdateAvailable) {
        window.api.onUpdateAvailable((event, info) => {
            document.getElementById('updateBanner').style.display = 'block';
            document.getElementById('updateText').innerHTML = `<i class="fa-solid fa-cloud-arrow-down text-primary"></i> Phát hiện bản mới (v${info.version}). Đang tải...`;
        });
        
        window.api.onUpdateProgress((event, progressObj) => {
            const pct = Math.round(progressObj.percent);
            document.getElementById('updateProgressFill').style.width = `${pct}%`;
            document.getElementById('updateText').innerHTML = `<i class="fa-solid fa-cloud-arrow-down text-primary"></i> Đang tải Cập nhật... ${pct}%`;
        });
        
        window.api.onUpdateDownloaded((event, info) => {
            document.getElementById('updateProgressFill').style.width = `100%`;
            document.getElementById('updateText').innerHTML = `<i class="fa-solid fa-circle-check text-success"></i> Đã tải xong bản v${info.version}!`;
            document.getElementById('btnRestartUpdate').style.display = 'block';
        });
    }
}

let currentBigInputId = "";
window.openBigInput = function(title, inputId) {
    currentBigInputId = inputId;
    document.getElementById('bigInputTitle').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> ${title}`;
    document.getElementById('bigInputArea').value = document.getElementById(inputId).value;
    document.getElementById('modalBigInput').style.display = 'flex';
    setTimeout(() => document.getElementById('bigInputArea').focus(), 100);
}
window.saveBigInput = function() {
    if (currentBigInputId) {
        const el = document.getElementById(currentBigInputId);
        el.value = document.getElementById('bigInputArea').value;
        el.dispatchEvent(new Event('change')); 
    }
    document.getElementById('modalBigInput').style.display = 'none';
}

window.saveProductInfo = async function() {
    if (!currentProject || !window.api) return;
    const pName = document.getElementById('piName').value;
    const pDesc = document.getElementById('piDesc').value;
    await window.api.saveProjectConfig(currentProject, { productName: pName, productDesc: pDesc });
};

window.saveProjectSubAndSoundConfig = async function() {
    if (!currentProject || !window.api) return;
    const data = {
        renderEngine: document.getElementById('renderEngine').value,
        subFont: document.getElementById('subFont').value,
        subSize: document.getElementById('subSize').value,
        subC: document.getElementById('subC').value,
        subB: document.getElementById('subB').value,
        subBorderSize: document.getElementById('subBorderSize').value,
        cbNoPunc: document.getElementById('cbNoPunc').checked,
        soundEfPath: document.getElementById('soundEfPath').value,
        keywordSoundPath: document.getElementById('keywordSoundPath').value,
        maxConcurrent: document.getElementById('maxConcurrent').value
    };
    await window.api.saveProjectConfig(currentProject, data);
};

window.saveProjectAutoConfig = async function() {
    if (!currentProject || !window.api) return;
    const provider = document.getElementById('auto_voiceProvider').value;
    const voiceModel = provider === 'larvoice' ? document.getElementById('auto_voiceModelLar').value : document.getElementById('auto_voiceModelEver').value;
    const data = {
        renderEngine: document.getElementById('auto_renderEngine').value,
        auto_count: document.getElementById('auto_count').value,
        auto_scriptDur: document.getElementById('auto_scriptDur').value,
        auto_promptSelect: document.getElementById('auto_promptSelect').value,
        auto_voiceProvider: provider,
        auto_voiceModel: voiceModel,
        auto_vSpeed: document.getElementById('auto_vSpeed').value,
        auto_vPitch: document.getElementById('auto_vPitch').value,
        auto_vVol: document.getElementById('auto_vVol').value,
        
        subFont: document.getElementById('auto_subFont').value,
        subSize: document.getElementById('auto_subSize').value,
        subC: document.getElementById('auto_subC').value,
        subB: document.getElementById('auto_subB').value,
        subBorderSize: document.getElementById('auto_subBorderSize').value,
        cbNoPunc: document.getElementById('auto_cbNoPunc').checked,
        soundEfPath: document.getElementById('auto_soundEfPath').value,
        keywordSoundPath: document.getElementById('auto_keywordSoundPath').value,
        maxConcurrent: document.getElementById('auto_maxCon').value,
        customOutPath: document.getElementById('auto_outPath').value
    };
    await window.api.saveProjectConfig(currentProject, data);
    
    document.getElementById('renderEngine').value = data.renderEngine;
    document.getElementById('subFont').value = data.subFont;
    document.getElementById('subSize').value = data.subSize;
    document.getElementById('subC').value = data.subC;
    document.getElementById('subB').value = data.subB;
    document.getElementById('subBorderSize').value = data.subBorderSize;
    document.getElementById('cbNoPunc').checked = data.cbNoPunc;
    document.getElementById('soundEfPath').value = data.soundEfPath;
    document.getElementById('keywordSoundPath').value = data.keywordSoundPath;
    document.getElementById('maxConcurrent').value = data.maxConcurrent;
    document.getElementById('outPathDisplay').value = data.customOutPath;
};

let currentExpanded = null;
window.openExpanded = function(qId, titleLeft, titleRight) {
    if (document.getElementById('modalExpanded').style.display === 'flex') return;
    currentExpanded = qId;
    document.getElementById('expandedTitleLeft').innerHTML = `<i class="fa-solid fa-sliders"></i> ${titleLeft}`;
    document.getElementById('expandedTitleRight').innerHTML = `<i class="fa-solid fa-list"></i> ${titleRight}`;

    if (qId === 'q1') {
        document.getElementById('expandedLeftBody').appendChild(document.getElementById('q1-inputs'));
        document.getElementById('q1-inputs').style.display = 'block'; 
        document.getElementById('expandedRightBody').appendChild(document.getElementById('q1-list'));
    } else if (qId === 'q2') {
        document.getElementById('expandedLeftBody').appendChild(document.getElementById('scriptControls'));
        document.getElementById('scriptControls').style.display = 'block';
        document.getElementById('expandedRightBody').appendChild(document.getElementById('scriptListUI'));
    }
    document.getElementById('modalExpanded').style.display = 'flex';
}

window.closeExpanded = function() {
    if (!currentExpanded) return;
    if (currentExpanded === 'q1') {
        const q1Content = document.getElementById('q1Content');
        q1Content.appendChild(document.getElementById('q1-inputs'));
        q1Content.appendChild(document.getElementById('q1-list'));
        if (document.getElementById('q1').querySelector('.fa-chevron-down')) {
            document.getElementById('q1-inputs').style.display = 'none';
        }
    } else if (currentExpanded === 'q2') {
        const q2Content = document.getElementById('q2Content');
        q2Content.appendChild(document.getElementById('scriptControls'));
        q2Content.appendChild(document.getElementById('scriptListUI'));
        if (document.getElementById('q2').querySelector('.fa-chevron-down')) {
            document.getElementById('scriptControls').style.display = 'none';
        }
    }
    document.getElementById('modalExpanded').style.display = 'none';
    currentExpanded = null;
}

if (window.api) {
    window.api.onTerminalLog((data) => {
        const term = document.getElementById('terminalLog');
        const div = document.createElement('div');
        div.className = `log-line ${data.type === 'error' ? 'log-error' : ''}`;
        div.textContent = data.msg;
        term.appendChild(div);
        term.scrollTop = term.scrollHeight;
    });

    window.api.on('backend-progress', (event, data) => {
        if(data.task === 'script') {
            const prog = document.getElementById('prog-script');
            prog.style.display = 'inline-block';
            prog.innerHTML = ` - Đang tạo ${data.percent}% ${loadingHtml}`;
            if(data.percent >= 100) prog.style.display = 'none'; 
        }
        else if(data.task === 'voice') {
            const prog = document.getElementById('prog-voice');
            prog.style.display = 'inline-block';
            prog.innerHTML = ` - Đang ghép ${data.percent}% ${loadingHtml}`;
            if(data.percent >= 100) prog.style.display = 'none'; 
        }
        else if(data.task === 'render') {
            const prog = document.getElementById('prog-render');
            prog.style.display = 'inline-block';
            prog.innerHTML = ` - Đang xuất ${data.percent}% ${loadingHtml}`;
            if(data.percent >= 100) prog.style.display = 'none'; 
        }
    });

    window.api.on('render-start', (event, data) => {
        const list = document.getElementById('finalList');
        const placeholder = document.createElement('div');
        placeholder.id = `render_ph_${data.id}`;
        placeholder.className = 'final-card skeleton flex items-center justify-center';
        placeholder.style.height = '90px';
        placeholder.innerHTML = `<span class="text-warning font-bold" style="font-size:1.1rem"><i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý Video: ${data.id}...</span>`;
        list.prepend(placeholder);
    });

    window.api.on('global-progress', (event, pct) => {
        document.getElementById('headerProgressBlock').style.display = 'flex';
        document.getElementById('headerProgressFill').style.width = `${pct}%`;
        document.getElementById('headerProgressText').textContent = `${pct}%`;
        if (pct >= 100) {
            setTimeout(() => {
                document.getElementById('headerProgressBlock').style.display = 'none';
                setRunningState(false);
                window.alert("Dây chuyền Auto đã hoàn tất 100%!");
            }, 1000);
        }
    });

    window.api.on('render-done', () => { loadScripts(); loadFinals(); });

    window.api.onScriptGenerated((scriptData) => {
        globalScripts.unshift(scriptData);
        renderSingleScriptUI(scriptData, globalScripts.length);
        updateStats();
    });
}

window.stopProcess = () => { 
    window.isProcessStopped = true;
    if (window.api) window.api.stopProcess(); 
}

async function setRunningState(isRunning) {
    if(isRunning) {
        window.isProcessStopped = false;
        if (window.api && window.api.resetProcess) await window.api.resetProcess();
        currentSessionCost = 0;
        document.getElementById('headerSessionCost').innerHTML = `<i class="fa-solid fa-fire"></i> 0 đ`;
        document.getElementById('btnStopProcess').style.display = 'inline-flex';
        document.getElementById('headerProgressFill').style.width = '0%';
        document.getElementById('headerProgressText').textContent = '0%';
        document.getElementById('headerProgressBlock').style.display = 'flex';
        
        document.getElementById('btnAutoMode').disabled = true;
        document.getElementById('btnGenScriptBatch').disabled = true;
        document.getElementById('btnGenVoiceBatch').disabled = true;
        document.getElementById('btnRenderBatch').disabled = true;
        document.getElementById('btnScanAll').disabled = true;
    } else {
        document.getElementById('btnStopProcess').style.display = 'none';
        document.getElementById('headerProgressBlock').style.display = 'none';
        
        document.getElementById('btnAutoMode').disabled = false;
        document.getElementById('btnGenScriptBatch').disabled = false;
        document.getElementById('btnGenVoiceBatch').disabled = false;
        document.getElementById('btnRenderBatch').disabled = false;
        document.getElementById('btnScanAll').disabled = false;
    }
}

function toggleVoiceProviderUI() {
    const p = document.getElementById('voiceProvider').value;
    if(p === 'larvoice') {
        document.getElementById('larvoiceGroup').style.display = 'block';
        document.getElementById('everaiGroup').style.display = 'none';
        document.getElementById('btnReloadVoice').style.display = 'inline-flex';
    } else {
        document.getElementById('larvoiceGroup').style.display = 'none';
        document.getElementById('everaiGroup').style.display = 'block';
        document.getElementById('btnReloadVoice').style.display = 'none';
    }
}

window.toggleAutoVoiceUI = function() {
    const p = document.getElementById('auto_voiceProvider').value;
    if(p === 'larvoice') {
        document.getElementById('auto_voiceModelLar').style.display = 'block';
        document.getElementById('auto_voiceModelEver').style.display = 'none';
    } else {
        document.getElementById('auto_voiceModelLar').style.display = 'none';
        document.getElementById('auto_voiceModelEver').style.display = 'block';
    }
}

function loadEverAIVoices() {
    const saved = localStorage.getItem('everai_voices');
    const select = document.getElementById('everaiVoiceModel');
    const autoSelect = document.getElementById('auto_voiceModelEver');
    if(saved) {
        const voices = JSON.parse(saved);
        voices.forEach(v => {
            if(select && !Array.from(select.options).some(opt => opt.value === v.code)) select.add(new Option(v.name, v.code));
            if(autoSelect && !Array.from(autoSelect.options).some(opt => opt.value === v.code)) autoSelect.add(new Option(v.name, v.code));
        });
    }
}

window.addEverAIVoice = function() {
    const name = document.getElementById('evName').value.trim();
    const code = document.getElementById('evCode').value.trim();
    if(!name || !code) return window.alert("Vui lòng nhập đủ Tên và Mã giọng.");
    
    let voices = [];
    try { voices = JSON.parse(localStorage.getItem('everai_voices') || '[]'); } catch(e){}
    if(voices.some(v => v.code === code)) return window.alert("Giọng này đã tồn tại.");
    
    voices.push({name, code});
    localStorage.setItem('everai_voices', JSON.stringify(voices));
    loadEverAIVoices();
    document.getElementById('everaiVoiceModel').value = code;
    document.getElementById('evName').value = ""; document.getElementById('evCode').value = "";
    window.alert("Lưu giọng thành công!");
}

function getAiConfig() { return { apiKey: localStorage.getItem('ai_api_key') || '' }; }

function getVoiceConfig(isAuto = false) {
    let provider, v, s, vo, pi;
    if(isAuto) {
        provider = document.getElementById('auto_voiceProvider').value;
        v = provider === 'larvoice' ? document.getElementById('auto_voiceModelLar').value : document.getElementById('auto_voiceModelEver').value;
        s = document.getElementById('auto_vSpeed').value;
        vo = document.getElementById('auto_vVol').value;
        pi = document.getElementById('auto_vPitch').value;
    } else {
        provider = document.getElementById('voiceProvider').value;
        v = provider === 'larvoice' ? document.getElementById('voiceModel').value : document.getElementById('everaiVoiceModel').value;
        s = document.getElementById('vSpeed').value;
        vo = document.getElementById('vVol').value;
        pi = document.getElementById('vPitch').value;
    }
    return {
        provider: provider, v: v, s: s, vo: vo, pi: pi,
        kLar: localStorage.getItem('larvoice_api_key') || '',
        kEver: localStorage.getItem('everai_api_key') || ''
    };
}

function saveKeys() {
    localStorage.setItem('ai_api_key', document.getElementById('kAI').value.trim());
    localStorage.setItem('larvoice_api_key', document.getElementById('kLar').value.trim());
    localStorage.setItem('everai_api_key', document.getElementById('kEver').value.trim());
    localStorage.setItem('use_proxy', document.getElementById('cbUseProxy').checked);
    document.getElementById('modalSettings').style.display='none';
}

window.changeWorkspacePath = async function() {
    if (!window.api) return;
    const newPath = await window.api.openDirectory();
    if (newPath) {
        const res = await window.api.setWorkspacePath(newPath);
        if (res.success) {
            document.getElementById('workspacePathDisplay').value = newPath;
            window.alert("Đã đổi thư mục làm việc thành công! Hệ thống sẽ tải lại danh sách Dự án mới.");
            loadHome();
        }
    }
};

window.uninstallApp = async function() {
    if (confirm("Bạn có chắc chắn muốn GỠ CÀI ĐẶT phần mềm này khỏi máy tính? Hệ thống sẽ đóng và khởi chạy trình gỡ cài đặt (Uninstaller).")) {
        const res = await window.api.uninstallApp();
        if (res && !res.success) {
            window.alert(res.error);
        }
    }
}

window.clearAllProxies = async function() {
    if (confirm("Toàn bộ file Video Nháp (Proxy) trên tất cả dự án sẽ bị xóa để giải phóng ổ cứng. Quá trình xuất video thật vẫn không bị ảnh hưởng. Tiếp tục?")) {
        const res = await window.api.clearProxies();
        if (res && res.success) {
            window.alert(`Đã dọn dẹp thành công! Giải phóng được ${res.freed} MB dung lượng ổ đĩa.`);
        } else {
            window.alert("Lỗi dọn dẹp: " + res.error);
        }
    }
}

let globalPrompts = [];

async function loadPromptsToDropdown() {
    if (!window.api) return;
    globalPrompts = await window.api.listPrompts() || [];
    
    const mainSelect = document.getElementById('mainPromptSelect');
    const autoSelect = document.getElementById('auto_promptSelect');
    
    let html = `<option value="">-- Tự do sáng tạo --</option>`;
    
    if (globalPrompts.length > 0) {
        html += `<option value="MULTI_PROMPT" style="font-weight:bold; color:var(--success)">-- 🌟 Chế độ Đa Prompt (Xoay Vòng Mỗi Video 1 Mẫu) --</option>`;
    }

    globalPrompts.forEach(p => {
        html += `<option value="${p.id}">${p.name || 'Prompt'}</option>`;
    });

    mainSelect.innerHTML = html;
    autoSelect.innerHTML = html;
}

window.previewSelectedPrompt = function() {
    const id = document.getElementById('mainPromptSelect').value;
    const ta = document.getElementById('mainPromptPreview');
    if (!id) {
        ta.value = "";
        return;
    }
    if (id === 'MULTI_PROMPT') {
        ta.value = "Hệ thống sẽ tự động dùng LUÂN PHIÊN tất cả các Prompt trong thư viện. \nVí dụ: Video 1 dùng Prompt 1, Video 2 dùng Prompt 2, Video 3 dùng Prompt 3...";
        return;
    }
    const p = globalPrompts.find(x => String(x.id) === String(id));
    if (p) ta.value = p.content || "";
}

window.openPromptManager = async function() {
    await loadPromptsToDropdown();
    renderPromptManagerList();
    document.getElementById('modalPromptManager').style.display = 'flex';
};

window.closePromptManager = function() {
    document.getElementById('modalPromptManager').style.display = 'none';
    loadPromptsToDropdown();
};

function renderPromptManagerList() {
    const area = document.getElementById('promptListArea');
    if (!globalPrompts || globalPrompts.length === 0) {
        area.innerHTML = '<div class="text-muted text-center mt-20">Chưa có Prompt nào. Hãy tạo mới.</div>';
        clearPromptEditForm();
        return;
    }

    let html = '';
    globalPrompts.forEach(p => {
        html += `
        <div class="prompt-item" id="prompt_item_${p.id}" onclick="selectPromptToEdit('${p.id}')">
            <div style="font-weight:bold; font-size:1.1rem" class="text-primary">${p.name || 'Prompt'}</div>
            <div class="text-muted text-sm" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${p.content || '...'}</div>
        </div>`;
    });
    area.innerHTML = html;
}

function clearPromptEditForm() {
    document.getElementById('editPromptId').value = "";
    document.getElementById('editPromptName').value = "";
    document.getElementById('editPromptContent').value = "";
}

window.createNewPrompt = function() {
    document.querySelectorAll('.prompt-item').forEach(el => el.classList.remove('active'));
    clearPromptEditForm();
    document.getElementById('editPromptName').focus();
};

window.selectPromptToEdit = function(id) {
    document.querySelectorAll('.prompt-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`prompt_item_${id}`);
    if(activeItem) activeItem.classList.add('active');

    const p = globalPrompts.find(x => String(x.id) === String(id));
    if (p) {
        document.getElementById('editPromptId').value = p.id;
        document.getElementById('editPromptName').value = p.name || "";
        document.getElementById('editPromptContent').value = p.content || "";
    }
};

window.saveEditedPrompt = async function() {
    const btn = document.getElementById('btnSavePrompt');
    try {
        const strId = document.getElementById('editPromptId').value;
        const name = document.getElementById('editPromptName').value.trim();
        const content = document.getElementById('editPromptContent').value.trim();

        if(!name || !content) return window.alert("Vui lòng nhập Tên và Nội dung Prompt.");

        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;
        btn.disabled = true;

        if (window.api) {
            if (strId) {
                const res = await window.api.updatePrompt(strId, { name, content });
                if (res && res.error) throw new Error(res.error);
                window.alert("Cập nhật Prompt thành công!");
            } else {
                await window.api.savePrompt({ name, content });
                window.alert("Tạo Prompt mới thành công!");
            }
        }
        
        await loadPromptsToDropdown();
        renderPromptManagerList();
    } catch (e) {
        window.alert("Lỗi lưu Prompt: " + e.message);
    } finally {
        if(btn) {
            btn.innerHTML = `<i class="fa-solid fa-save"></i> Lưu Thay Đổi`;
            btn.disabled = false;
        }
    }
};

window.deleteEditedPrompt = async function() {
    const strId = document.getElementById('editPromptId').value;
    if (!strId) return window.alert("Chưa chọn Prompt nào để xóa.");

    if (confirm("Bạn có chắc chắn muốn xóa Prompt này?")) {
        try {
            if (window.api) {
                const res = await window.api.deletePrompt(strId);
                if (res && res.error) throw new Error(res.error);
            }
            clearPromptEditForm();
            await loadPromptsToDropdown();
            renderPromptManagerList();
        } catch(e) {
            window.alert("Lỗi xóa Prompt: " + e.message);
        }
    }
};

window.openAutoModal = function() {
    document.getElementById('auto_outPath').value = document.getElementById('outPathDisplay').value;
    document.getElementById('modalAuto').style.display='flex';
}

window.runAutoPipelineMode = async function() {
    if (!window.api) return;
    const conf = getAiConfig();
    const vConf = getVoiceConfig(true); 
    
    if (!conf.apiKey) return window.alert("Thiếu API Key Kie.ai!");
    if (vConf.provider === 'larvoice' && !vConf.kLar) return window.alert("Thiếu API Key Larvoice!");
    if (vConf.provider === 'everai' && !vConf.kEver) return window.alert("Thiếu API Key EverAI!");

    const count = parseInt(document.getElementById('auto_count').value) || 5;
    document.getElementById('modalAuto').style.display='none';
    
    const promptId = document.getElementById('auto_promptSelect').value;
    let promptContent = "";
    
    if (promptId === 'MULTI_PROMPT') {
        promptContent = globalPrompts.map(p => p.content).filter(c => c);
    } else if (promptId) {
        const pObj = globalPrompts.find(x => String(x.id) === String(promptId));
        if (pObj) promptContent = pObj.content;
    }

    const d = document.getElementById('auto_scriptDur').value;
    const productData = { name: document.getElementById('piName').value, desc: document.getElementById('piDesc').value };
    
    const subConfig = { 
        useGPU: document.getElementById('auto_renderEngine').value === 'gpu',
        textColor: document.getElementById('auto_subC').value, 
        borderColor: document.getElementById('auto_subB').value, 
        fontSize: document.getElementById('auto_subSize').value, 
        borderSize: document.getElementById('auto_subBorderSize').value, 
        fontName: document.getElementById('auto_subFont').value, 
        removePunc: document.getElementById('auto_cbNoPunc').checked, 
        customSoundPath: document.getElementById('auto_soundEfPath').value,
        keywordSoundPath: document.getElementById('auto_keywordSoundPath').value 
    };
    const maxCon = parseInt(document.getElementById('auto_maxCon').value) || 3;
    const customOut = document.getElementById('auto_outPath').value || null;

    await window.api.saveProjectConfig(currentProject, { productName: productData.name, productDesc: productData.desc });
    await setRunningState(true);
    document.getElementById('scriptListUI').innerHTML = ""; globalScripts = []; updateStats();

    try {
        await window.api.runAutoPipeline(currentProject, conf, vConf, promptContent, count, productData, d, subConfig, maxCon, customOut);
    } catch(e) {
        window.alert("Dừng tiến trình do: " + e.message);
        await setRunningState(false);
    }
}

async function executeGenScripts(countOverride = null) {
    if (!window.api) return;
    const conf = getAiConfig();
    if(!conf.apiKey) return window.alert("Thiếu API Key Kie.ai!");
    
    const c = countOverride || parseInt(document.getElementById('scriptCount').value);
    const d = document.getElementById('scriptDur').value;
    
    const promptId = document.getElementById('mainPromptSelect').value;
    let promptContent = "";
    if (promptId === 'MULTI_PROMPT') {
        promptContent = globalPrompts.map(p => p.content).filter(c => c);
    } else {
        promptContent = document.getElementById('mainPromptPreview').value; 
    }
    
    const productData = { name: document.getElementById('piName').value, desc: document.getElementById('piDesc').value };
    await window.api.saveProjectConfig(currentProject, { productName: productData.name, productDesc: productData.desc });

    const btn = document.getElementById('btnGenScriptBatch');
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Chờ...`;
    
    document.getElementById('scriptListUI').innerHTML = `<div class="skeleton" style="height: 120px"></div><div class="skeleton" style="height: 120px"></div>`;
    globalScripts = []; updateStats();

    try {
        const res = await window.api.generateScriptsBatch(currentProject, conf, promptContent, c, productData, d);
        if(res && !res.success) window.alert("Lỗi Gen Script: " + (res.error || "Không rõ lỗi"));
    } catch(e) { window.alert("Lỗi hệ thống: " + e.message); }
    
    btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-bolt"></i> TẠO MỚI`;
}

async function executeGenVoices() {
    if (!window.api) return;
    const vConf = getVoiceConfig();
    if (vConf.provider === 'larvoice' && !vConf.kLar) return window.alert("Thiếu API Key Larvoice!");
    if (vConf.provider === 'everai' && !vConf.kEver) return window.alert("Thiếu API Key EverAI!");
    
    const btn = document.getElementById('btnGenVoiceBatch');
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Chờ...`;
    await window.api.generateVoiceBatch(currentProject, vConf);
    btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> LỒNG TIẾNG TOÀN BỘ KỊCH BẢN`;
    await loadScripts(); 
}

async function executeRenderBatch(customIds = null) {
    if (!window.api) return;
    const conf = getAiConfig();
    if(!conf.apiKey) return window.alert("Thiếu API Key Kie.ai!");
    
    const sub = { 
        useGPU: document.getElementById('renderEngine').value === 'gpu',
        textColor: document.getElementById('subC').value, 
        borderColor: document.getElementById('subB').value, 
        fontSize: document.getElementById('subSize').value, 
        borderSize: document.getElementById('subBorderSize').value, 
        fontName: document.getElementById('subFont').value, 
        removePunc: document.getElementById('cbNoPunc').checked, 
        customSoundPath: document.getElementById('soundEfPath').value,
        keywordSoundPath: document.getElementById('keywordSoundPath').value 
    };
    const maxCon = parseInt(document.getElementById('maxConcurrent').value) || 3;
    
    const validIds = customIds || globalScripts.filter(x => x.voicePath && !x.isRendered).map(x => x.id);
    if(validIds.length === 0) return window.alert("Không có kịch bản nào cần xuất.");
    
    const btn = document.getElementById('btnRenderBatch');
    const customOut = document.getElementById('outPathDisplay').value || null;
    
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Chờ...`;
    
    validIds.forEach(id => {
        if(!document.getElementById(`render_ph_${id}`)) {
            const list = document.getElementById('finalList');
            const placeholder = document.createElement('div');
            placeholder.id = `render_ph_${id}`;
            placeholder.className = 'final-card skeleton flex items-center justify-center';
            placeholder.style.height = '90px';
            placeholder.innerHTML = `<span class="text-warning font-bold" style="font-size:1.1rem"><i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý Video: ${id}...</span>`;
            list.prepend(placeholder);
        }
    });

    await window.api.renderVideoBatch(currentProject, conf, sub, validIds, maxCon, customOut);
    btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-play"></i> BẮT ĐẦU XUẤT THỦ CÔNG`;
    
    await loadScripts(); 
    await loadFinals();
}

async function chooseSoundFile(targetInputId) {
    if (!window.api) return;
    const filePath = await window.api.openAudioFile();
    if(filePath) {
        document.getElementById(targetInputId).value = filePath;
        if (targetInputId === 'soundEfPath' || targetInputId === 'keywordSoundPath') {
            await saveProjectSubAndSoundConfig();
        } else if (targetInputId === 'auto_soundEfPath' || targetInputId === 'auto_keywordSoundPath') {
            await saveProjectAutoConfig();
        }
    }
}

window.chooseOutputFolder = async function(targetInputId) {
    if (!window.api) return;
    const path = await window.api.openDirectory();
    if(path) {
        document.getElementById(targetInputId).value = path;
        const cfg = await window.api.getProjectConfig(currentProject) || {};
        cfg.customOutPath = path;
        await window.api.saveProjectConfig(currentProject, cfg);
        loadFinals();
        
        if (targetInputId === 'outPathDisplay') {
            document.getElementById('auto_outPath').value = path;
        } else if (targetInputId === 'auto_outPath') {
            document.getElementById('outPathDisplay').value = path;
        }
    }
};

window.openOutputFolder = function(targetInputId) {
    if (!window.api) return;
    let p = document.getElementById(targetInputId).value;
    if (!p) window.api.openDefaultOutputDir(currentProject);
    else window.api.openPath(p);
};

window.playFinalVideo = function(path) {
    document.getElementById('vidPlayer').src = path;
    document.getElementById('modalVideoPlayer').style.display = 'flex';
    document.getElementById('vidPlayer').play();
}

window.closePlayer = function() {
    document.getElementById('modalVideoPlayer').style.display = 'none';
    document.getElementById('vidPlayer').pause();
}

let currentAudioObj = null;
window.playAudioVoice = function(path) {
    if(currentAudioObj) {
        currentAudioObj.pause();
        currentAudioObj.currentTime = 0;
    }
    currentAudioObj = new Audio(path);
    currentAudioObj.play();
}

async function loadProductImages() {
    if (!currentProject || !window.api) return;
    const list = document.getElementById('productImagesList');
    const images = await window.api.listProductImages(currentProject);
    if (images.length === 0) {
        list.innerHTML = '<span class="text-muted text-xs" style="margin:auto">Chưa có ảnh mẫu nào. Bấm nút (+) để thêm.</span>';
        return;
    }
    list.innerHTML = images.map(img => `<img src="file:///${img.replace(/\\/g, '/')}" style="width: 55px; height: 55px; object-fit: cover; border-radius: 6px; border: 1px solid var(--primary); box-shadow: 0 2px 5px rgba(0,0,0,0.5)">`).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('btnThoat').onclick = () => {
        currentProject = "";
        document.getElementById('view-workspace').classList.remove('active');
        document.getElementById('view-home').classList.add('active');
        switchHomeTab('projects');
        if (document.getElementById('btnStopProcess').style.display !== 'none') stopProcess();
        const vidPreview = document.getElementById('vidPreview');
        if (vidPreview) vidPreview.pause();
        loadHome();
    };

    document.getElementById('kAI').value = localStorage.getItem('ai_api_key') || "";
    document.getElementById('kLar').value = localStorage.getItem('larvoice_api_key') || "";
    document.getElementById('kEver').value = localStorage.getItem('everai_api_key') || "";
    document.getElementById('cbUseProxy').checked = localStorage.getItem('use_proxy') === 'true';

    if (window.api && window.api.getWorkspacePath) {
        window.api.getWorkspacePath().then(p => {
            const el = document.getElementById('workspacePathDisplay');
            if(el) el.value = p;
        });
    }

    document.getElementById('fpsSlider').addEventListener('input', e => document.getElementById('fpsVal').textContent = e.target.value);

    if (window.api) {
        const fonts = await window.api.getSystemFonts();
        const fontList = document.getElementById('sysFonts');
        let fontHtml = "";
        fonts.forEach(f => fontHtml += `<option value="${f}">`);
        fontList.innerHTML = fontHtml;
    }
    document.getElementById('subFont').value = "Arial"; 
    document.getElementById('auto_subFont').value = "Arial";

    const cachedVoices = localStorage.getItem('cached_voices');
    if(cachedVoices) renderVoiceOptions(JSON.parse(cachedVoices));
    loadEverAIVoices();

    switchHomeTab('projects');
    loadPromptsToDropdown();

    document.getElementById('btnSaveVidMeta').onclick = async () => {
        if (!window.api) return;
        const fileName = document.getElementById('vidFileName').value;
        if(!fileName) return;
        
        const btn = document.getElementById('btnSaveVidMeta');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;
        btn.disabled = true;
        
        try {
            let meta = await window.api.getMetadata(currentProject, fileName) || {};
            meta.Description = document.getElementById('vidDescription').value;
            meta.Action = document.getElementById('vidAction').value;
            meta.Object = document.getElementById('vidObject').value;
            meta.Scene = document.getElementById('vidScene').value;
            meta.Camera = document.getElementById('vidCamera').value;
            meta.Purpose = document.getElementById('vidPurpose').value;
            meta.Keyword = document.getElementById('vidKeyword').value;
            
            delete meta.MainContent; 
            
            await window.api.saveMetadata(currentProject, fileName, meta);
            window.alert("Đã lưu nội dung thành công!");
            loadSources(); 
        } catch(e) { window.alert("Lỗi lưu metadata: " + e.message); }
        
        btn.innerHTML = `<i class="fa-solid fa-save"></i> Cập Nhật`;
        btn.disabled = false;
    };

    document.getElementById('btnVerifyVidMeta').onclick = async () => {
        if (!window.api) return;
        const fileName = document.getElementById('vidFileName').value;
        if(!fileName) return;
        
        const btn = document.getElementById('btnVerifyVidMeta');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang duyệt...`;
        btn.disabled = true;
        
        try {
            let meta = await window.api.getMetadata(currentProject, fileName) || {};
            meta.Description = document.getElementById('vidDescription').value;
            meta.Action = document.getElementById('vidAction').value;
            meta.Object = document.getElementById('vidObject').value;
            meta.Scene = document.getElementById('vidScene').value;
            meta.Camera = document.getElementById('vidCamera').value;
            meta.Purpose = document.getElementById('vidPurpose').value;
            meta.Keyword = document.getElementById('vidKeyword').value;
            meta.isVerified = true; 
            
            await window.api.saveMetadata(currentProject, fileName, meta);
            
            if (currentSourceIndex < globalSources.length - 1) {
                await window.navigateVideo(1);
            } else {
                window.alert("Đã hoàn thành kiểm duyệt toàn bộ video!");
                document.getElementById('modalVideoEditor').style.display='none';
                document.getElementById('vidPreview').pause();
            }
            loadSources(); 
        } catch(e) { window.alert("Lỗi duyệt metadata: " + e.message); }
        
        btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Duyệt & Next`;
        btn.disabled = false;
    };

    document.getElementById('btnUploadImages').onclick = async () => {
        if (!window.api || !currentProject) return window.alert("Vui lòng tạo/chọn dự án trước!");
        const files = await window.api.openImageFiles();
        if (files && files.length > 0) {
            await window.api.uploadProductImages(currentProject, files);
            loadProductImages();
        }
    };

    document.getElementById('btnUpload').onclick = async () => {
        if (!window.api) return;
        const files = await window.api.openVideoFiles();
        if(files.length > 0) { 
            await window.api.uploadSources(currentProject, files); 
            await loadSources(); 
            triggerProxyGeneration(); 
        }
    };

    document.getElementById('btnScanAll').onclick = async (e) => {
        if (!window.api) return;
        const apiKey = localStorage.getItem('ai_api_key');
        if(!apiKey) return window.alert("Cần cấu hình API Key Kie.ai để quét Vision!");
        const fps = document.getElementById('fpsSlider').value;
        const btn = e.currentTarget;

        try {
            const sources = await window.api.listSources(currentProject);
            const pending = sources.filter(s => s.status !== 'done');
            if(pending.length === 0) throw new Error("No pending");

            btn.disabled = true;
            const prog = document.getElementById('prog-scan');
            prog.style.display = 'inline-block';

            window.api.onTerminalLog({msg: `Bắt đầu quét hàng loạt ${pending.length} file (5 luồng)...`, type: 'info'});
            await setRunningState(true);

            let totalProcessed = 0;
            const maxCon = 5;

            for(let i = 0; i < pending.length; i += maxCon) {
                if (window.isProcessStopped) break;
                
                const chunk = pending.slice(i, i + maxCon);
                const promises = chunk.map(async (s) => {
                    if (window.isProcessStopped) return;
                    try {
                        await window.api.analyzeSource(currentProject, s.fileName, apiKey, fps);
                    } catch(err) {
                        window.api.onTerminalLog({msg: `Lỗi quét file ${s.fileName}: ${err.message}`, type: 'error'});
                    } finally {
                        totalProcessed++;
                        const pct = Math.round((totalProcessed / pending.length) * 100);
                        prog.innerHTML = ` - Đang quét ${pct}% ${loadingHtml}`;
                    }
                });
                
                await Promise.all(promises);
            }
            
            prog.style.display = 'none';
            btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Quét Tất Cả Chờ AI`;
            btn.disabled = false;
            loadSources();
            if(!window.isProcessStopped) window.alert("Đã quét xong toàn bộ tài nguyên!");
        } catch(err) {
            if(err.message === "No pending") window.alert("Không có video nào cần quét!");
            else window.alert("Lỗi quét: " + err.message);
            btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Quét Tất Cả Chờ AI`;
            btn.disabled = false;
        }
        await setRunningState(false);
    };

    document.getElementById('btnDownloadYT').onclick = async () => {
        if (!window.api) return;
        const link = document.getElementById('ytLink').value.trim();
        const apiKey = localStorage.getItem('ai_api_key');
        if(!link) return window.alert("Vui lòng nhập Link YT/TikTok!");
        if(!apiKey) return window.alert("Cần cấu hình API Key Kie.ai để quét Vision!");
        
        document.getElementById('btnDownloadYT').innerHTML = `Đang tải ${loadingHtml}`;
        document.getElementById('btnDownloadYT').disabled = true;
        try {
            const fps = document.getElementById('fpsSlider').value;
            await window.api.downloadAndAnalyze(currentProject, link, apiKey, fps);
            document.getElementById('ytLink').value = "";
            await loadSources();
            triggerProxyGeneration(); 
        } catch(e) {}
        document.getElementById('btnDownloadYT').innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Tải & Quét`;
        document.getElementById('btnDownloadYT').disabled = false;
    };

    document.getElementById('btnGenScriptBatch').onclick = async () => {
        await setRunningState(true);
        try { await executeGenScripts(); } catch(e) { window.alert(e.message); }
        await setRunningState(false);
    };

    document.getElementById('btnGenVoiceBatch').onclick = async () => {
        await setRunningState(true);
        try { await executeGenVoices(); } catch(e) { window.alert(e.message); }
        await setRunningState(false);
    };

    document.getElementById('btnRenderBatch').onclick = async () => {
        await setRunningState(true);
        try { await executeRenderBatch(); } catch(e) { window.alert(e.message); }
        await setRunningState(false);
    };

    document.getElementById('btnReloadVoice').onclick = async () => {
        if (!window.api) return;
        const apiKey = localStorage.getItem('larvoice_api_key');
        if(!apiKey) return window.alert("Vui lòng cấu hình API Key LarVoice trong phần Cài đặt trước!");
        
        const btn = document.getElementById('btnReloadVoice');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...`;
        btn.disabled = true;
        
        try {
            const voices = await window.api.getLarVoices(apiKey);
            if (voices && voices.length > 0) {
                renderVoiceOptions(voices);
                localStorage.setItem('cached_voices', JSON.stringify(voices));
                window.alert("Đã tải danh sách giọng đọc LarVoice thành công!");
            } else {
                window.alert("Không tìm thấy giọng đọc nào, vui lòng kiểm tra lại API Key.");
            }
        } catch (e) {
            window.alert("Lỗi tải giọng: " + e.message);
        }
        
        btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Load (Lar)`;
        btn.disabled = false;
    };

    const subInputs = ['renderEngine', 'subFont', 'subSize', 'subC', 'subB', 'subBorderSize', 'cbNoPunc', 'maxConcurrent'];
    subInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => saveProjectSubAndSoundConfig());
            if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'color') {
                el.addEventListener('input', () => saveProjectSubAndSoundConfig());
            }
        }
    });

    const autoInputs = ['auto_renderEngine', 'auto_count', 'auto_scriptDur', 'auto_promptSelect', 'auto_voiceProvider', 'auto_voiceModelLar', 'auto_voiceModelEver', 'auto_vSpeed', 'auto_vPitch', 'auto_vVol', 'auto_subFont', 'auto_subSize', 'auto_subC', 'auto_subB', 'auto_subBorderSize', 'auto_cbNoPunc', 'auto_maxCon'];
    autoInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => saveProjectAutoConfig());
            if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'color') {
                el.addEventListener('input', () => saveProjectAutoConfig());
            }
        }
    });
});

window.scanSingleVideo = async function(fileName) {
    if (!window.api) return;
    const apiKey = localStorage.getItem('ai_api_key');
    if(!apiKey) return window.alert("Cần cấu hình API Key Kie.ai để quét Vision!");
    const fps = document.getElementById('fpsSlider').value;
    event.stopPropagation();
    const btn = event.currentTarget;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...`;
    btn.disabled = true;
    try { await window.api.analyzeSource(currentProject, fileName, apiKey, fps); loadSources(); } 
    catch(e) { window.alert("Lỗi: " + e.message); btn.innerHTML = `<i class="fa-solid fa-robot"></i> Quét AI`; btn.disabled = false; }
}

function renderVoiceOptions(v) { 
    const opts = v.map(x => `<option value="${x.voice_id}">${x.name} (${x.gender==='male'?'Nam':'Nữ'})</option>`).join('');
    document.getElementById('voiceModel').innerHTML = opts; 
    document.getElementById('auto_voiceModelLar').innerHTML = opts;
}

window.submitNewProject = async function() {
    if (!window.api) return;
    const n = document.getElementById('newProjName').value.trim();
    if (!n) return window.alert("Vui lòng nhập tên dự án!");
    const btn = document.querySelector('#modalNewProject .btn-primary');
    const oldText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo...`;
    const res = await window.api.createProject(n);
    btn.innerHTML = oldText;
    if (res && res.success) { document.getElementById('modalNewProject').style.display = 'none'; await loadHome(); openProject(res.name || n); } else window.alert("Lỗi tạo dự án: " + (res?.error || "Không rõ lỗi"));
}

async function loadHome() {
    if (!window.api) return;
    const grid = document.getElementById('projectGrid');
    grid.innerHTML = ''; 
    const createNewDiv = document.createElement('div');
    createNewDiv.className = 'project-card create-new';
    createNewDiv.innerHTML = `<i class="fa-solid fa-folder-plus fa-3x mb-10"></i><span style="font-weight:600">Tạo Mới</span>`;
    createNewDiv.onclick = () => { document.getElementById('newProjName').value = ''; document.getElementById('modalNewProject').style.display = 'flex'; document.getElementById('newProjName').focus(); };
    grid.appendChild(createNewDiv);

    const projs = await window.api.listProjects();
    projs.forEach(p => {
        const validName = p.name || 'Unnamed_Project'; 
        const div = document.createElement('div');
        div.className = 'project-card';
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-del-proj';
        btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btnDel.onclick = (e) => { e.stopPropagation(); if(confirm(`Xóa vĩnh viễn dự án: ${validName}?`)) window.api.deleteProject(validName).then(() => loadHome()); };
        const icon = document.createElement('i'); icon.className = 'fa-solid fa-folder fa-3x mb-10 text-primary';
        const title = document.createElement('strong'); title.style.cssText = 'font-size:1.1rem; max-width: 80%; overflow:hidden; text-overflow:ellipsis; text-align:center; white-space:nowrap;'; title.textContent = validName;
        div.appendChild(btnDel); div.appendChild(icon); div.appendChild(title);
        div.onclick = () => openProject(validName);
        grid.appendChild(div);
    });
}

let hasCachedShotlist = false;
let currentShotlistData = null;

async function openProject(name) {
    if (!name || !window.api) return; 
    currentProject = name;

    hasCachedShotlist = false;
    currentShotlistData = null;

    document.getElementById('lblProjectName').textContent = name;
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-workspace').classList.add('active');
    
    document.getElementById('sourceList').innerHTML = `<div class="skeleton" style="height: 70px"></div><div class="skeleton" style="height: 70px"></div>`;
    document.getElementById('scriptListUI').innerHTML = `<div class="skeleton" style="height: 120px"></div><div class="skeleton" style="height: 120px"></div>`;
    document.getElementById('finalList').innerHTML = `<div class="skeleton" style="height: 90px"></div><div class="skeleton" style="height: 90px"></div>`;
    
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const cfg = await window.api.getProjectConfig(name);
    if(cfg) { 
        document.getElementById('piName').value = cfg.productName || ""; 
        document.getElementById('piDesc').value = cfg.productDesc || ""; 
        document.getElementById('outPathDisplay').value = cfg.customOutPath || ""; 
        
        document.getElementById('renderEngine').value = cfg.renderEngine || "gpu";
        document.getElementById('subFont').value = cfg.subFont || "Arial";
        document.getElementById('subSize').value = cfg.subSize || "24";
        document.getElementById('subC').value = cfg.subC || "#FFFFFF";
        document.getElementById('subB').value = cfg.subB || "#000000";
        document.getElementById('subBorderSize').value = cfg.subBorderSize || "2";
        document.getElementById('cbNoPunc').checked = cfg.cbNoPunc !== undefined ? cfg.cbNoPunc : true;
        document.getElementById('soundEfPath').value = cfg.soundEfPath || "";
        document.getElementById('keywordSoundPath').value = cfg.keywordSoundPath || "";
        document.getElementById('maxConcurrent').value = cfg.maxConcurrent || "3";

        document.getElementById('auto_renderEngine').value = cfg.renderEngine || "gpu";
        document.getElementById('auto_subFont').value = cfg.subFont || "Arial";
        document.getElementById('auto_subSize').value = cfg.subSize || "24";
        document.getElementById('auto_subC').value = cfg.subC || "#FFFFFF";
        document.getElementById('auto_subB').value = cfg.subB || "#000000";
        document.getElementById('auto_subBorderSize').value = cfg.subBorderSize || "2";
        document.getElementById('auto_cbNoPunc').checked = cfg.cbNoPunc !== undefined ? cfg.cbNoPunc : true;
        document.getElementById('auto_soundEfPath').value = cfg.soundEfPath || "";
        document.getElementById('auto_keywordSoundPath').value = cfg.keywordSoundPath || "";
        document.getElementById('auto_maxCon').value = cfg.maxConcurrent || "3";
        document.getElementById('auto_outPath').value = cfg.customOutPath || "";
        
        document.getElementById('auto_count').value = cfg.auto_count || "5";
        document.getElementById('auto_scriptDur').value = cfg.auto_scriptDur || "60s";
        document.getElementById('auto_promptSelect').value = cfg.auto_promptSelect || "";
        document.getElementById('auto_voiceProvider').value = cfg.auto_voiceProvider || "larvoice";
        toggleAutoVoiceUI(); 
        setTimeout(() => {
            if (cfg.auto_voiceProvider === 'larvoice') {
                document.getElementById('auto_voiceModelLar').value = cfg.auto_voiceModel || "";
            } else {
                document.getElementById('auto_voiceModelEver').value = cfg.auto_voiceModel || "";
            }
        }, 100);
        document.getElementById('auto_vSpeed').value = cfg.auto_vSpeed || "1.1";
        document.getElementById('auto_vPitch').value = cfg.auto_vPitch || "1";
        document.getElementById('auto_vVol').value = cfg.auto_vVol || "0";
    } else {
        document.getElementById('piName').value = ""; 
        document.getElementById('piDesc').value = ""; 
        document.getElementById('outPathDisplay').value = ""; 
        
        document.getElementById('renderEngine').value = "gpu";
        document.getElementById('subFont').value = "Arial";
        document.getElementById('subSize').value = "24";
        document.getElementById('subC').value = "#FFFFFF";
        document.getElementById('subB').value = "#000000";
        document.getElementById('subBorderSize').value = "2";
        document.getElementById('cbNoPunc').checked = true;
        document.getElementById('soundEfPath').value = "";
        document.getElementById('keywordSoundPath').value = "";
        document.getElementById('maxConcurrent').value = "3";
    }
    
    await loadPromptsToDropdown();
    loadProductImages(); 
    loadSources(); loadScripts(); loadFinals();
}

async function triggerProxyGeneration() {
    if (localStorage.getItem('use_proxy') !== 'true' || !window.api) return;
    for (const src of globalSources) {
        window.api.generateProxy(currentProject, src.fileName);
    }
}

function updateResourceAudit() {
    const panel = document.getElementById('resourceAuditPanel');
    const doneSources = globalSources.filter(s => s.status === 'done');
    const totalSources = globalSources.length;

    if (totalSources === 0) {
        panel.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); padding: 15px; border-radius: 8px;">
            <div class="flex gap-10 items-center">
                <i class="fa-solid fa-triangle-exclamation text-danger" style="font-size: 1.5rem;"></i>
                <div>
                    <strong class="text-danger">KHO TÀI NGUYÊN TRỐNG!</strong>
                    <div class="text-muted text-sm mt-5">Vui lòng tải lên video gốc để hệ thống có thể phân tích và dự báo sản lượng xuất video.</div>
                </div>
            </div>
            <div class="mt-15">
                <button class="btn btn-ai w-full" style="padding: 10px; font-weight: bold;" onclick="openShotlistModal()">
                    <i class="fa-solid fa-clapperboard"></i> Gọi AI D.O.P Lên Kế Hoạch Quay Bổ Sung
                </button>
            </div>
        </div>`;
        panel.style.display = 'block';
        return;
    }

    if (doneSources.length === 0) {
        panel.style.display = 'none';
        return;
    }

    let countHook = 0, countBody = 0, countCTA = 0;
    let overUsedCount = 0;
    let criticalOverUsedCount = 0;
    
    const safeLimit = Math.max(5, Math.floor(totalSources / 5));

    for (const src of doneSources) {
        if ((src.usageCount || 0) > safeLimit) overUsedCount++;
        if ((src.usageCount || 0) >= (safeLimit * 2)) criticalOverUsedCount++;

        const txt = (src.searchData || '').toLowerCase();
        if (txt.includes('giỏ hàng') || txt.includes('chỉ tay') || txt.includes('mua') || txt.includes('chốt') || txt.includes('cta') || txt.includes('kêu gọi')) {
            countCTA++;
        } 
        else if (txt.includes('mở hộp') || txt.includes('đập hộp') || txt.includes('bất ngờ') || txt.includes('hook') || txt.includes('gây chú ý') || txt.includes('tò mò')) {
            countHook++;
        } 
        else {
            countBody++;
        }
    }

    const capHook = countHook * safeLimit;
    const capBody = countBody * safeLimit;
    const capCTA = countCTA * safeLimit;

    const maxFromHook = capHook; 
    const maxFromBody = Math.floor(capBody / 3); 
    const maxFromCTA = capCTA; 

    const currentMaxYield = Math.min(maxFromHook, maxFromBody, maxFromCTA);
    const targetYield = Math.max(maxFromHook, maxFromBody, maxFromCTA);

    let bottleneck = [];
    if (currentMaxYield === maxFromHook && countHook < targetYield) bottleneck.push('Mở đầu (Hook)');
    if (currentMaxYield === maxFromBody && Math.floor(capBody/3) < targetYield) bottleneck.push('Thân bài (B-roll)');
    if (currentMaxYield === maxFromCTA && countCTA < targetYield) bottleneck.push('Chốt sale (CTA)');
    if (bottleneck.length === 0) bottleneck.push('Rất Cân Bằng');

    let missingHook = Math.max(0, Math.ceil(((targetYield * 1) - capHook) / safeLimit));
    let missingBody = Math.max(0, Math.ceil(((targetYield * 3) - capBody) / safeLimit));
    let missingCTA = Math.max(0, Math.ceil(((targetYield * 1) - capCTA) / safeLimit));

    let alertHtml = '';
    if (overUsedCount > Math.floor(totalSources * 0.25) || criticalOverUsedCount > 0) {
         let reasonMsg = criticalOverUsedCount > 0 
            ? `Có video đã bị lạm dụng nghiêm trọng vượt quá ${safeLimit * 2} lần!` 
            : `Có hơn 25% lượng clip trong kho đã vượt quá Hạn mức lặp lại an toàn (${safeLimit} lần).`;
            
         alertHtml = `
         <div class="mb-10 p-10" style="background: rgba(239, 68, 68, 0.15); border-left: 3px solid var(--danger); border-radius: 4px;">
            <div class="text-danger font-bold text-sm"><i class="fa-solid fa-triangle-exclamation"></i> CẢNH BÁO TÀI NGUYÊN CẠN KIỆT!</div>
            <div class="text-muted text-sm mt-5">${reasonMsg} Hãy đi quay bù video gốc mới để tránh bị TikTok đánh gậy spam.</div>
         </div>`;
    }

    let suggestionHtml = '';
    if (missingHook > 0 || missingBody > 0 || missingCTA > 0) {
        suggestionHtml = `
        <div class="mt-15 p-10" style="background: rgba(245, 158, 11, 0.1); border: 1px dashed var(--warning); border-radius: 6px;">
            <div class="text-warning font-bold text-sm mb-5"><i class="fa-solid fa-lightbulb"></i> Báo Cáo Thiếu Hụt & Gợi Ý Quay Thêm:</div>
            <div class="text-muted text-sm">Để bào kiệt rổ tài nguyên hiện có và đạt sản lượng khổng lồ <b>${targetYield} Video</b>, đội Media cần xách máy đi quay bù gấp:</div>
            <ul class="text-sm mt-5 mb-5" style="padding-left: 20px; color: var(--text-main);">
                ${missingHook > 0 ? `<li><b>${missingHook} clip Hook</b> (Đập hộp, biểu cảm bất ngờ, zoom in nhanh...)</li>` : ''}
                ${missingBody > 0 ? `<li><b>${missingBody} clip B-roll Thân bài</b> (Xịt, bôi, quay các góc sản phẩm...)</li>` : ''}
                ${missingCTA > 0 ? `<li><b>${missingCTA} clip Chốt sale (CTA)</b> (Chỉ tay giỏ hàng, cầm sản phẩm kèm logo...)</li>` : ''}
            </ul>
        </div>
        `;
    }

    panel.innerHTML = `
    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-light); padding: 15px; border-radius: 8px;">
        <div class="flex justify-between items-center mb-10">
            <h4 class="text-primary m-0"><i class="fa-solid fa-chart-pie"></i> Bảng Phân Tích & Dự Báo (AI Audit)</h4>
            <div class="text-muted text-sm">Kho: <b>${doneSources.length}</b> clip sẵn sàng</div>
        </div>
        ${alertHtml}
        <div class="flex gap-15">
            <div class="flex-1 p-10" style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid var(--success); border-radius: 4px;">
                <div class="text-muted text-xs mb-5">Sản lượng dự kiến (An toàn)</div>
                <div class="text-success font-bold" style="font-size: 1.4rem">${currentMaxYield} <span style="font-size:12px">Video</span></div>
            </div>
            <div class="flex-1 p-10" style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); border-radius: 4px;">
                <div class="text-muted text-xs mb-5">Điểm nghẽn do thiếu cảnh</div>
                <div class="text-danger font-bold text-sm" style="margin-top: 8px;">${bottleneck.join(', ')}</div>
            </div>
            <div class="flex-1 p-10" style="background: rgba(99, 102, 241, 0.1); border-left: 3px solid var(--primary); border-radius: 4px;">
                <div class="text-muted text-xs mb-5">Hạn mức giới hạn / 1 Clip</div>
                <div class="text-primary font-bold" style="font-size: 1.4rem">${safeLimit} <span style="font-size:12px">lần</span></div>
            </div>
        </div>
        ${suggestionHtml}
        <div class="mt-15">
            <button class="btn btn-ai w-full" style="padding: 10px; font-weight: bold; font-size: 14px;" onclick="openShotlistModal()">
                <i class="fa-solid fa-clapperboard"></i> Gọi AI D.O.P Trích Xuất Kế Hoạch Quay Chi Tiết
            </button>
        </div>
    </div>
    `;
    panel.style.display = 'block';
}

async function loadSources() {
    if (!currentProject || !window.api) return;
    const list = document.getElementById('sourceList');
    const sources = await window.api.listSources(currentProject);
    
    sources.sort((a, b) => {
        const countA = a.usageCount || 0;
        const countB = b.usageCount || 0;
        if (countB !== countA) return countB - countA; 
        return a.fileName.localeCompare(b.fileName);
    });

    globalSources = sources; 
    const totalSources = sources.length;
    const safeLimit = Math.max(5, Math.floor(totalSources / 5));
    
    let htmlStr = "";

    sources.forEach(s => {
        const uCount = s.usageCount || 0;

        let badgeClass = s.status === 'done' ? 'bg-ok' : '';
        let badgeText = s.status === 'done' ? `<i class="fa-solid fa-check"></i> Đã Quét` : '';
        if (s.isVerified) {
            badgeClass = 'bg-success';
            badgeText = `<i class="fa-solid fa-check-double"></i> Đã Duyệt`;
        }
        
        let usageBadge = '';
        if (uCount > 0) {
            if (uCount >= (safeLimit * 2)) {
                usageBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 1); color: #fff; border: 1px solid var(--danger); margin-left: 5px; font-size: 10px;" title="Cảnh báo ĐỎ: Đã vượt lạm dụng!"><i class="fa-solid fa-skull"></i> Đã dùng: ${uCount}/${safeLimit}</span>`;
            } else if (uCount > safeLimit) {
                usageBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); margin-left: 5px; font-size: 10px;" title="Cảnh báo: Vượt hạn mức lặp an toàn!"><i class="fa-solid fa-fire"></i> Đã dùng: ${uCount}/${safeLimit}</span>`;
            } else {
                usageBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid var(--warning); margin-left: 5px; font-size: 10px;"><i class="fa-solid fa-recycle"></i> Đã dùng: ${uCount}/${safeLimit}</span>`;
            }
        }

        let st = s.status === 'done' ? `<span class="status-badge ${badgeClass}">${badgeText}</span>${usageBadge}` : `<button class="btn btn-ai" onclick="scanSingleVideo('${s.fileName}')" style="padding: 4px 10px; font-size:11px"><i class="fa-solid fa-robot"></i> Quét AI</button>`;
        
        const safePath = `file:///${s.filePath.replace(/\\/g, '/')}`;
        const cleanDesc = s.description ? s.description.substring(0, 60) + '...' : 'Chưa quét.';
        
        htmlStr += `
        <div class="source-item" ${uCount > safeLimit ? 'style="border-left: 3px solid var(--danger);"' : ''}>
            <div class="source-thumb" onclick="playVideo('${safePath}', '${s.fileName}')">
                <video src="${safePath}#t=1" preload="metadata" muted></video>
                <i class="fa-solid fa-play play-icon" style="position:absolute; inset:0; margin:auto; color:white; font-size:1.2rem; display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.3)"></i>
            </div>
            <div style="flex:1; cursor:pointer" onclick="playVideo('${safePath}', '${s.fileName}')">
                <div style="font-weight:bold; margin-bottom:4px">${s.fileName}</div><div class="text-muted text-sm">${cleanDesc}</div>
            </div>
            <div>${st}</div>
        </div>`;
    });

    list.innerHTML = htmlStr;
    updateResourceAudit();
    triggerProxyGeneration();
}

window.openShotlistModal = function() {
    document.getElementById('modalShotlist').style.display = 'flex';
    if (!hasCachedShotlist || !currentShotlistData) {
        document.getElementById('shotlistArea').innerHTML = `
            <div class="text-center" style="padding: 60px 20px;">
                <i class="fa-solid fa-robot text-primary mb-20" style="font-size: 4rem;"></i>
                <h3 class="text-main mb-15">AI D.O.P Đang chờ lệnh</h3>
                <div class="text-muted mb-20">Hệ thống sẽ đọc toàn bộ kịch bản và kho video của sếp để tính toán xem cần đi quay thêm những phân cảnh nào.</div>
                <button class="btn btn-ai" style="padding: 15px 30px; font-size: 1.2rem; font-weight: bold; box-shadow: 0 4px 15px rgba(99,102,241,0.4);" onclick="callAIDirector(true)">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> BẮT ĐẦU PHÂN TÍCH & LÊN KẾ HOẠCH
                </button>
            </div>`;
        document.getElementById('shotlistStatus').innerHTML = `<span class="text-muted"><i class="fa-solid fa-power-off"></i> Hệ thống đang chờ...</span>`;
    }
}

window.callAIDirector = async function(forceRefresh = false) {
    if (!window.api) return;
    const apiKey = localStorage.getItem('ai_api_key');
    if(!apiKey) return window.alert("Vui lòng cấu hình API Key Kie.ai trong phần Cài đặt trước!");

    document.getElementById('shotlistArea').innerHTML = `<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin text-primary" style="font-size:3rem; margin-bottom:15px"></i><div class="text-muted">AI đang đọc toàn bộ kịch bản và phân tích... Vui lòng đợi 10-30s!</div></div>`;
    document.getElementById('shotlistStatus').innerHTML = `<span class="text-warning"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu từ máy chủ Kie.ai...</span>`;

    try {
        const res = await window.api.generateShotlist(currentProject, apiKey, null, null);
        if (res.success) {
            renderShotlist(res.data, res.filteredCount);
            hasCachedShotlist = true; 
        } else {
            document.getElementById('shotlistArea').innerHTML = `<div class="text-danger text-center p-20">Lỗi: ${res.error}</div>`;
        }
    } catch (err) {
        document.getElementById('shotlistArea').innerHTML = `<div class="text-danger text-center p-20">Lỗi: ${err.message}</div>`;
    }
};

window.applyShotlistCorrection = async function() {
    if (!window.api) return;
    const prompt = document.getElementById('shotlistCorrectionPrompt').value.trim();
    const apiKey = localStorage.getItem('ai_api_key');

    if (!prompt) return window.alert("Sếp chưa nhập yêu cầu chỉnh sửa nào cả!");
    if (!currentShotlistData) return window.alert("Chưa có bản nháp kế hoạch nào để sửa. Sếp vui lòng ấn 'Tạo lại từ đầu' trước nhé.");

    const btn = document.getElementById('btnApplyShotlistCorrection');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tính toán lại...`;

    document.getElementById('shotlistArea').innerHTML = `<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin text-warning" style="font-size:3rem; margin-bottom:15px"></i><div class="text-muted">AI đang xé nháp và cấu trúc lại kế hoạch theo ý sếp...</div></div>`;
    document.getElementById('shotlistStatus').innerHTML = `<span class="text-warning"><i class="fa-solid fa-pen-nib"></i> Đang điều chỉnh lại bản thiết kế...</span>`;

    try {
        const res = await window.api.generateShotlist(currentProject, apiKey, prompt, currentShotlistData);
        if (res.success) {
            renderShotlist(res.data, 0); 
            document.getElementById('shotlistCorrectionPrompt').value = ''; 
            window.alert("AI D.O.P đã chỉnh sửa xong kế hoạch theo ý sếp!");
        } else {
            document.getElementById('shotlistArea').innerHTML = `<div class="text-danger text-center p-20">Lỗi: ${res.error}</div>`;
        }
    } catch (err) {
        document.getElementById('shotlistArea').innerHTML = `<div class="text-danger text-center p-20">Lỗi: ${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Gửi Yêu Cầu Chỉnh Sửa`;
    }
}

function renderShotlist(data, filteredCount) {
    currentShotlistData = data;
    
    if (filteredCount > 0) {
        document.getElementById('shotlistStatus').innerHTML = `<span class="text-success"><i class="fa-solid fa-check"></i> Đã lọc bỏ ${filteredCount} kịch bản trùng lặp để tiết kiệm Token.</span> Bản nháp dưới đây đang được lưu tạm trên máy:`;
    } else {
        document.getElementById('shotlistStatus').innerHTML = `<span class="text-success"><i class="fa-solid fa-check"></i> Kế hoạch đã được cập nhật mới nhất.</span> Bản nháp dưới đây đang được lưu tạm trên máy:`;
    }
    
    let html = '';
    if(!data || !Array.isArray(data) || data.length === 0) {
        html = `<div class="text-muted p-20 text-center">AI không thể trích xuất được kế hoạch. Hãy đảm bảo bạn đã tạo đủ Kịch bản ở Tab số 2.</div>`;
    } else {
        data.forEach((item, idx) => {
            html += `
            <div style="background:var(--bg-panel); border:1px solid var(--border); padding:15px; border-radius:8px;">
                <div class="flex justify-between items-center mb-10">
                    <span class="text-primary font-bold" style="font-size:1.1rem">Cảnh ${idx + 1}: ${item.category}</span>
                    <span class="status-badge bg-warning text-dark" style="font-size: 13px; padding: 4px 10px"><i class="fa-solid fa-video"></i> Quay ${item.quantity} Take</span>
                </div>
                <div class="mb-5"><span class="text-muted">🎥 Góc máy:</span> <strong class="text-main">${item.camera}</strong></div>
                <div class="mb-5"><span class="text-muted">🎬 Hành động:</span> <span class="text-main">${item.action}</span></div>
                <div class="mt-10 p-10" style="background:rgba(245,158,11,0.1); border-left:3px solid var(--warning); border-radius:4px;">
                    <span class="text-warning text-sm"><i class="fa-solid fa-lightbulb"></i> Ghi chú DOP: ${item.note}</span>
                </div>
            </div>`;
        });
    }
    document.getElementById('shotlistArea').innerHTML = html;
}

window.copyShotlist = function() {
    if(!currentShotlistData || !Array.isArray(currentShotlistData)) return window.alert("Chưa có dữ liệu để copy!");
    let text = "📋 KẾ HOẠCH QUAY PHIM (DO AI D.O.P GỢI Ý)\n\n";
    currentShotlistData.forEach((item, idx) => {
        text += `Cảnh ${idx + 1}: ${item.category} (Số lượng: ${item.quantity} Video)\n`;
        text += `- Góc máy: ${item.camera}\n`;
        text += `- Hành động: ${item.action}\n`;
        text += `- Note: ${item.note}\n`;
        text += `---------------------------\n`;
    });
    navigator.clipboard.writeText(text).then(() => {
        window.alert("Đã copy toàn bộ kế hoạch quay vào Clipboard. Bạn có thể dán và gửi qua Zalo cho quay phim!");
    }).catch(err => {
        window.alert("Lỗi copy: " + err);
    });
};

window.playVideo = async function(path, name) {
    let finalPath = path;
    const badge = document.getElementById('proxyBadge');
    badge.style.display = 'none';

    if (localStorage.getItem('use_proxy') === 'true' && window.api) {
        const proxyPath = await window.api.checkProxy(currentProject, name);
        if (proxyPath) {
            finalPath = `file:///${proxyPath.replace(/\\/g, '/')}`;
            badge.style.display = 'block'; 
        }
    }

    document.getElementById('vidPreview').src = finalPath;
    document.getElementById('vidTitle').textContent = `Video: ${name}`;
    document.getElementById('vidFileName').value = name;
    
    currentSourceIndex = globalSources.findIndex(s => s.fileName === name);
    updateVideoNavigationUI();

    document.getElementById('vidDescription').value = 'Đang tải...';
    document.getElementById('vidAction').value = '';
    document.getElementById('vidObject').value = '';
    document.getElementById('vidScene').value = '';
    document.getElementById('vidCamera').value = '';
    document.getElementById('vidPurpose').value = '';
    document.getElementById('vidKeyword').value = '';
    document.getElementById('vidJsonData').value = '';
    document.getElementById('vidCorrectionPrompt').value = '';
    
    document.getElementById('modalVideoEditor').style.display = 'flex';
    document.getElementById('vidPreview').play();

    await loadMetadataToForm(name);
}

function updateVideoNavigationUI() {
    const counter = document.getElementById('vidCounter');
    const btnPrev = document.getElementById('btnPrevVideo');
    const btnNext = document.getElementById('btnNextVideo');

    if (globalSources.length === 0) return;

    counter.textContent = `${currentSourceIndex + 1} / ${globalSources.length}`;
    btnPrev.disabled = currentSourceIndex === 0;
    btnNext.disabled = currentSourceIndex === globalSources.length - 1;
}

window.navigateVideo = async function(direction) {
    const newIndex = currentSourceIndex + direction;
    if (newIndex >= 0 && newIndex < globalSources.length) {
        const s = globalSources[newIndex];
        const safePath = `file:///${s.filePath.replace(/\\/g, '/')}`;
        await playVideo(safePath, s.fileName);
    }
}

async function loadMetadataToForm(name) {
    if (window.api) {
        try {
            let meta = await window.api.getMetadata(currentProject, name) || {};
            
            document.getElementById('vidDescription').value = meta.Description || meta.description || meta.MainContent || '';
            document.getElementById('vidAction').value = meta.Action || meta.action || '';
            document.getElementById('vidObject').value = meta.Object || meta.object || '';
            document.getElementById('vidScene').value = meta.Scene || meta.scene || '';
            document.getElementById('vidCamera').value = meta.Camera || meta.camera || '';
            document.getElementById('vidPurpose').value = meta.Purpose || meta.purpose || '';
            document.getElementById('vidKeyword').value = meta.Keyword || meta.keyword || '';
            
            const badge = document.getElementById('vidVerifyBadge');
            if (meta.isVerified) badge.style.display = 'inline-flex';
            else badge.style.display = 'none';

            document.getElementById('vidJsonData').value = JSON.stringify(meta, null, 2);
        } catch(e) {
            document.getElementById('vidDescription').value = '';
        }
    }
}

window.applyMetaCorrection = async function() {
    if (!window.api) return;
    const name = document.getElementById('vidFileName').value;
    const jsonStr = document.getElementById('vidJsonData').value;
    const prompt = document.getElementById('vidCorrectionPrompt').value;
    const apiKey = localStorage.getItem('ai_api_key');
    
    if (!apiKey) return window.alert("Vui lòng cấu hình API Key Kie.ai trong Cài đặt!");
    if (!prompt) return window.alert("Vui lòng nhập lệnh chỉnh sửa để AI hiểu bạn muốn gì!");
    
    const btn = document.getElementById('btnApplyCorrection');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang sửa...`;
    
    try {
        const result = await window.api.fixMetadata(currentProject, name, jsonStr, prompt, apiKey);
        if (result.success) {
            window.alert("Đã chỉnh sửa metadata thành công!");
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
            await loadMetadataToForm(name);
            
            document.getElementById('vidCorrectionPrompt').value = '';
            
            loadSources();
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        window.alert("Lỗi: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Gửi lại AI Chỉnh Sửa`;
    }
}

window.reRender = async function(id) {
    try {
        await setRunningState(true);
        await executeRenderBatch([id]); 
    } catch(e) { window.alert(e.message); }
    await setRunningState(false);
}

function renderSingleScriptUI(s, idx) {
    const list = document.getElementById('scriptListUI');
    const badge = [];
    if(s.voicePath) {
        badge.push(`<span class="status-badge bg-ok"><i class="fa-solid fa-microphone"></i> Voice</span>`);
        badge.push(`<button class="btn btn-secondary" style="padding:2px 8px; font-size:10px; margin-left:5px; background: rgba(16,185,129,0.1); color: var(--success); border-color: rgba(16,185,129,0.3)" onclick="playAudioVoice('file:///${s.voicePath.replace(/\\/g, '/')}')" title="Nghe nháp Voice"><i class="fa-solid fa-volume-high"></i> Nghe</button>`);
    }
    
    if(s.isRendered) {
        badge.push(`<span class="status-badge" style="background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3)"><i class="fa-solid fa-check-double"></i> Đã Xuất</span>`);
        badge.push(`<button class="btn btn-secondary" style="padding:2px 8px; font-size:10px; margin-left:5px" onclick="reRender('${s.id}')" title="Bấm để Xuất lại Video này"><i class="fa-solid fa-rotate-right"></i> RENDER LẠI</button>`);
    }
    
    const div = document.createElement('div'); div.className = 'script-box';
    div.innerHTML = `
        <div class="flex items-center justify-between mb-5">
            <div>
                <strong style="color:var(--primary)">Kịch bản mới</strong> 
                <span class="status-badge" style="background: rgba(245,158,11,0.15); color: var(--warning); border: 1px solid var(--warning); margin-left: 10px; font-size: 11px;"><i class="fa-solid fa-lightbulb"></i> Góc nhìn: ${s.angle || 'Chưa xác định'}</span>
            </div>
            <div class="flex gap-10 items-center">${badge.join('')}</div>
        </div>
        <textarea class="form-control text-muted click-to-edit" id="ta_${s.id}" rows="4" style="background:transparent; resize:vertical; font-size:13px; padding:8px" readonly onclick="openBigInput('Chỉnh sửa Kịch bản', this.id)" onchange="updateScript('${s.id}', this.value)">${s.content}</textarea>
    `;
    list.prepend(div);
}

async function loadScripts() {
    if (!currentProject || !window.api) return;
    const fetchedScripts = await window.api.listScripts(currentProject);
    globalScripts = fetchedScripts;
    
    let htmlStr = "";
    globalScripts.forEach((s) => {
        const badge = [];
        if(s.voicePath) {
            badge.push(`<span class="status-badge bg-ok"><i class="fa-solid fa-microphone"></i> Voice</span>`);
            badge.push(`<button class="btn btn-secondary" style="padding:2px 8px; font-size:10px; margin-left:5px; background: rgba(16,185,129,0.1); color: var(--success); border-color: rgba(16,185,129,0.3)" onclick="playAudioVoice('file:///${s.voicePath.replace(/\\/g, '/')}')" title="Nghe nháp Voice"><i class="fa-solid fa-volume-high"></i> Nghe</button>`);
        }
        if(s.isRendered) {
            badge.push(`<span class="status-badge" style="background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3)"><i class="fa-solid fa-check-double"></i> Đã Xuất</span>`);
            badge.push(`<button class="btn btn-secondary" style="padding:2px 8px; font-size:10px; margin-left:5px" onclick="reRender('${s.id}')" title="Bấm để Xuất lại Video này"><i class="fa-solid fa-rotate-right"></i> RENDER LẠI</button>`);
        }
        
        htmlStr += `
        <div class="script-box">
            <div class="flex items-center justify-between mb-5">
                <div>
                    <strong style="color:var(--primary)">Kịch bản mới</strong> 
                    <span class="status-badge" style="background: rgba(245,158,11,0.15); color: var(--warning); border: 1px solid var(--warning); margin-left: 10px; font-size: 11px;"><i class="fa-solid fa-lightbulb"></i> Góc nhìn: ${s.angle || 'Chưa xác định'}</span>
                </div>
                <div class="flex gap-10 items-center">${badge.join('')}</div>
            </div>
            <textarea class="form-control text-muted click-to-edit" id="ta_${s.id}" rows="4" style="background:transparent; resize:vertical; font-size:13px; padding:8px" readonly onclick="openBigInput('Chỉnh sửa Kịch bản', this.id)" onchange="updateScript('${s.id}', this.value)">${s.content}</textarea>
        </div>`;
    });
    document.getElementById('scriptListUI').innerHTML = htmlStr;
    updateStats();
}

function updateStats() {
    const ready = globalScripts.filter(x => x.voicePath && !x.isRendered).length;
    document.getElementById('statReady').textContent = `${ready} Video`;
}

window.updateScript = async function(id, newContent) {
    if (!currentProject || !window.api) return;
    const s = globalScripts.find(x => String(x.id) === String(id));
    if(s) { s.content = newContent; await window.api.saveScriptRecord(currentProject, s); }
}

async function loadFinals() {
    if (!currentProject || !window.api) return;
    const list = document.getElementById('finalList');
    const customOut = document.getElementById('outPathDisplay').value || null;
    const finals = await window.api.listFinalVideos(currentProject, customOut);
    
    let htmlStr = "";
    finals.forEach(f => {
        const safePath = `file:///${f.path.replace(/\\/g, '/')}`;
        const timeStr = f.birthtime ? new Date(f.birthtime).toLocaleString('vi-VN') : '';
        
        const cObj = f.costObj || {total:0, text:0, voice:0, render:0};
        let costHtml = '';
        if (cObj.total > 0) {
            costHtml = `<div class="flex gap-10 mt-5" style="font-size:11px">
                <span class="text-primary" title="Phí phân tích kịch bản">Kịch bản: ${(cObj.text||0).toLocaleString()}đ</span>
                <span class="text-success" title="Phí Lồng tiếng AI">Voice: ${(cObj.voice||0).toLocaleString()}đ</span>
                <span class="text-warning" title="Phí gọt ghép Timeline">Render: ${(cObj.render||0).toLocaleString()}đ</span>
                <span class="text-danger font-bold ml-10">TỔNG: ${(cObj.total||0).toLocaleString()}đ</span>
            </div>`;
        }
        
        htmlStr += `
            <div class="final-card" style="padding: 8px; cursor: default; display: flex; align-items: center; gap: 12px;">
                <div class="source-thumb" onclick="playFinalVideo('${safePath}')" style="width: 50px; height: 75px; flex-shrink:0; cursor: pointer;">
                    <video src="${safePath}#t=1" preload="metadata" muted style="height:100%; object-fit:cover;"></video>
                    <i class="fa-solid fa-play play-icon" style="position:absolute; inset:0; margin:auto; color:white; font-size:1rem; display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.3)"></i>
                </div>
                <div style="flex:1; overflow:hidden; cursor:pointer;" onclick="window.api.openPath('${f.path.replace(/\\/g,'\\\\')}')">
                    <div style="font-weight:bold; font-size:12px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;" title="${f.name}">${f.name}</div>
                    <div class="text-muted text-xs mt-5"><i class="fa-solid fa-clock"></i> Cập nhật lúc: ${timeStr}</div>
                    ${costHtml}
                </div>
                <button class="btn btn-secondary" onclick="window.api.openFolder('${f.path.replace(/\\/g,'\\\\')}')" style="padding: 8px; flex-shrink:0;" title="Mở trong File Explorer">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
            </div>
        `;
    });
    list.innerHTML = htmlStr;
}