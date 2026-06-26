# NotiKeeper

> ดู [`CHANGELOG.md`](CHANGELOG.md) สำหรับประวัติเวอร์ชัน · [`ARCHITECTURE.md`](ARCHITECTURE.md) อธิบายโครงระบบ · [`SECURITY.md`](SECURITY.md) อธิบาย threat model + การเข้ารหัส · [`RELEASE.md`](RELEASE.md) วิธีปล่อยรุ่นใหม่ · [`CLAUDE.md`](CLAUDE.md) บริบทสำหรับ AI ที่เปิด repo นี้ · [`LICENSE`](LICENSE) MIT


แอป Android ที่ **บันทึกข้อความ/การแจ้งเตือน** (เน้น Messenger) ลงฐานข้อมูลในเครื่องแบบถาวร
แก้ปัญหาที่ระบบเก็บประวัติแจ้งเตือนไว้แค่ ~24 ชั่วโมง — ตัวนี้เก็บไม่จำกัด และค้นหาย้อนหลังได้

เก็บข้อมูล **2 ทางคู่กัน**:

| โหมด | ใช้สิทธิ์ | เก็บอะไร |
|---|---|---|
| **แจ้งเตือน** (NotiLoggerService) | Notification access | ทุกแอปแบบเบื้องหลัง แต่ได้แค่ "ตัวอย่างข้อความ" ที่เด้งใน noti |
| **อ่านหน้าจอ** (MessengerReaderService) | Accessibility | บทสนทนา **เต็ม ๆ** บนจอ Messenger ตอนเปิดอ่าน (เลื่อนขึ้นดูของเก่า มันเก็บเพิ่ม) แยกฝั่ง ซ้าย=เขา ขวา=เรา |

> ⚠️ เก็บได้เฉพาะสิ่งที่ "เข้ามา/เปิดดูหลังติดตั้ง + เปิดสิทธิ์" เท่านั้น
> แชทที่หายไปแล้วก่อนหน้านี้ แอปนี้กู้กลับไม่ได้

---

## โครงไฟล์
```
app/src/main/
├── AndroidManifest.xml
├── res/
│   ├── values/themes.xml, strings.xml
│   └── xml/messenger_reader_config.xml   # ตั้งค่า accessibility (เจาะจง Messenger)
└── java/com/example/notikeeper/
    ├── MainActivity.kt           # UI (Compose) — ค้นหา/อ่าน + ปุ่มเปิดสิทธิ์
    ├── NotiLoggerService.kt      # ดักจับการแจ้งเตือนทุกแอป
    ├── MessengerReaderService.kt # อ่านบทสนทนาบนจอ Messenger
    └── data/NotiStore.kt         # ฐานข้อมูล SQLite (กันข้อมูลซ้ำด้วย dedupKey)
```

---

## วิธี build

### ทาง A — Android Studio (แนะนำสำหรับคนไม่เคยเขียนแอป)
1. ติดตั้ง **Android Studio** (ฟรี): https://developer.android.com/studio — กด Next รัว ๆ ให้มันโหลด SDK เอง
2. เปิด Android Studio → **Open** → เลือกโฟลเดอร์ `G:\NotiKeeper`
3. รอ "Gradle Sync" เสร็จ (ครั้งแรก ~5–15 นาที) — ถ้าเตือนเรื่อง *Gradle wrapper* ให้กดยอมรับให้มันดาวน์โหลด
4. เมนู **Build → Build App Bundle(s)/APK(s) → Build APK(s)**
5. ได้ไฟล์ที่ `app/build/outputs/apk/debug/app-debug.apk`
6. โอนไฟล์ `.apk` เข้ามือถือ (USB / Google Drive / LINE Keep) แล้วแตะติดตั้ง (อนุญาต "แหล่งที่ไม่รู้จัก")

### ทาง B — ต่อมือถือกด Run
เปิด USB debugging (ตั้งค่า → เกี่ยวกับโทรศัพท์ → แตะ "หมายเลขบิลด์" 7 ครั้ง → ตัวเลือกนักพัฒนา → USB debugging) → เสียบสาย → กด ▶ Run

---

## หลังติดตั้งบนมือถือ — เปิดสิทธิ์ 2 อย่าง

เปิดแอป NotiKeeper จะเห็นการ์ดให้กดเปิดสิทธิ์:

1. **สิทธิ์แจ้งเตือน** → กดการ์ด → เปิดสวิตช์ NotiKeeper ในหน้า "การเข้าถึงการแจ้งเตือน"
2. **สิทธิ์อ่านหน้าจอ (Accessibility)** → กดการ์ด → ในหน้า "การช่วยเหลือพิเศษ" หา **NotiKeeper Screen Reader** → เปิด → กดยืนยัน

จากนั้น:
- เปิดแชท Messenger ที่ต้องการ → **เลื่อนอ่านช้า ๆ** ขึ้นไปจนถึงข้อความสำคัญ
  ทุกข้อความที่ผ่านสายตาจะถูกเก็บอัตโนมัติ
- กลับมาที่ NotiKeeper → กด **รีเฟรช** → พิมพ์คำค้นเพื่อหาย้อนหลัง

---

## ข้อจำกัด / เคล็ดลับ (อ่านสักนิด)
- การแยก "ผู้ส่ง/ข้อความ/เวลา" เป็น **best-effort** — Messenger ออกแบบหน้าจอซับซ้อนและเปลี่ยนบ่อย
  บางบรรทัดอาจเป็นปุ่ม/ป้ายระบบปนมาบ้าง (ค้นหากรองออกได้)
