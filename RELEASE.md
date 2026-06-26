# NotiKeeper — ปล่อยอัปเดตผ่าน GitHub Releases

แอปเช็คไฟล์ `version.json` ที่ URL คงที่ของ "release ล่าสุด" บน GitHub แล้วถ้าเลข `versionCode` ใหม่กว่าที่ติดตั้ง จะดาวน์โหลด APK + เด้งให้ติดตั้งทับ

## ตั้งครั้งแรก (ทำครั้งเดียว)
1. สร้าง GitHub repo เช่น `notikeeper` (public หรือ private ก็ได้ แต่ APK ต้องโหลดได้ — public ง่ายสุด)
2. ในแอป NotiKeeper → หน้า "สำรอง" → ช่อง **"URL ตรวจอัปเดต"** ใส่:
   ```
   https://github.com/Freshair129/notikeeper/releases/latest/download/version.json
   ```
   (`latest/download/` ชี้รุ่นล่าสุดเสมอ ไม่ต้องแก้ทุกครั้ง)

## ทุกครั้งที่จะปล่อยเวอร์ชันใหม่
1. **เพิ่มเลขเวอร์ชัน** ใน `app/build.gradle.kts`:
   - `versionCode` +1 (เช่น 6 → 7) — สำคัญ! ใช้เลขนี้เทียบว่าใหม่กว่าไหม
   - `versionName` เช่น "1.5" → "1.6"
2. **Build APK** (เครื่องนี้มี toolchain ที่ `D:\abuild` แล้ว):
   ```
   set JAVA_HOME=D:\abuild\jdk\jdk-17.0.19+10
   set ANDROID_SDK_ROOT=D:\abuild\sdk
   D:\abuild\gradle\gradle-8.9\bin\gradle.bat -p G:\NotiKeeper assembleDebug
   ```
   ได้ไฟล์ที่ `app/build/outputs/apk/debug/app-debug.apk` → **เปลี่ยนชื่อเป็น `NotiKeeper.apk`**
3. **แก้ `release/version.json`** ให้ `versionCode`/`versionName` ตรงกับที่ build + ใส่ `notes`
4. **สร้าง GitHub Release** (tag เช่น `v1.6`) แล้ว **แนบไฟล์ 2 อัน**:
   - `NotiKeeper.apk`
   - `version.json`
5. เสร็จ — เครื่องที่ลงเวอร์ชันเก่าจะเห็นการ์ด "มีเวอร์ชันใหม่" และกดอัปเดตได้

## หมายเหตุ
- repo แบบ **private** ต้องใช้ token ดาวน์โหลด — ใช้ **public** จะง่ายกว่ามากสำหรับ APK สาธารณะ
- ถ้าไม่อยากใช้ GitHub ใช้ static host ไหนก็ได้ที่ให้ URL ตรงไปยัง `version.json` + `NotiKeeper.apk` (เช่น Cloudflare Pages, Netlify, S3)
- การติดตั้งทับต้องเป็น APK ที่ลงนามด้วย key เดียวกัน — debug build ใช้ debug keystore เดียวกันทุกครั้งบนเครื่องนี้อยู่แล้ว จึงทับได้
