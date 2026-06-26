# เอกสารความต้องการของผลิตภัณฑ์ (Product Requirement Document - PRD)

## ชื่อโปรเจกต์: NotiKeeper (ระบบเก็บถาวรการแจ้งเตือนและบทสนทนาบนมือถือ Android)

**เวอร์ชัน:** 1.0 (สอดคล้องกับ NotiKeeper app v1.6 ที่ release แล้ว)
**สถานะ:** เผยแพร่ใช้งานจริง (Personal-use, Sideload-only)
**กลุ่มผู้ใช้เป้าหมาย:** เจ้าของอุปกรณ์ Android ที่ต้องการ archive การแจ้งเตือนและบทสนทนาแชตของตัวเอง

> เอกสารคู่กัน: [BRD](BRD-NotiKeeper-v1.0.md) (ฝั่งธุรกิจ), [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md)

---

## 1. บทนำและวิสัยทัศน์ของผลิตภัณฑ์ (Product Vision)

**NotiKeeper** คือแอป Android ที่ทำหน้าที่เป็น **"สมุดความจำส่วนตัว"** สำหรับการแจ้งเตือนและบทสนทนาในเครื่องของเจ้าของอุปกรณ์ มันเก็บการแจ้งเตือนทุกแอปและบทสนทนาจากแอปแชตหลัก (Messenger / LINE / Instagram / WhatsApp / Telegram) ลงฐานข้อมูลเข้ารหัส AES-256 บนเครื่อง พร้อมล็อกด้วย biometric ให้เจ้าของเครื่องค้นย้อนหลังได้ไม่จำกัดเวลา

วิสัยทัศน์: **"แม้แพลตฟอร์มจะลบข้อความหรือล้างประวัติแจ้งเตือน เจ้าของอุปกรณ์ยังคงเข้าถึงข้อมูลของตัวเองได้"** — โดยที่ข้อมูลทั้งหมดอยู่ในเครื่องคนเดียว ไม่มี cloud, ไม่มี telemetry, ไม่มีโฆษณา

## 2. ปัญหาที่ต้องการแก้ไข (Pain Points & Solutions)

| ปัญหาของผู้ใช้ Android ในปัจจุบัน | แนวทางแก้ไขของ NotiKeeper (Solutions) |
| :---- | :---- |
| **ประวัติแจ้งเตือนอยู่ได้แค่ ~24 ชม.** ระบบลบทิ้งอัตโนมัติ | **NotificationListenerService:** ดักจับ noti ทุกแอปทันทีที่เข้ามา เก็บลง DB เข้ารหัสในเครื่องแบบไม่จำกัดเวลา |
| **เผลอลบแชต Messenger → ข้อมูลฝั่งเราหายทันที** | **AccessibilityService:** อ่าน accessibility tree ของหน้าจอแชตขณะเปิดอ่าน เก็บทุกข้อความที่ผ่านสายตา (ใช้กับ Messenger/LINE/IG/WhatsApp/Telegram) |
| **Facebook DYI ไม่ใช่ real-time + ใช้ไม่ได้กับแชตที่ลบ** | **เก็บ real-time:** ทันทีที่ noti เด้งหรือเปิดอ่านแชต ข้อมูลถูกบันทึกก่อนจะถูกลบ |
| **กลัวข้อมูลรั่วถ้ามีคนเปิดเครื่อง** | **2 ชั้น: เข้ารหัสไฟล์ + ล็อกแอป** SQLCipher AES-256 + biometric/PIN ผ่าน Android Keystore |
| **ถอนแอป = ข้อมูลหายหมด** | **Export JSON/CSV** ลง Downloads / share sheet / อัปโหลด private API |
| **แอปอัปเดตยุ่ง ต้องโอนไฟล์ APK เอง** | **In-app updater:** เช็ค GitHub Releases อัตโนมัติ → กดปุ่มเดียวอัปเดต |
| **คนขับมอเตอร์ไซค์มองจอไม่ได้ขณะขับ** | **TTS read-aloud:** อ่าน noti / ข้อความบนจอออกเสียงผ่านหูฟัง พร้อม ducking เพลง (เชื่อมกับ [CoVibe PRD §4.3/§5.4](../../covibe/docs/context/Product%20Requirement%20Document%20%28PRD%29%20-%20CoVibe%20v1.6.md)) |
| **อยากให้ AI ช่วยค้นแชตย้อนหลัง** | **MCP server:** Claude Desktop เรียก tools `search_messages`, `recent_messages`, `list_apps`, `stats` ผ่าน MCP |

