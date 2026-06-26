# NotiKeeper Control Panel

GUI สำหรับคุม MCP server (รัน/หยุด/รีสตาร์ท/เปิด dashboard) บน Windows
ใช้ PowerShell + WinForms (built-in) — ไม่ต้องลงอะไรเพิ่ม

## เปิดใช้

**Double-click ไฟล์:**
```
G:\NotiKeeper\mcp-server\NotiKeeper Control.cmd
```

จะเด้งหน้าต่างขนาด 500×360 พร้อมสถานะ server แบบ live

## หน้าตา

```
┌─────────────────────────────────────────────────────┐
│  🔔  NotiKeeper                                     │
│  MCP server + ingest + dashboard                    │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ●  Running on port 8765                     │   │
│  │    PID 23532 · http://localhost:8765/       │   │
│  │    399 messages · top: LINE                 │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [ ▶ Start ]  [ 🌐 Dashboard ]  [ 📂 Folder ]      │
│                                                     │
│                [ ↻ Restart ]   [ ⚙ Auto-start ]    │
│                                                     │
│  data: G:\NotiKeeper\mcp-server\data.jsonl          │
└─────────────────────────────────────────────────────┘
```

## ปุ่ม

| ปุ่ม | ทำอะไร |
|---|---|
| **Start / Stop** | เปิด/ปิด server บนพอร์ต 8765 (toggle ตามสถานะ) |
| **Dashboard** | เปิด browser ไป `http://localhost:8765/` |
| **Folder** | เปิด Explorer ที่โฟลเดอร์ server (ดู `data.jsonl`) |
| **Restart** | ปิดแล้วเปิดใหม่ (กดเมื่อแก้โค้ด server) |
| **Auto-start** | สร้าง/ลบ shortcut ใน Startup folder ของ Windows — toggle on/off |

## สถานะแบบ live (poll ทุก 2 วิ)
- 🟢 เขียว = Running + HTTP ตอบกลับ + จำนวนข้อความสด
- 🟡 ทอง = process เพิ่ง spawn แต่ HTTP ยังไม่พร้อม
- 🔴 แดง = Stopped (แสดงจำนวนข้อความที่เก็บไว้แบบ offline ถ้ามี)

## Auto-start
กดปุ่ม **Auto-start** จะสร้าง shortcut ที่:
```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NotiKeeper Server.lnk
```
ตอน Windows boot ครั้งหน้า server จะเปิดเอง (window minimize, ไม่รบกวน)

กดอีกครั้งเพื่อปิด

## ปัญหาที่อาจเจอ

**"Node.js ไม่พบ"** — แก้ใน [NotiKeeper-Control.ps1](NotiKeeper-Control.ps1) บรรทัด `$NodeExe = '...'` ให้ชี้ไปยัง path node บนเครื่องคุณ

**ปุ่ม Start แล้วยังแดง** — node อาจหา dependency ไม่เจอ ลอง `npm install` ในโฟลเดอร์นี้ก่อน

**Port 8765 ถูกใช้แล้ว** — เปลี่ยน env `NOTIKEEPER_PORT` ใน start-server.cmd
