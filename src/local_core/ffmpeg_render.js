const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
ffmpeg.setFfmpegPath(ffmpegStatic.replace('app.asar', 'app.asar.unpacked'));
ffmpeg.setFfprobePath(ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked'));

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const { getAudioDuration } = require('./metadata_matcher');

let cachedEncoder = null;

function getEncoderConfig(useGPU) {
    return new Promise((resolve) => {
        const cpuFallback = { vcodec: 'libx264', options: ['-preset', 'fast', '-crf', '23'] };
        if (!useGPU) return resolve(cpuFallback);

        if (cachedEncoder) return resolve(cachedEncoder);

        if (os.platform() === 'darwin') {
            cachedEncoder = { vcodec: 'h264_videotoolbox', options: ['-b:v', '5000k'] };
            return resolve(cachedEncoder);
        }

        if (os.platform() === 'win32') {
            exec('wmic path win32_VideoController get name', (err, stdout) => {
                if (!err && stdout) {
                    const out = stdout.toUpperCase();
                    if (out.includes('NVIDIA')) {
                        cachedEncoder = { vcodec: 'h264_nvenc', options: ['-preset', 'fast', '-cq', '23', '-b:v', '0'] };
                        return resolve(cachedEncoder);
                    }
                    if (out.includes('AMD') || out.includes('RADEON')) {
                        cachedEncoder = { vcodec: 'h264_amf', options: ['-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] };
                        return resolve(cachedEncoder);
                    }
                    if (out.includes('INTEL')) {
                        cachedEncoder = { vcodec: 'h264_qsv', options: ['-preset', 'veryfast', '-global_quality', '23'] };
                        return resolve(cachedEncoder);
                    }
                }
                cachedEncoder = cpuFallback;
                resolve(cachedEncoder);
            });
        } else {
            cachedEncoder = cpuFallback;
            resolve(cachedEncoder);
        }
    });
}

function hexToAssColor(hex) {
    if (!hex) return '&H00FFFFFF';
    hex = String(hex).replace('#', '');
    if (hex.length === 6) {
        const r = hex.substring(0, 2);
        const g = hex.substring(2, 4);
        const b = hex.substring(4, 6);
        return `&H00${b}${g}${r}`;
    }
    return '&H00FFFFFF';
}

function formatAssTime(ms) {
    if (ms < 0) ms = 0;
    const h = Math.floor(ms / 3600000);
    ms %= 3600000;
    const m = Math.floor(ms / 60000);
    ms %= 60000;
    const s = Math.floor(ms / 1000);
    const cs = Math.floor((ms % 1000) / 10); 
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function normalizeString(str) {
    return str.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()""'']/g,"").toLowerCase().trim();
}

async function buildAssFileAndExtractTimestamps(srtPath, assPath, subConfig) {
    const content = await fs.readFile(srtPath, 'utf8');
    const fontName = subConfig?.fontName || 'Arial';
    const fontSize = subConfig?.fontSize || '24';
    
    const primaryColor = hexToAssColor(subConfig?.textColor || '#FFFFFF'); 
    const outlineColor = hexToAssColor(subConfig?.borderColor || '#000000');
    const borderSize = subConfig?.borderSize || '2';
    
    const activeColor = '&H0000FFFF'; 
    const keywordActiveColor = '&H00008CFF'; 
    const keywordSize = Math.floor(parseInt(fontSize) * 2.0); 

    let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},&H00000000,1,0,0,0,100,100,0,0,1,${borderSize},0,2,10,10,150,1
Style: MiddleKeyword,${fontName},${keywordSize},${keywordActiveColor},&H00FFFFFF,${outlineColor},&H00000000,1,0,0,0,100,100,0,0,1,3,0,5,10,10,0,1
\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

    const blocks = content.replace(/\r/g, '').split('\n\n').filter(b => b.trim());
    const timestamps = [];
    const keywords = (subConfig?.keywords || []).filter(k => k.trim().length > 0);

    const timeToMs = (t) => {
        const parts = t.split(':');
        if (parts.length !== 3) return 0;
        const [h, m, s_ms] = parts;
        const [s, ms] = s_ms.split(',');
        return (+h)*3600000 + (+m)*60000 + (+s)*1000 + (+ms);
    };

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length >= 3) {
            const timeLine = lines[1];
            let text = lines.slice(2).join(' ').trim();
            if (subConfig?.removePunc) {
                text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
            }

            const [startStr, endStr] = timeLine.split(' --> ');
            const startMs = timeToMs(startStr);
            const endMs = timeToMs(endStr);
            const duration = endMs - startMs;

            const words = text.split(/\s+/).filter(w => w.trim() !== '');
            if (words.length > 0) {
                const durationPerWord = duration / words.length;

                for (let i = 0; i < words.length; i++) {
                    const wordStartMs = startMs + Math.round(i * durationPerWord);
                    const wordEndMs = startMs + Math.round((i + 1) * durationPerWord);

                    let lineText = "";
                    for (let j = 0; j < words.length; j++) {
                        if (j === i) {
                            lineText += `{\\c${activeColor}}${words[j]} `;
                        } else {
                            lineText += `{\\c${primaryColor}}${words[j]} `;
                        }
                    }
                    lineText = lineText.trim();
                    assContent += `Dialogue: 0,${formatAssTime(wordStartMs)},${formatAssTime(wordEndMs)},Default,,0,0,0,,${lineText}\n`;
                }

                const lowerWords = words.map(w => normalizeString(w));
                const sortedKeywords = keywords.map(k => k.trim()).filter(Boolean).sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
                const coveredIndices = new Set();
                const keywordsFound = [];

                for (const kw of sortedKeywords) {
                    const kwWords = normalizeString(kw).split(/\s+/).filter(Boolean);
                    if (kwWords.length === 0) continue;
                    
                    for (let i = 0; i <= lowerWords.length - kwWords.length; i++) {
                        let match = true;
                        for (let j = 0; j < kwWords.length; j++) {
                            if (!lowerWords[i + j].includes(kwWords[j]) && !kwWords[j].includes(lowerWords[i + j])) {
                                match = false;
                                break;
                            }
                        }
                        
                        if (match) {
                            let alreadyCovered = false;
                            for (let j = 0; j < kwWords.length; j++) {
                                if (coveredIndices.has(i + j)) {
                                    alreadyCovered = true;
                                    break;
                                }
                            }
                            
                            if (!alreadyCovered) {
                                for (let j = 0; j < kwWords.length; j++) {
                                    coveredIndices.add(i + j);
                                }
                                const matchedText = words.slice(i, i + kwWords.length).join(' ').replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
                                keywordsFound.push({
                                    wordIndex: i,
                                    wordCount: kwWords.length,
                                    text: matchedText
                                });
                            }
                        }
                    }
                }

                for (const item of keywordsFound) {
                    const kwStartMs = startMs + Math.round(item.wordIndex * durationPerWord);
                    const kwEndMs = startMs + Math.round((item.wordIndex + item.wordCount) * durationPerWord);
                    
                    const actualKwStartMs = kwStartMs;
                    const actualKwEndMs = Math.min(endMs, Math.max(actualKwStartMs + 800, kwEndMs + 200));

                    timestamps.push(actualKwStartMs);

                    assContent += `Dialogue: 1,${formatAssTime(actualKwStartMs)},${formatAssTime(actualKwEndMs)},MiddleKeyword,,0,0,0,,{\\an5\\pos(540,960)\\fscx0\\fscy0\\t(0,120,\\fscx140\\fscy140)\\t(120,200,\\fscx100\\fscy100)}${item.text.toUpperCase()}\n`;
                }
            }
        }
    }
    await fs.writeFile(assPath, assContent, 'utf8');
    return timestamps;
}

