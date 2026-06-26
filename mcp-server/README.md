# NotiKeeper MCP Server

ทำให้ข้อมูลที่ NotiKeeper เก็บไว้ "ค้นหาผ่าน Claude/AI ได้" — เซิร์ฟเวอร์ตัวเดียวทำ 2 อย่าง:

1. **รับอัปโหลดจากแอป** ที่ `POST http://<ไอพีคอม>:8765/ingest` (= ปุ่ม "อัปโหลด API" ในแอป)
2. **เปิด MCP tools** ให้ Claude เรียก: `search_messages`, `recent_messages`, `list_apps`, `stats`

ข้อมูลเก็บเป็นไฟล์ `data.jsonl` ในโฟลเดอร์นี้ (กันซ้ำด้วย id+time)

## ติดตั้ง
```
cd G:\NotiKeeper\mcp-server
npm install
```

## ตั้งค่าฝั่งแอป (NotiKeeper)
หน้า "สำรอง" → ส่วน API:
- **Endpoint URL:** `http://<ไอพีคอมในวง Wi-Fi เดียวกัน>:8765/ingest` (เช่น `http://192.168.1.50:8765/ingest`)
- เปิดสวิตช์ **อัปโหลดอัตโนมัติ** → ทุกครั้งที่เปิดแอป จะส่งรายการใหม่เข้ามาเอง

> มือถือกับคอมต้องอยู่ Wi-Fi วงเดียวกัน และเปิดพอร์ต 8765 บนคอม (Windows Firewall อาจถามครั้งแรก — กด Allow)

## เพิ่มเข้า Claude Desktop
แก้ `%APPDATA%\Claude\claude_desktop_config.json` เพิ่ม entry ใน `mcpServers`:
```json
{
  "mcpServers": {
    "notikeeper": {
      "command": "C:\\Users\\freshair\\AppData\\Local\\GoVibeToolchains\\node-v24.16.0-win-x64\\node.exe",
      "args": ["G:\\NotiKeeper\\mcp-server\\server.mjs"],
      "env": { "NOTIKEEPER_PORT": "8765" }
    }
  }
}
```
รีสตาร์ต Claude Desktop → ถามได้เลย เช่น "ค้นหาข้อความที่มีคำว่า ... จาก NotiKeeper" หรือ "recent messages from LINE"

## env (ออปชัน)
| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `NOTIKEEPER_PORT` | 8765 | พอร์ตรับอัปโหลด |
| `NOTIKEEPER_TOKEN` | (ว่าง) | ถ้าตั้ง แอปต้องส่ง `Authorization: Bearer <token>` (ใส่ token เดียวกันในแอป) |
| `NOTIKEEPER_DATA` | ./data.jsonl | ที่เก็บข้อมูล |

## tools ที่เปิดให้ Claude
- `search_messages(query, limit?)` — ค้นในชื่อแอป/ผู้ส่ง/ข้อความ
- `recent_messages(limit?, app?)` — ล่าสุด (กรองตามแอปได้)
- `list_apps()` — รายชื่อแอป + จำนวน
- `stats()` — สรุปจำนวน/ช่วงเวลา/ที่เก็บไฟล์