## 3. สถาปัตยกรรมระบบ (System Architecture)

> รายละเอียดเต็มอยู่ใน [`ARCHITECTURE.md`](../ARCHITECTURE.md) — ส่วนนี้สรุปเฉพาะที่จำเป็นต่อความเข้าใจ requirement

### 3.1 สามองค์ประกอบหลัก

```
┌─────────────────────────────────────────────────────────────────┐
│                    Android Device (เจ้าของ)                     │
│                                                                  │
│   [Capture Layer]              [Storage]         [UI / Action]  │
│   • NotiLoggerService    ───▶  NotiStore  ───▶   MainActivity   │
│   • MessengerReaderSvc   ───▶  (SQLCipher)       (Compose)      │
│   • Speaker (TTS)        ◀───                    (Biometric)    │
│                                                        │         │
└────────────────────────────────────────────────────────┼─────────┘
                                                         │
                  ┌───── Share / Downloads ◀─────────────┤
                  │                                       │
                  ▼          POST /ingest ▼               ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
        │ Google Drive │  │ NotiKeeper   │  │ GitHub Releases  │
        │ / email / PC │  │ MCP server   │  │ (in-app updater) │
        └──────────────┘  │ (Node, PC)   │  └──────────────────┘
                          └──────┬───────┘
                                 ▼
                          Claude / AI tools
```

### 3.2 เลเยอร์การเก็บข้อมูล (Capture Layer) — สอง stream คู่กัน

| Stream | กลไก | จุดเด่น | ข้อจำกัด |
| :---- | :---- | :---- | :---- |
| **Noti Stream** | `NotificationListenerService` | ครอบทุกแอป, ทำงานเบื้องหลัง, ประหยัดพลังงาน | ได้แค่ "ตัวอย่างข้อความ" ที่เด้งใน noti |
| **Screen Stream** | `AccessibilityService` (เฉพาะแอปแชต whitelist) | ได้ข้อความเต็ม + แยก ฉัน/เขา + เลื่อนอ่านของเก่าได้ | ต้องเปิดอ่านจริงให้มันเห็น |

ทั้งสอง stream เก็บลงตารางเดียวกัน แยกด้วย `source = "noti" | "screen"` เพื่อให้ค้นหารวมกันได้

### 3.3 ชั้นความปลอดภัย (Security Layers)

| ชั้น | กลไก | กันอะไร |
| :---- | :---- | :---- |
| **At rest** | SQLCipher AES-256 ทั้งไฟล์ | ป้องกัน forensic grab / ADB backup / รูทเครื่อง |
| **Key storage** | EncryptedSharedPreferences + Android Keystore | กุญแจไม่โผล่ plaintext บนดิสก์ |
| **UI gate** | BiometricPrompt (`BIOMETRIC_STRONG \| DEVICE_CREDENTIAL`) | กันคนหยิบเครื่องเปิดดู |
| **Network** | ไม่มี traffic ใด ๆ โดยปริยาย | ผู้ใช้ต้องตั้ง upload URL หรือ update URL เองถึงจะมี egress |

## 4. ความต้องการเชิงฟังก์ชันการทำงาน (Functional Requirements)

### 4.1 ฟังก์ชันการเก็บข้อมูล (Capture)

- **F-1.1 เก็บการแจ้งเตือนทุกแอปอัตโนมัติ:** เมื่อ noti เด้ง ระบบจะเก็บ title + body (ใช้ `EXTRA_BIG_TEXT` > `EXTRA_TEXT_LINES` > `EXTRA_TEXT`) ยกเว้น notification แบบ ongoing (เพลง/ดาวน์โหลด)
- **F-1.2 เก็บบทสนทนาบนหน้าจอแอปแชต:** Messenger / Messenger Lite / Facebook / LINE / Instagram / WhatsApp / WhatsApp Business / Telegram / Telegram X
- **F-1.3 แยกฝั่งผู้ส่ง:** เดาตำแหน่งกล่องบนจอ — `me` ถ้าอยู่ขวา, `them` ถ้าอยู่ซ้าย
- **F-1.4 ระบุชื่อแชต:** ใช้บรรทัดบนสุดของหน้าจอเป็น conversation title
- **F-1.5 กันข้อมูลซ้ำ:** dedup ด้วย UNIQUE key (`noti:title:text:time` หรือ `screen:sender:side:text`)