function processClip(inputPath, outputPath, duration, isFirstClip, encConfig) {
    return new Promise((resolve, reject) => {
        let filterChain = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p'; 
        if (isFirstClip) filterChain += `,fade=t=in:st=0:d=0.5`;

        ffmpeg()
            .input(inputPath)
            .inputOptions(['-stream_loop', '-1']) 
            .setStartTime(0)
            .setDuration(duration)
            .videoFilters(filterChain)
            .outputOptions([
                '-c:v', encConfig.vcodec, 
                ...encConfig.options, 
                '-pix_fmt', 'yuv420p', 
                '-an'
            ])
            .save(outputPath)
            .on('end', resolve)
            .on('error', reject);
    });
}

function applyXfade(clip0, clip1, offsetTime, outputPath, encConfig) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(clip0)
            .input(clip1)
            .complexFilter([`[0:v][1:v]xfade=transition=slideleft:duration=0.4:offset=${offsetTime}[v]`])
            .outputOptions([
                '-map', '[v]', 
                '-c:v', encConfig.vcodec, 
                ...encConfig.options, 
                '-pix_fmt', 'yuv420p', 
                '-an'
            ])
            .save(outputPath)
            .on('end', resolve)
            .on('error', reject);
    });
}

function concatAndMix(clipPaths, audioPath, srtPath, whooshPath, whooshDelay, totalAudioDur, finalOutput, subConfig, tempDir, encConfig) {
    return new Promise(async (resolve, reject) => {
        const listPath = path.join(tempDir, `list_${crypto.randomBytes(4).toString('hex')}.txt`);
        
        const fileContent = clipPaths.map(c => {
            if(!c) return '';
            return `file '${String(c).replace(/\\/g, '/')}'`;
        }).filter(Boolean).join('\n');
        
        require('fs').writeFileSync(listPath, fileContent);

        const assPath = path.join(tempDir, `subs_${crypto.randomBytes(4).toString('hex')}.ass`);
        let keywordTimestamps = [];
        if (srtPath) {
            keywordTimestamps = await buildAssFileAndExtractTimestamps(srtPath, assPath, subConfig);
        }
        const safeAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/,/g, '\\,');

        const cmd = ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0']).input(audioPath);
        
        let inputCount = 2; 
        let whooshIndex = -1;
        if (whooshPath) {
            cmd.input(whooshPath); 
            whooshIndex = inputCount++;
        }

        let keywordSoundIndex = -1;
        if (keywordTimestamps.length > 0 && subConfig?.keywordSoundPath) {
            cmd.input(subConfig.keywordSoundPath);
            keywordSoundIndex = inputCount++;
        }

        const fadeOutStart = Math.max(0, totalAudioDur - 0.5);
        
        let filterComplex = '';
        if (srtPath) {
            filterComplex = `[0:v]ass='${safeAssPath}'[vsub];[vsub]fade=t=out:st=${fadeOutStart}:d=0.5[vout]`;
        } else {
            filterComplex = `[0:v]fade=t=out:st=${fadeOutStart}:d=0.5[vout]`;
        }

        let mixInputs = `[1:a]`;
        let amixCount = 1;

        if (whooshIndex !== -1) {
            const delayMs = Math.floor(whooshDelay * 1000);
            filterComplex += `;[${whooshIndex}:a]adelay=${delayMs}|${delayMs}[w]`;
            mixInputs += `[w]`;
            amixCount++;
        }

        if (keywordSoundIndex !== -1 && keywordTimestamps.length > 0) {
            const numPops = keywordTimestamps.length;
            if (numPops === 1) {
                const t = keywordTimestamps[0];
                filterComplex += `;[${keywordSoundIndex}:a]adelay=${t}|${t}[kwpop0]`;
                mixInputs += `[kwpop0]`;
                amixCount++;
            } else {
                let splitOuts = '';
                for (let i = 0; i < numPops; i++) {
                    splitOuts += `[kwa${i}]`;
                }
                filterComplex += `;[${keywordSoundIndex}:a]asplit=${numPops}${splitOuts}`;
                
                for (let i = 0; i < numPops; i++) {
                    const t = keywordTimestamps[i];
                    filterComplex += `;[kwa${i}]adelay=${t}|${t}[kwpop${i}]`;
                    mixInputs += `[kwpop${i}]`;
                    amixCount++;
                }
            }
        }

        if (amixCount > 1) {
            filterComplex += `;${mixInputs}amix=inputs=${amixCount}:duration=first:dropout_transition=0[aout]`;
            cmd.outputOptions(['-map', '[vout]', '-map', '[aout]']);
        } else {
            cmd.outputOptions(['-map', '[vout]', '-map', '1:a']);
        }

        cmd.complexFilter(filterComplex)
            .outputOptions([
                '-c:v', encConfig.vcodec, 
                ...encConfig.options, 
                '-pix_fmt', 'yuv420p', 
                '-c:a', 'aac', 
                '-b:a', '128k', 
                '-shortest'
            ])
            .save(finalOutput)
            .on('end', async () => {
                await fs.unlink(listPath).catch(()=>{});
                resolve();
            })
            .on('error', reject);
    });
}

