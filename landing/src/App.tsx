import { useState, useEffect } from 'react';
import {
  Bell,
  Lock,
  Volume2,
  Download,
  Cpu,
  RefreshCw,
  GitFork,
  ShieldCheck,
  Smartphone,
  Search,
  ArrowRight,
  Menu,
  X,
  Apple,
} from 'lucide-react';

const REPO = 'https://github.com/Freshair129/notikeeper';
const LATEST_APK = `${REPO}/releases/latest/download/NotiKeeper.apk`;
const VERSION_URL = `${REPO}/releases/latest/download/version.json`;
const IOS_SRC = `${REPO}/tree/main/ios/NotiKeeperIOS`;

const navLinks = [
  { href: '#features', label: 'ฟีเจอร์' },
  { href: '#security', label: 'ความปลอดภัย' },
  { href: '#download', label: 'ดาวน์โหลด' },
  { href: '#install', label: 'ติดตั้ง' },
  { href: '#docs', label: 'เอกสาร' },
];

const features = [
  {
    icon: Bell,
    title: 'เก็บแจ้งเตือนทุกแอป',
    body: 'ทันทีที่ noti เด้ง ระบบจะบันทึก title + เนื้อหาลง DB ทำงานเบื้องหลัง ไม่มี overlay ไม่มีไอคอนค้าง',
  },
  {
    icon: Smartphone,
    title: 'อ่านบทสนทนาบนจอ',
    body: 'รองรับ Messenger / LINE / IG / WhatsApp / Telegram — เลื่อนอ่านแชตที่ลบไปแล้ว ก็เก็บเข้า DB ได้',
  },
  {
    icon: Lock,
    title: 'เข้ารหัสทั้งไฟล์ + ล็อกแอป',
    body: 'SQLCipher AES-256, กุญแจอยู่ใน Android Keystore, UI ล็อกด้วยลายนิ้วมือ/PIN ทุกครั้งที่เปิด',
  },
  {
    icon: Volume2,
    title: 'อ่านออกเสียง (สำหรับขับรถ)',
    body: 'TTS อ่านแจ้งเตือน + ข้อความบนจอผ่านหูฟัง พร้อมหรี่เพลงตอนพูดเหมือนเสียงนำทาง GPS',
  },
  {
    icon: Download,
    title: 'สำรอง + ส่งออก',
    body: 'แชร์ JSON/CSV เข้า Drive / อีเมล / คอม, บันทึกลง Downloads, หรืออัปโหลด API ส่วนตัวอัตโนมัติ',
  },
  {
    icon: Cpu,
    title: 'เชื่อม Claude / AI ผ่าน MCP',
    body: 'MCP server ในตัวรับอัปโหลดจากแอป + เปิด tools ให้ Claude ค้นข้อความ recent / search / stats',
  },
];

const securityLayers = [
  {
    icon: ShieldCheck,
    title: 'At rest — SQLCipher AES-256',
    body: 'ไฟล์ noti.db ทั้งไฟล์ถูกเข้ารหัส ถ้าใครก๊อปไฟล์ออกไปก็อ่านไม่ออก',
  },
  {
    icon: Lock,
    title: 'Key — Android Keystore',
    body: 'กุญแจ 32 ไบต์เก็บใน EncryptedSharedPreferences (master key hardware-backed) ไม่โผล่ plaintext',
  },
  {
    icon: Smartphone,
    title: 'UI — Biometric / PIN',
    body: 'BIOMETRIC_STRONG | DEVICE_CREDENTIAL ล็อกใหม่ทุกครั้งที่ออกจากแอป',
  },
];

const installSteps = [
  {
    n: '01',
    title: 'ดาวน์โหลด APK',
    body: 'จาก GitHub Releases ล่าสุด แล้วโอนเข้ามือถือ (USB / Drive / LINE Keep)',
  },
  {
    n: '02',
    title: 'ติดตั้ง + เปิดสิทธิ์',
    body: 'อนุญาต "แหล่งที่ไม่รู้จัก" → เปิด NotiKeeper → เปิดสิทธิ์ "แจ้งเตือน" + "Accessibility"',
  },
  {
    n: '03',
    title: 'ตั้ง URL อัปเดต (ทำครั้งเดียว)',
    body: 'หน้า "สำรอง" → ช่อง URL ใส่ลิงก์ version.json — ครั้งหน้าเช็คอัปเดตให้เอง',
  },
];