### 4.2 ฟังก์ชันการเข้าถึงข้อมูล (Access)

- **F-2.1 ค้นหาแบบ free-text:** ค้นพร้อมกันในชื่อแอป / ชื่อผู้ส่ง / ข้อความ
- **F-2.2 เรียงตามเวลา:** ใหม่สุดอยู่บน, จำกัด 5000 รายการต่อ query เพื่อ performance
- **F-2.3 ล้างข้อมูล:** ปุ่ม "ล้าง" ลบทุกแถวออก (มี confirmation ทาง UX implicit จากการต้องเปิดแอป)

### 4.3 ฟังก์ชันการสำรอง / ส่งออก (Backup / Export)

- **F-3.1 Share JSON / CSV:** ผ่าน system share sheet → Drive, อีเมล, ส่งเข้า PC
- **F-3.2 บันทึกลง Downloads:** เขียนไฟล์ลงโฟลเดอร์สาธารณะของระบบ
- **F-3.3 อัปโหลด API ส่วนตัว:** `POST <endpoint>` body = JSON array, optional `Authorization: Bearer`
- **F-3.4 Incremental upload:** จำ id ล่าสุดที่อัปไป ส่งเฉพาะรายการใหม่ครั้งถัดไป
- **F-3.5 Auto-upload toggle:** เปิดสวิตช์ให้อัปโหลดอัตโนมัติทุกครั้งที่เปิดแอป

### 4.4 ฟังก์ชันอ่านออกเสียงสำหรับคนขับ (Eyes-Free Read-aloud)

- **F-4.1 อ่านการแจ้งเตือน:** noti เข้า → พูดออกเสียงทันที (พร้อมหรี่เพลง)
- **F-4.2 อ่านเนื้อหาบนจอ:** ขณะเปิดแอปแชต → อ่านข้อความใหม่ที่เห็น
- **F-4.3 ตัวกรองแอป (App whitelist):** สแกนแอปทั้งหมดในเครื่องให้ติ๊กเลือก ไม่ติ๊ก = อ่านทุกแอป
- **F-4.4 ช่องค้นหาแอปในรายการ:** กรองรายการแอปเพื่อหาเร็วขึ้น
- **F-4.5 Audio ducking:** ใช้ `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` ให้เพลงหรี่ลง ~20% ขณะพูด

### 4.5 ฟังก์ชันการอัปเดต (In-app Update)

- **F-5.1 ตั้ง URL อัปเดต:** ผู้ใช้ใส่ URL ของ `version.json` ในแอป (ออกแบบให้ตรงกับ GitHub Releases `/releases/latest/download/version.json`)
- **F-5.2 เช็คอัตโนมัติ:** ทุกครั้งที่เปิดแอป → ถ้า `versionCode` ใน manifest ใหม่กว่าตัวที่ติดตั้ง → ขึ้นการ์ดแจ้ง
- **F-5.3 ดาวน์โหลด + ติดตั้ง:** กดปุ่มเดียว → โหลด APK ลง cache → เปิด `ACTION_VIEW` ให้ระบบติดตั้ง
- **F-5.4 Manual check:** ปุ่ม "ตรวจ & อัปเดตตอนนี้" สำหรับสั่งเอง

### 4.6 ฟังก์ชันการเชื่อมต่อ AI (MCP Integration)

- **F-6.1 MCP server (Node):** รัน stdio MCP ให้ Claude Desktop เรียกใช้
- **F-6.2 รับอัปโหลดในตัว:** server เปิด HTTP endpoint `:8765/ingest` รับข้อมูลจากแอปและบันทึก `data.jsonl`
- **F-6.3 Tools ที่ expose:** `search_messages(query, limit?)`, `recent_messages(limit?, app?)`, `list_apps()`, `stats()`

## 5. ความต้องการเชิงคุณภาพ (Non-Functional Requirements)

### 5.1 ความปลอดภัย (Security) — ดู [`SECURITY.md`](../SECURITY.md) เต็ม
- ฐานข้อมูลเข้ารหัสทั้งไฟล์ AES-256
- กุญแจอยู่ใน Android Keystore (hardware-backed ถ้ามี)
- UI ล็อกทุกครั้งที่ออกจากแอป
- ไม่มี network traffic ที่ผู้ใช้ไม่ได้สั่ง

