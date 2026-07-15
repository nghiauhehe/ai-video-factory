const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = __dirname;
const BUILD_DIR = path.join(ROOT_DIR, '.temp_build');
const DIST_DIR = path.join(ROOT_DIR, 'dist_final');

async function build() {
    console.log("🚀 BẮT ĐẦU TIẾN TRÌNH MÃ HÓA & ĐÓNG GÓI EXE...");
    
    try {
        if (fs.existsSync(BUILD_DIR)) fs.removeSync(BUILD_DIR);
        if (fs.existsSync(DIST_DIR)) fs.removeSync(DIST_DIR);
        fs.mkdirSync(BUILD_DIR);

        console.log("📂 1/5: Đang copy mã nguồn sang phân vùng đóng gói an toàn (Bảo vệ code gốc)...");
        fs.copySync(path.join(ROOT_DIR, 'src'), path.join(BUILD_DIR, 'src'));
        
        fs.copySync(path.join(ROOT_DIR, 'package.json'), path.join(BUILD_DIR, 'package.json'));
        if (fs.existsSync(path.join(ROOT_DIR, 'package-lock.json'))) {
            fs.copySync(path.join(ROOT_DIR, 'package-lock.json'), path.join(BUILD_DIR, 'package-lock.json'));
        }

        console.log("🔐 2/5: Đang tiến hành mã hóa Obfuscator (Làm rối mã nguồn chống dịch ngược)...");
        function obfuscateFolder(dir) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    obfuscateFolder(fullPath);
                } else if (fullPath.endsWith('.js')) {
                    const code = fs.readFileSync(fullPath, 'utf8');
                    const obfuscated = JavaScriptObfuscator.obfuscate(code, {
                        compact: true,
                        controlFlowFlattening: false, 
                        deadCodeInjection: false,
                        stringArray: true,
                        stringArrayEncoding: ['base64'], 
                        stringArrayThreshold: 0.3, 
                        disableConsoleOutput: false 
                    });
                    fs.writeFileSync(fullPath, obfuscated.getObfuscatedCode());
                }
            }
        }
        obfuscateFolder(path.join(BUILD_DIR, 'src'));

        console.log("📦 3/5: Đang tải các thư viện lõi cho bản chính thức (Production Dependencies)...");
        execSync('npm install --production', { cwd: BUILD_DIR, stdio: 'inherit' });

        console.log("⚙️ 4/5: Thiết lập cấu hình file thực thi .EXE và Trình gỡ cài đặt...");
        const pkgPath = path.join(BUILD_DIR, 'package.json');
        const pkg = fs.readJsonSync(pkgPath);
        
        let electronVer = (pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || "43.1.0";
        electronVer = electronVer.replace(/[\^~>=]/g, ''); 
        
        // --- TẠO SCRIPT GỠ CÀI ĐẶT (NSIS MACRO) ---
        // FIX: Đổi ROOT_DIR thành BUILD_DIR để Electron Builder tìm thấy file nsh khi build
        const buildResDir = path.join(BUILD_DIR, 'build');
        if (!fs.existsSync(buildResDir)) fs.mkdirSync(buildResDir);
        const nshContent = `
!macro customUnInstall
  MessageBox MB_YESNO "Ban co muon XOA VINH VIEN toan bo Du lieu du an (Workspace) va Cai dat cua AI Video Factory khong?$\\r$\\n(Chon Yes neu muon don sach o dia, chon No de giu lai cho lan cai sau)" IDYES wipeData IDNO keepData
  wipeData:
    RMDir /r "$DOCUMENTS\\AIVideoFactory_Workspace"
    RMDir /r "$APPDATA\\AI Video Factory Pro"
  keepData:
!macroend
`;
        fs.writeFileSync(path.join(buildResDir, 'installer.nsh'), '\uFEFF' + nshContent, 'utf8');

        pkg.build = {
            appId: "com.aivideofactory.ultrapro",
            productName: "AI Video Factory Pro",
            electronVersion: electronVer,
            directories: {
                output: "dist_exe"
            },
            win: {
                target: "nsis"
            },
            nsis: {
                oneClick: false, 
                allowToChangeInstallationDirectory: true,
                createDesktopShortcut: true,
                include: "build/installer.nsh" // Nhúng script NSIS vào đây
            },
            asar: true, 
            asarUnpack: [
                "node_modules/ffmpeg-static/**/*",
                "node_modules/ffprobe-static/**/*"
            ]
        };
        
        if(pkg.scripts && pkg.scripts.build) delete pkg.scripts.build;
        fs.writeJsonSync(pkgPath, pkg, { spaces: 2 });

        console.log("🔨 Đang nén và xuất file EXE (Mất khoảng 1-3 phút, vui lòng không tắt cửa sổ)...");
        execSync(`npx electron-builder --win --x64 --projectDir ${BUILD_DIR}`, { cwd: ROOT_DIR, stdio: 'inherit' });
        
        console.log("✅ 5/5: Đóng gói hoàn tất! Đang dọn dẹp...");
        fs.copySync(path.join(BUILD_DIR, 'dist_exe'), DIST_DIR);
        fs.removeSync(BUILD_DIR);
        
        console.log(`\n🎉 THÀNH CÔNG RỰC RỠ!`);
        console.log(`👉 File cài đặt (.exe) đã nằm sẵn sàng trong thư mục: dist_final\n`);

    } catch (error) {
        console.error("\n❌ CÓ LỖI XẢY RA TRONG QUÁ TRÌNH BUILD:");
        console.error(error.message);
        if (fs.existsSync(BUILD_DIR)) fs.removeSync(BUILD_DIR);
    }
}

build();