async function renderFinalVideo(projectPath, projectName, renderCount, timeline, voicePath, srtPath, subConfig, customOutputDir) {
    const tempDir = path.join(os.tmpdir(), `render_${crypto.randomBytes(4).toString('hex')}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
        const useGPU = subConfig?.useGPU !== false; 
        const encConfig = await getEncoderConfig(useGPU);
        console.log(`[FFmpeg] Khởi chạy mã hóa với Encoder: ${encConfig.vcodec}`);

        const sourceDir = path.join(projectPath, '01_Source');
        const actualSourceFiles = await fs.readdir(sourceDir);
        let processedClips = [];
        let whooshPath = null;
        let whooshDelay = 0;
        
        const totalAudioDur = await getAudioDuration(voicePath);
        let sumDur = 0;
        for (let i = 0; i < timeline.length - 1; i++) sumDur += parseFloat(timeline[i].duration) || 2.0;
        let lastDur = parseFloat(timeline[timeline.length - 1].duration) || 2.0;
        
        if (sumDur + lastDur < totalAudioDur) lastDur = totalAudioDur - sumDur;
        timeline[timeline.length - 1].duration = lastDur + 0.5;

        for (let i = 0; i < timeline.length; i++) {
            const item = timeline[i];
            let fileName = String(item.file || item.filename || item.name || "");
            if (!actualSourceFiles.includes(fileName)) {
                let baseName = fileName.replace('SRC_', '').replace(/^0+/, '').replace('.mp4', '').replace('.mov', '');
                const matchedFile = actualSourceFiles.find(f => f.includes(baseName));
                fileName = matchedFile || actualSourceFiles[0]; 
            }

            const inputPath = path.join(sourceDir, fileName);
            const outputPath = path.join(tempDir, `clip_${i}.mp4`);
            let clipDuration = parseFloat(item.duration) || 2.0;
            const isFirstClip = (i === 0);
            if (isFirstClip && timeline.length > 1) clipDuration += 0.4;
            
            await processClip(inputPath, outputPath, clipDuration, isFirstClip, encConfig);
            processedClips.push(outputPath);
        }

        const offsetTime = (parseFloat(timeline[0].duration) || 2); 
        if (processedClips.length > 1 && offsetTime >= 0.5) {
            const xfadeOutput = path.join(tempDir, `clip_0_1_xfaded.mp4`);
            whooshDelay = offsetTime;
            await applyXfade(processedClips[0], processedClips[1], offsetTime, xfadeOutput, encConfig);
            
            if(subConfig?.customSoundPath) {
                const spath = path.join(tempDir, `sound.wav`);
                await fs.copyFile(subConfig.customSoundPath, spath).catch(()=>{});
                whooshPath = spath;
            }
            processedClips.splice(0, 2, xfadeOutput);
        }

        const outputDir = customOutputDir || path.join(projectPath, '07_Product');
        await fs.mkdir(outputDir, { recursive: true });
        
        const d = new Date();
        const dateStr = `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}`;
        const countStr = String(renderCount || 1).padStart(4, '0'); 
        
        const cleanName = String(projectName || 'Video').replace(/[^a-zA-Z0-9]/g, '');
        const finalOutput = path.join(outputDir, `${cleanName}_${countStr}_${dateStr}.mp4`);
        
        await concatAndMix(processedClips, voicePath, srtPath, whooshPath, whooshDelay, totalAudioDur, finalOutput, subConfig, tempDir, encConfig);
        
        return finalOutput;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(()=>{});
    }
}

module.exports = { renderFinalVideo };