- ฝั่ง ซ้าย=เขา / ขวา=เรา เดาจากตำแหน่งกล่องข้อความ อาจคลาดเคลื่อนในกลุ่มแชท
- เวลา = เวลาที่ "อ่านเจอบนจอ" ไม่ใช่เวลาส่งจริงเสมอไป
- บางรุ่น (Xiaomi/Oppo/Vivo) ชอบปิด service ตอนประหยัดแบต — ตั้ง NotiKeeper เป็น "ไม่ประหยัดแบต" และล็อกไว้ในรายการแอปล่าสุด
- รองรับ **Messenger / Messenger Lite / Facebook / LINE / Instagram DM** แล้ว — เพิ่มแอปอื่นได้โดยเติม package ใน `messenger_reader_config.xml` (`packageNames`) และ `MessengerReaderService.targets`

## สำรอง / ส่งออกข้อมูล (ปุ่ม "สำรอง" มุมขวาบน)
3 ทาง:
1. **แชร์ JSON / CSV** → เปิด share sheet ของระบบ → ส่งเข้า **Google Drive / อีเมล / Nearby / ส่งเข้าคอม** ได้ทุกแอป
2. **บันทึกลง Downloads** → ได้ไฟล์ `notikeeper.json` + `notikeeper.csv` ในโฟลเดอร์ Downloads (ก๊อปเข้าคอมผ่านสาย USB ได้)
3. **อัปโหลดไป Cloud/Server ส่วนตัว (API)** → ใส่ Endpoint URL (+ Token ถ้ามี) → กด "อัปโหลดตอนนี้" หรือเปิดสวิตช์อัปโหลดอัตโนมัติเมื่อเปิดแอป

### สเปก API (สำหรับตั้งเซิร์ฟเวอร์ส่วนตัว/บนคอม)
- `POST <endpoint>` , `Content-Type: application/json`
- ถ้าตั้ง token → header `Authorization: Bearer <token>`
- body = JSON array ของออบเจ็กต์: `{id, source, app, pkg, title, text, side, time}`
- ตอบ HTTP 2xx = สำเร็จ; แอปจำ id ล่าสุดที่อัปโหลด แล้วส่ง **เฉพาะรายการใหม่** ครั้งถัดไป

ตัวอย่างเซิร์ฟเวอร์เล็ก ๆ (Python Flask) รันบนคอม แล้วอัปโหลดผ่าน Wi-Fi วงเดียวกัน:
```python
from flask import Flask, request
import json, pathlib
app = Flask(__name__)
@app.post("/ingest")
def ingest():
    rows = request.get_json()
    with open("notikeeper_backup.jsonl", "a", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return {"ok": True, "received": len(rows)}
app.run(host="0.0.0.0", port=8000)   # endpoint = http://<ไอพีคอม>:8000/ingest
```

> ⚠️ ไฟล์/ข้อมูลที่ส่งออกเป็น **plaintext** (ถอดรหัสแล้ว) เพื่อให้อ่านได้บนคอม/Drive — เก็บไว้ในที่ปลอดภัย
> การอัปโหลด API ใช้สิทธิ์ INTERNET (ขอเพิ่มในเวอร์ชันนี้) — ทำงานเฉพาะตอนคุณตั้งค่า+สั่งเองเท่านั้น

## ความปลอดภัย / ความเป็นส่วนตัว
- ข้อมูลทั้งหมดอยู่ในไฟล์ `noti.db` ในเครื่องคุณคนเดียว **ไม่มีการส่งออกเน็ต** ไม่มีเซิร์ฟเวอร์ ไม่มีโฆษณา
- **เข้ารหัสทั้งไฟล์ด้วย SQLCipher (AES-256)** — ถ้าใครก๊อปไฟล์ออกไป (root/backup) จะอ่านไม่ออก
- **กุญแจเก็บใน Android Keystore** (ผ่าน EncryptedSharedPreferences) — service เปิด db เองได้ กุญแจไม่โผล่เป็น plaintext
- **ล็อกหน้าแอปด้วยลายนิ้วมือ / PIN เครื่อง** ทุกครั้งที่เปิด (และล็อกใหม่ทุกครั้งที่ออกจากแอป)

> ⚠️ การล็อกแอปจะทำงานก็ต่อเมื่อ **เครื่องตั้งล็อกหน้าจอ (PIN/รูปแบบ/ลายนิ้วมือ) ไว้แล้ว**
> ถ้าเครื่องไม่มีล็อกหน้าจอเลย แอปจะเปิดผ่านได้ (เพราะไม่มีอะไรให้ยืนยัน) — แนะนำตั้งล็อกหน้าจอไว้
>
> ⚠️ ถ้า **ล้างข้อมูลแอป** หรือ **factory reset** กุญแจจะหาย → ฐานข้อมูลเดิมอ่านไม่ได้อีก (โดยตั้งใจ)
> ถ้าต้องการเก็บข้อมูลถาวร แนะนำเพิ่มฟีเจอร์ Export ออกเป็นไฟล์

## ข้อกำหนดเครื่อง
- รองรับ **Android 11 (API 30) ขึ้นไป** — เพื่อใช้ระบบล็อกลายนิ้วมือ/PIN แบบใหม่ที่เสถียร
- ขนาดแอปจะใหญ่ขึ้นเล็กน้อย เพราะ SQLCipher มี native library (ปกติ)