const docs = [
  { label: 'README', href: `${REPO}/blob/main/README.md`, sub: 'วิธีใช้ + ติดตั้ง' },
  { label: 'PRD', href: `${REPO}/blob/main/docs/PRD-NotiKeeper-v1.0.md`, sub: 'Product Requirements' },
  { label: 'BRD', href: `${REPO}/blob/main/docs/BRD-NotiKeeper-v1.0.md`, sub: 'Business Requirements' },
  { label: 'ARCHITECTURE', href: `${REPO}/blob/main/ARCHITECTURE.md`, sub: 'โครงระบบ' },
  { label: 'SECURITY', href: `${REPO}/blob/main/SECURITY.md`, sub: 'Threat model' },
  { label: 'CHANGELOG', href: `${REPO}/blob/main/CHANGELOG.md`, sub: 'ประวัติเวอร์ชัน' },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <div className="relative min-h-screen overflow-x-hidden text-[var(--paper)]">
      {/* Background mesh */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(80% 60% at 20% 0%, rgba(94,193,255,0.18) 0%, transparent 60%),' +
            'radial-gradient(60% 50% at 90% 10%, rgba(255,200,87,0.10) 0%, transparent 55%),' +
            'radial-gradient(70% 60% at 50% 100%, rgba(94,193,255,0.10) 0%, transparent 60%),' +
            'linear-gradient(180deg, #0F1B2D 0%, #0B1322 100%)',
        }}
      />

      {/* Nav */}
      <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? 'py-2' : 'py-4'}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <nav
            className={`flex items-center justify-between rounded-full border px-3 py-2 transition-all duration-300 ${
              scrolled
                ? 'border-white/10 bg-[#0F1B2D]/75 backdrop-blur-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]'
                : 'border-transparent bg-transparent'
            }`}
          >
            <a href="#top" className="flex items-center gap-2 pl-2 font-semibold">
              <img src="/favicon.svg" alt="" className="h-7 w-7" />
              <span className="display text-lg tracking-tight">NotiKeeper</span>
            </a>
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="px-3 py-2 text-sm text-[var(--paper-2)] hover:text-white transition"
                >
                  {l.label}
                </a>
              ))}
              <a
                href={LATEST_APK}
                className="ml-2 inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
              >
                <Download className="h-4 w-4" />
                ดาวน์โหลด APK
              </a>
            </div>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
              aria-label="menu"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile menu */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-[#0F1B2D]/80 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
        <div
          className={`absolute right-0 top-0 bottom-0 w-[85%] max-w-sm bg-[#0F1B2D] border-l border-white/10 px-6 pt-24 pb-8 transition-transform duration-500 ${
            menuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex flex-col gap-1">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-white/5 py-4 text-xl font-semibold"
              >
                {l.label}
              </a>
            ))}
            <a
              href={LATEST_APK}
              onClick={() => setMenuOpen(false)}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[var(--sky)] px-5 py-3 text-sm font-semibold text-[var(--ink)]"
            >
              <Download className="h-4 w-4" />
              ดาวน์โหลด APK
            </a>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section id="top" className="relative pt-32 sm:pt-40 pb-20 sm:pb-32">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--paper-2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sky)] animate-pulse" />
            sideload-only · ส่วนตัว 100%
          </div>
          <h1 className="display mt-6 text-4xl sm:text-6xl md:text-7xl font-bold leading-[1.05]">
            เก็บแจ้งเตือน <span className="text-[var(--sky)]">และแชตที่หาย</span>
            <br className="hidden sm:block" /> ไว้ในเครื่องของคุณ
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-[var(--paper-2)] leading-relaxed">
            แอป Android ที่ดักจับการแจ้งเตือนทุกแอป และอ่านบทสนทนา Messenger / LINE / IG / WhatsApp / Telegram บนหน้าจอ
            เก็บลงฐานข้อมูล <span className="text-[var(--gold)] font-semibold">เข้ารหัส AES-256</span> ล็อกด้วยลายนิ้วมือ
            ค้นย้อนหลังได้ <span className="text-white font-semibold">ไม่จำกัดเวลา</span>
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href={LATEST_APK}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-6 py-3.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
            >
              <Smartphone className="h-4 w-4" />
              Android — ดาวน์โหลด APK
            </a>
            <a
              href="#download"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold hover:bg-white/10 transition"
            >
              <Apple className="h-4 w-4" />
              iOS — companion viewer
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold hover:bg-white/10 transition"
            >
              <GitFork className="h-4 w-4" />
              GitHub
            </a>
          </div>

          {/* Phone mock */}
          <div className="relative mx-auto mt-16 max-w-md">
            <div className="absolute -inset-12 -z-10 rounded-[40px] bg-[var(--sky)]/10 blur-3xl" />
            <div className="rounded-[36px] border border-white/10 bg-[var(--ink-2)] p-6 shadow-2xl">
              <div className="flex items-center justify-between text-xs text-[var(--paper-2)]">
                <span>NotiKeeper</span>
                <span>1.6</span>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-[var(--paper-2)]">
                <Search className="h-4 w-4 text-[var(--sky)]" />
                ค้นหา ชื่อแอป / ผู้ส่ง / ข้อความ
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { app: 'LINE', tag: 'หน้าจอ · เขา', text: 'พรุ่งนี้เจอกัน 10 โมงนะ', t: '08:42' },
                  { app: 'Messenger', tag: 'แจ้งเตือน', text: 'ส่งที่อยู่ให้แล้วนะ', t: '08:15' },
                  { app: 'WhatsApp', tag: 'หน้าจอ · ฉัน', text: 'ok thanks!', t: '07:50' },
                ].map((r) => (
                  <div key={r.t} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">{r.app} · {r.tag}</span>
                      <span className="text-[var(--muted)]">{r.t}</span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--paper-2)]">{r.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">ฟีเจอร์หลัก</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
              ครบเครื่องในแอปเดียว
            </h2>
            <p className="mt-4 text-[var(--paper-2)]">
              ครอบคลุมตั้งแต่ดักจับ → เก็บเข้ารหัส → ค้นหา → อ่านออกเสียง → สำรอง → เชื่อม AI
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.06] hover:border-[var(--sky)]/40 transition"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--sky)]/15 text-[var(--sky)]">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--paper-2)]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--gold)]">ความปลอดภัย</p>
              <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
                ข้อมูลของคุณ <br /> อยู่ในเครื่องคุณ
              </h2>
              <p className="mt-4 text-[var(--paper-2)] max-w-lg">
                ไม่มี cloud ปริยาย, ไม่มี telemetry, ไม่มีโฆษณา การส่งออกข้อมูลเกิดขึ้นเฉพาะตอนคุณกดเองเท่านั้น
                และยังเข้ารหัสเป็นชั้น ๆ เผื่อเครื่องหลุดมือ
              </p>
              <a
                href={`${REPO}/blob/main/SECURITY.md`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--sky)] hover:text-white"
              >
                อ่าน threat model เต็ม <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="space-y-3">
              {securityLayers.map((s) => (
                <div
                  key={s.title}
                  className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gold)]/15 text-[var(--gold)]">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{s.title}</h3>
                    <p className="mt-1 text-sm text-[var(--paper-2)]">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Download */}
      <section id="download" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">ดาวน์โหลด</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
              เลือกแพลตฟอร์มของคุณ
            </h2>
            <p className="mt-4 text-[var(--paper-2)]">
              Android เป็นตัวหลักที่ทำ capture ได้เต็มที่ — iOS เป็น companion สำหรับ
              เปิดดู / ค้นหา / อ่านออกเสียงไฟล์ archive ที่ export ออกมาจาก Android
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {/* Android card */}
            <div className="relative overflow-hidden rounded-2xl border border-[var(--sky)]/30 bg-gradient-to-br from-[var(--sky)]/10 to-transparent p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sky)]/20 text-[var(--sky)]">
                  <Smartphone className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-[var(--sky)]/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sky)]">
                  พร้อมใช้งาน · v1.6
                </span>
              </div>
              <h3 className="display mt-5 text-2xl font-bold text-white">Android</h3>
              <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">
                ดักจับแจ้งเตือนทุกแอป + อ่านบทสนทนาบนจอ Messenger / LINE / IG / WhatsApp / Telegram
                เก็บลง DB เข้ารหัสในเครื่อง + อ่านออกเสียงสำหรับคนขับรถ
              </p>
              <ul className="mt-4 space-y-1.5 text-xs text-[var(--paper-2)]">
                <li>• Android 11 ขึ้นไป (API 30+)</li>
                <li>• APK ลงนาม debug · ขนาด ~38 MB</li>
                <li>• อัปเดตในตัวผ่าน GitHub Releases</li>
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={LATEST_APK}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
                >
                  <Download className="h-4 w-4" /> ดาวน์โหลด APK
                </a>
                <a
                  href={`${REPO}/releases`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 transition"
                >
                  Releases ทั้งหมด
                </a>
              </div>
            </div>

            {/* iOS card */}
            <div className="relative overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-gradient-to-br from-[var(--gold)]/10 to-transparent p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--gold)]/20 text-[var(--gold)]">
                  <Apple className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-[var(--gold)]/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]">
                  Source · build เอง
                </span>
              </div>
              <h3 className="display mt-5 text-2xl font-bold text-white">iOS (Companion)</h3>
              <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">
                iOS sandbox ไม่อนุญาตการ capture noti/หน้าจอข้ามแอปแบบ Android — แอป iOS จึงเป็นตัว
                <span className="text-white font-semibold"> เปิดดู</span> archive ที่ export มาจาก Android
                (JSON / CSV / JSONL) ค้นหา + อ่านออกเสียง + ล็อกด้วย Face ID
              </p>
              <ul className="mt-4 space-y-1.5 text-xs text-[var(--paper-2)]">
                <li>• iOS 16 ขึ้นไป, SwiftUI</li>
                <li>• ต้อง build ด้วย Xcode 15+ บน macOS</li>
                <li>• ยังไม่มี TestFlight / App Store (sideload-only)</li>
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={IOS_SRC}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[#ffd887] transition"
                >
                  <Apple className="h-4 w-4" /> เปิดซอร์ส iOS
                </a>
                <a
                  href={`${REPO}/blob/main/ios/NotiKeeperIOS/README.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 transition"
                >
                  วิธี build
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">ติดตั้ง</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
              3 ขั้น เริ่มใช้ได้เลย
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {installSteps.map((s) => (
              <div
                key={s.n}
                className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6"
              >
                <span className="display absolute right-5 top-4 text-5xl font-bold text-white/5">
                  {s.n}
                </span>
                <h3 className="text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-[var(--sky)]/20 bg-gradient-to-br from-[var(--sky)]/10 to-transparent p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-6 w-6 text-[var(--sky)]" />
                <div>
                  <h3 className="font-semibold text-white">URL สำหรับช่อง "ตรวจอัปเดต"</h3>
                  <p className="mt-1 text-sm text-[var(--paper-2)]">วางในแอป → หน้า "สำรอง" → ครั้งเดียวจบ</p>
                </div>
              </div>
              <code className="break-all rounded-lg border border-white/10 bg-[var(--ink)] px-3 py-2 text-xs text-[var(--sky-soft)] font-mono">
                {VERSION_URL}
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* Docs */}
      <section id="docs" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">เอกสาร</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
              อ่านลึกได้ใน repo
            </h2>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((d) => (
              <a
                key={d.label}
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 hover:border-[var(--sky)]/40 hover:bg-white/[0.06] transition"
              >
                <div>
                  <div className="font-mono text-sm font-semibold text-white">{d.label}</div>
                  <div className="mt-0.5 text-xs text-[var(--paper-2)]">{d.sub}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--muted)] group-hover:text-[var(--sky)] transition" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <span className="display font-semibold">NotiKeeper</span>
              <span className="text-xs text-[var(--muted)]">v1.6 · MIT</span>
            </div>
            <div className="flex items-center gap-5 text-sm text-[var(--paper-2)]">
              <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-white transition">GitHub</a>
              <a href={`${REPO}/releases`} target="_blank" rel="noreferrer" className="hover:text-white transition">Releases</a>
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="hover:text-white transition">License</a>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-xs text-[var(--muted)] leading-relaxed">
            NotiKeeper ออกแบบมาให้เจ้าของอุปกรณ์ใช้กับข้อมูลของตัวเองเท่านั้น
            การใช้กับบัญชี/อุปกรณ์ของผู้อื่นโดยไม่ได้รับความยินยอม ไม่อยู่ในขอบเขตการใช้งานที่ตั้งใจ
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