### 5.2 ความเสถียรของ Background Service
- ทำงานข้ามรีบูตได้ (NotificationListener + AccessibilityService รีเซ็ตเองโดยระบบ)
- ทนการ "ฆ่า service" ของยี่ห้อจีน (Xiaomi/Oppo/Vivo) ผ่านคำแนะนำ "ไม่จำกัดแบต" ใน README

### 5.3 Performance
- Insert ใช้ transaction batch (สำหรับ screen capture)
- Query จำกัด 5000 แถว เรียง `postTime DESC, id DESC`
- Debounce accessibility event 500ms กันยิงรัว
- LRU 600 บรรทัดใน MessengerReaderService กันเก็บซ้ำตอนเลื่อนจอ

### 5.4 Compatibility
- รองรับ **Android 11 (API 30) ขึ้นไป**
- รองรับทั้ง portrait/landscape (Compose handles automatically)
- รองรับภาษาไทย + อังกฤษ (TTS เลือก locale อัตโนมัติ)

### 5.5 Distribution
- **Sideload-only ผ่าน GitHub Releases** ไม่อยู่บน Play Store (เหตุผล policy ดู [SECURITY.md §Policy](../SECURITY.md))
- Debug-signed APK (deterministic keystore) → upgrade ทับกันได้

## 6. กรณีพิเศษและขอบเขตข้อจำกัด (Edge Cases & Limitations)

- **แอปต้นทางเปลี่ยน UI:** Messenger/IG เปลี่ยน accessibility tree บ่อย — heuristic ใน `MessengerReaderService.kt` ต้องปรับเป็นครั้งคราว
- **Notification แบบยุบรวม:** ถ้า OS รวม "3 ข้อความใหม่" เป็น 1 noti อาจได้แค่สรุป — ใช้ `EXTRA_TEXT_LINES` ช่วย
- **iOS:** ไม่รองรับ (ไม่อยู่ในขอบเขต)
- **แอปที่ส่ง noti แบบเข้ารหัส E2E พิเศษ:** เก็บได้แค่ที่ระบบแสดง (Signal, Wickr อาจไม่ได้)
- **factory reset / clear data:** Keystore master key หาย → DB เดิมอ่านไม่ได้อีก (โดยตั้งใจ) — ใช้ Export ก่อนถ้าจำเป็น

## 7. แผนพัฒนาในอนาคต (Future Roadmap)

| รายการ | สถานะ | เกี่ยวข้อง |
| :---- | :---- | :---- |
| ปุ่มหูฟัง AVRCP / floating accessibility trigger สำหรับสั่งอ่านจอ hands-free | 🔄 plan | CoVibe PRD §5.4.3 |
| Voice command สำหรับสั่งงานด้วยเสียง | 🔄 plan | CoVibe PRD §7 |
| ไอคอนแอปแบบ raster / branding ละเอียดขึ้น | 🔄 plan | — |
| Release-signed APK + เก็บ keystore ปลอดภัย | 🔄 plan | สำหรับแจกในวงกว้างขึ้น |
| GitHub Actions auto-build เมื่อ push tag | 🔄 plan | ลดงาน manual release |
| รองรับแอปไรเดอร์เฉพาะ (Grab Driver / Line Man / Robinhood / Foodpanda) | 🔄 plan | ใช้กับงานขับจริง |
| Self-host MCP server บน Raspberry Pi 24/7 | 🔄 plan | ให้ Claude เข้าถึงตลอดเวลา |
| รองรับแอปแชตเพิ่ม (Signal / Discord / Slack — ตามที่ accessibility อ่านได้) | 🔄 plan | — |

## 8. ข้อตกลงเชิงจริยธรรม (Ethical Use Statement)

NotiKeeper ออกแบบมาเพื่อให้ **เจ้าของอุปกรณ์ใช้กับข้อมูลของตัวเอง** เท่านั้น การใช้กับบัญชี/อุปกรณ์ของผู้อื่นโดยไม่ได้รับความยินยอม, การเผยแพร่ข้อความของคู่สนทนาโดยไม่ได้รับอนุญาต, หรือการใช้เพื่อเฝ้าระวังบุคคลอื่น — อยู่นอกขอบเขตการใช้งานที่ตั้งใจ และผู้ดูแลโครงการขอปฏิเสธความรับผิดชอบในการใช้นอกขอบเขตดังกล่าว
