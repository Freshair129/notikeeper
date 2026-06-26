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
  Languages,
} from 'lucide-react';

const REPO = 'https://github.com/Freshair129/notikeeper';
const LATEST_APK = `${REPO}/releases/latest/download/NotiKeeper.apk`;
const VERSION_URL = `${REPO}/releases/latest/download/version.json`;
const IOS_SRC = `${REPO}/tree/main/ios/NotiKeeperIOS`;
const IOS_README = `${REPO}/blob/main/ios/NotiKeeperIOS/README.md`;
const IOS_PRD = `${REPO}/blob/main/docs/PRD-NotiKeeper-iOS-Companion-v0.1.0b.md`;
const IOS_ACTION = `${REPO}/actions/workflows/ios-companion.yml`;

type Lang = 'en' | 'th';

const dict = {
  // ====== NAV ======
  nav: {
    features:  { en: 'Features',   th: 'ฟีเจอร์' },
    security:  { en: 'Security',   th: 'ความปลอดภัย' },
    download:  { en: 'Download',   th: 'ดาวน์โหลด' },
    install:   { en: 'Install',    th: 'ติดตั้ง' },
    docs:      { en: 'Docs',       th: 'เอกสาร' },
    cta:       { en: 'Download APK', th: 'ดาวน์โหลด APK' },
  },

  // ====== HERO ======
  hero: {
    badge:   { en: 'sideload-only · fully private', th: 'sideload-only · ส่วนตัว 100%' },
    titleA:  { en: 'Keep the notifications',         th: 'เก็บแจ้งเตือน' },
    titleB:  { en: ' & chats you\'d lose',           th: ' และแชตที่หาย' },
    titleC:  { en: ' on your own device.',           th: ' ไว้ในเครื่องของคุณ' },
    body: {
      en: 'An Android app that captures every notification and reads chat threads from Messenger / LINE / IG / WhatsApp / Telegram off the screen, into a',
      th: 'แอป Android ที่ดักจับการแจ้งเตือนทุกแอป และอ่านบทสนทนา Messenger / LINE / IG / WhatsApp / Telegram บนหน้าจอ เก็บลงฐานข้อมูล',
    },
    bodyHighlight: { en: 'AES-256 encrypted database', th: 'เข้ารหัส AES-256' },
    bodyTail: {
      en: ', locked behind biometrics — searchable',
      th: ' ล็อกด้วยลายนิ้วมือ ค้นย้อนหลังได้',
    },
    bodyTailHi: { en: 'as far back as you like.', th: 'ไม่จำกัดเวลา' },
    ctaApk: { en: 'Android — Download APK', th: 'Android — ดาวน์โหลด APK' },
    ctaIos: { en: 'iOS — companion viewer',  th: 'iOS — companion viewer' },
    ctaGh:  { en: 'GitHub',                  th: 'GitHub' },
    mockHint: { en: 'Search app / sender / message', th: 'ค้นหา ชื่อแอป / ผู้ส่ง / ข้อความ' },
    mockTagScreenThem: { en: 'screen · them', th: 'หน้าจอ · เขา' },
    mockTagNoti:       { en: 'notification',  th: 'แจ้งเตือน' },
    mockTagScreenMe:   { en: 'screen · me',   th: 'หน้าจอ · ฉัน' },
    mockMsg1: { en: 'See you tomorrow at 10', th: 'พรุ่งนี้เจอกัน 10 โมงนะ' },
    mockMsg2: { en: 'Address sent.',          th: 'ส่งที่อยู่ให้แล้วนะ' },
    mockMsg3: { en: 'ok thanks!',             th: 'ok thanks!' },
  },

  // ====== FEATURES ======
  features: {
    eyebrow: { en: 'Core features',      th: 'ฟีเจอร์หลัก' },
    title:   { en: 'Everything in one app', th: 'ครบเครื่องในแอปเดียว' },
    lead: {
      en: 'Capture → encrypt at rest → search → speak aloud → back up → connect to AI.',
      th: 'ครอบคลุมตั้งแต่ดักจับ → เก็บเข้ารหัส → ค้นหา → อ่านออกเสียง → สำรอง → เชื่อม AI',
    },
    items: [
      {
        icon: Bell,
        en: { title: 'Capture every notification', body: 'When a notification fires, the title + body are saved to the DB. Runs in the background — no overlay, no persistent icon.' },
        th: { title: 'เก็บแจ้งเตือนทุกแอป', body: 'ทันทีที่ noti เด้ง ระบบจะบันทึก title + เนื้อหาลง DB ทำงานเบื้องหลัง ไม่มี overlay ไม่มีไอคอนค้าง' },
      },
      {
        icon: Smartphone,
        en: { title: 'Read chats off the screen', body: 'Messenger / LINE / IG / WhatsApp / Telegram — scroll back over deleted messages and they get archived too.' },
        th: { title: 'อ่านบทสนทนาบนจอ', body: 'รองรับ Messenger / LINE / IG / WhatsApp / Telegram — เลื่อนอ่านแชตที่ลบไปแล้ว ก็เก็บเข้า DB ได้' },
      },
      {
        icon: Lock,
        en: { title: 'Encrypted at rest + app lock', body: 'SQLCipher AES-256, key in the Android Keystore, UI gated by fingerprint or PIN every time you open it.' },
        th: { title: 'เข้ารหัสทั้งไฟล์ + ล็อกแอป', body: 'SQLCipher AES-256, กุญแจอยู่ใน Android Keystore, UI ล็อกด้วยลายนิ้วมือ/PIN ทุกครั้งที่เปิด' },
      },
      {
        icon: Volume2,
        en: { title: 'Read aloud (riding mode)', body: 'TTS speaks notifications + on-screen text through your headset, with audio ducking — like a GPS prompt.' },
        th: { title: 'อ่านออกเสียง (สำหรับขับรถ)', body: 'TTS อ่านแจ้งเตือน + ข้อความบนจอผ่านหูฟัง พร้อมหรี่เพลงตอนพูดเหมือนเสียงนำทาง GPS' },
      },
      {
        icon: Download,
        en: { title: 'Backup + export', body: 'Share JSON/CSV to Drive / email / your PC, save to Downloads, or auto-upload to your own private API endpoint.' },
        th: { title: 'สำรอง + ส่งออก', body: 'แชร์ JSON/CSV เข้า Drive / อีเมล / คอม, บันทึกลง Downloads, หรืออัปโหลด API ส่วนตัวอัตโนมัติ' },
      },
      {
        icon: Cpu,
        en: { title: 'Wire it into Claude (MCP)', body: 'Built-in MCP server ingests the uploads and exposes search / recent / list / stats tools to Claude.' },
        th: { title: 'เชื่อม Claude / AI ผ่าน MCP', body: 'MCP server ในตัวรับอัปโหลดจากแอป + เปิด tools ให้ Claude ค้นข้อความ recent / search / stats' },
      },
    ],
  },

  // ====== SECURITY ======
  security: {
    eyebrow: { en: 'Security',           th: 'ความปลอดภัย' },
    titleA:  { en: 'Your data',          th: 'ข้อมูลของคุณ' },
    titleB:  { en: 'stays on your device.', th: 'อยู่ในเครื่องคุณ' },
    body: {
      en: 'No cloud by default. No telemetry. No ads. Data only leaves the device when you press a button. And what stays is encrypted in layers, in case the device is lost.',
      th: 'ไม่มี cloud ปริยาย, ไม่มี telemetry, ไม่มีโฆษณา การส่งออกข้อมูลเกิดขึ้นเฉพาะตอนคุณกดเองเท่านั้น และยังเข้ารหัสเป็นชั้น ๆ เผื่อเครื่องหลุดมือ',
    },
    threatLink: { en: 'Read the full threat model', th: 'อ่าน threat model เต็ม' },
    layers: [
      {
        icon: ShieldCheck,
        en: { title: 'At rest — SQLCipher AES-256', body: 'The entire noti.db file is encrypted. Even a forensic file-grab returns ciphertext.' },
        th: { title: 'At rest — SQLCipher AES-256', body: 'ไฟล์ noti.db ทั้งไฟล์ถูกเข้ารหัส ถ้าใครก๊อปไฟล์ออกไปก็อ่านไม่ออก' },
      },
      {
        icon: Lock,
        en: { title: 'Key — Android Keystore', body: '32-byte random passphrase in EncryptedSharedPreferences (hardware-backed master key). Never written as plaintext.' },
        th: { title: 'Key — Android Keystore', body: 'กุญแจ 32 ไบต์เก็บใน EncryptedSharedPreferences (master key hardware-backed) ไม่โผล่ plaintext' },
      },
      {
        icon: Smartphone,
        en: { title: 'UI — Biometric / PIN', body: 'BIOMETRIC_STRONG | DEVICE_CREDENTIAL. The app re-locks every time it goes to background.' },
        th: { title: 'UI — Biometric / PIN', body: 'BIOMETRIC_STRONG | DEVICE_CREDENTIAL ล็อกใหม่ทุกครั้งที่ออกจากแอป' },
      },
    ],
  },

  // ====== DOWNLOAD ======
  download: {
    eyebrow: { en: 'Download',          th: 'ดาวน์โหลด' },
    title:   { en: 'Pick your platform', th: 'เลือกแพลตฟอร์มของคุณ' },
    body: {
      en: 'Android is the full app with capture. iOS is a companion viewer — open / search / read aloud the archive you exported from Android.',
      th: 'Android เป็นตัวหลักที่ทำ capture ได้เต็มที่ — iOS เป็น companion สำหรับเปิดดู / ค้นหา / อ่านออกเสียงไฟล์ archive ที่ export ออกมาจาก Android',
    },
    android: {
      tag:   { en: 'available · v1.6',    th: 'พร้อมใช้งาน · v1.6' },
      title: { en: 'Android',              th: 'Android' },
      body: {
        en: 'Capture notifications across all apps + read Messenger / LINE / IG / WhatsApp / Telegram threads off the screen. Encrypted local DB + eyes-free read-aloud for riders.',
        th: 'ดักจับแจ้งเตือนทุกแอป + อ่านบทสนทนาบนจอ Messenger / LINE / IG / WhatsApp / Telegram เก็บลง DB เข้ารหัสในเครื่อง + อ่านออกเสียงสำหรับคนขับรถ',
      },
      reqs: {
        en: ['Android 11+ (API 30)', 'Debug-signed APK · ~38 MB', 'Self-update via GitHub Releases'],
        th: ['Android 11 ขึ้นไป (API 30+)', 'APK ลงนาม debug · ขนาด ~38 MB', 'อัปเดตในตัวผ่าน GitHub Releases'],
      },
      btnApk: { en: 'Download APK',      th: 'ดาวน์โหลด APK' },
      btnRel: { en: 'All releases',      th: 'Releases ทั้งหมด' },
    },
    ios: {
      tag:   { en: 'source · build yourself', th: 'Source · build เอง' },
      title: { en: 'iOS (Companion)',   th: 'iOS (Companion)' },
      body: {
        en: 'iOS sandboxing doesn\'t allow cross-app capture the way Android does — so the iOS app is a viewer: open archives exported from Android (JSON / CSV / JSONL), search, read aloud, Face-ID locked.',
        th: 'iOS sandbox ไม่อนุญาตการ capture noti/หน้าจอข้ามแอปแบบ Android — แอป iOS จึงเป็นตัวเปิดดู archive ที่ export มาจาก Android (JSON / CSV / JSONL) ค้นหา + อ่านออกเสียง + ล็อกด้วย Face ID',
      },
      reqs: {
        en: ['iOS 16+, SwiftUI', 'Build with Xcode 15+ on macOS', 'No TestFlight / App Store yet — sideload only'],
        th: ['iOS 16 ขึ้นไป, SwiftUI', 'ต้อง build ด้วย Xcode 15+ บน macOS', 'ยังไม่มี TestFlight / App Store (sideload-only)'],
      },
      btnSrc:   { en: 'Open iOS source', th: 'เปิดซอร์ส iOS' },
      btnBuild: { en: 'How to build',    th: 'วิธี build' },
      btnCi:    { en: 'macOS CI',         th: 'CI macOS' },
    },
  },

  // ====== INSTALL ======
  install: {
    eyebrow: { en: 'Install',          th: 'ติดตั้ง' },
    title:   { en: '3 steps and you\'re set', th: '3 ขั้น เริ่มใช้ได้เลย' },
    steps: [
      {
        n: '01',
        en: { title: 'Download the APK', body: 'Grab the latest from GitHub Releases and transfer it to your phone (USB / Drive / messenger).' },
        th: { title: 'ดาวน์โหลด APK', body: 'จาก GitHub Releases ล่าสุด แล้วโอนเข้ามือถือ (USB / Drive / LINE Keep)' },
      },
      {
        n: '02',
        en: { title: 'Install + grant permissions', body: 'Allow "Unknown sources" → open NotiKeeper → enable "Notification access" + "Accessibility".' },
        th: { title: 'ติดตั้ง + เปิดสิทธิ์', body: 'อนุญาต "แหล่งที่ไม่รู้จัก" → เปิด NotiKeeper → เปิดสิทธิ์ "แจ้งเตือน" + "Accessibility"' },
      },
      {
        n: '03',
        en: { title: 'Set update URL (once)', body: 'Open the "Backup" screen → paste the version.json URL — future updates are checked automatically.' },
        th: { title: 'ตั้ง URL อัปเดต (ทำครั้งเดียว)', body: 'หน้า "สำรอง" → ช่อง URL ใส่ลิงก์ version.json — ครั้งหน้าเช็คอัปเดตให้เอง' },
      },
    ],
    updateBoxTitle: { en: 'URL for the "Check for updates" field', th: 'URL สำหรับช่อง "ตรวจอัปเดต"' },
    updateBoxBody:  { en: 'Paste in the app → "Backup" screen → set once.', th: 'วางในแอป → หน้า "สำรอง" → ครั้งเดียวจบ' },
  },

  // ====== DOCS ======
  docs: {
    eyebrow: { en: 'Documentation', th: 'เอกสาร' },
    title:   { en: 'Dive deeper in the repo', th: 'อ่านลึกได้ใน repo' },
    items: [
      { label: 'README',       en: 'Usage + install',          th: 'วิธีใช้ + ติดตั้ง',         href: `${REPO}/blob/main/README.md` },
      { label: 'PRD',          en: 'Product Requirements',     th: 'Product Requirements',     href: `${REPO}/blob/main/docs/PRD-NotiKeeper-v1.0.md` },
      { label: 'BRD',          en: 'Business Requirements',    th: 'Business Requirements',    href: `${REPO}/blob/main/docs/BRD-NotiKeeper-v1.0.md` },
      { label: 'iOS PRD',      en: 'Companion scope',          th: 'ขอบเขต iOS companion',     href: IOS_PRD },
      { label: 'iOS README',   en: 'Build with Xcode',         th: 'วิธี build ด้วย Xcode',     href: IOS_README },
      { label: 'ARCHITECTURE', en: 'System overview',          th: 'โครงระบบ',                  href: `${REPO}/blob/main/ARCHITECTURE.md` },
      { label: 'SECURITY',     en: 'Threat model',             th: 'Threat model',             href: `${REPO}/blob/main/SECURITY.md` },
      { label: 'CHANGELOG',    en: 'Version history',          th: 'ประวัติเวอร์ชัน',           href: `${REPO}/blob/main/CHANGELOG.md` },
    ],
  },

  // ====== FOOTER ======
  footer: {
    note: {
      en: 'NotiKeeper is intended for the device owner to use with their own data. Use with someone else\'s account or device without their consent is outside the project\'s intended use.',
      th: 'NotiKeeper ออกแบบมาให้เจ้าของอุปกรณ์ใช้กับข้อมูลของตัวเองเท่านั้น การใช้กับบัญชี/อุปกรณ์ของผู้อื่นโดยไม่ได้รับความยินยอม ไม่อยู่ในขอบเขตการใช้งานที่ตั้งใจ',
    },
  },
};

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = window.localStorage.getItem('nk-lang') as Lang | null;
    return saved === 'th' || saved === 'en' ? saved : 'en';
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem('nk-lang', lang);
  }, [lang]);

  const t = (entry: { en: string; th: string }) => entry[lang];
  const toggleLang = () => setLang((p) => (p === 'en' ? 'th' : 'en'));

  const navItems = [
    { href: '#features', label: t(dict.nav.features) },
    { href: '#security', label: t(dict.nav.security) },
    { href: '#download', label: t(dict.nav.download) },
    { href: '#install',  label: t(dict.nav.install) },
    { href: '#docs',     label: t(dict.nav.docs) },
  ];

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
              {navItems.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="px-3 py-2 text-sm text-[var(--paper-2)] hover:text-white transition"
                >
                  {l.label}
                </a>
              ))}
              <button
                onClick={toggleLang}
                className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-[var(--paper)] hover:bg-white/10 transition"
                aria-label="toggle language"
              >
                <Languages className="h-3.5 w-3.5" />
                {lang === 'en' ? 'EN · TH' : 'TH · EN'}
              </button>
              <a
                href={LATEST_APK}
                className="ml-2 inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
              >
                <Download className="h-4 w-4" />
                {t(dict.nav.cta)}
              </a>
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <button
                onClick={toggleLang}
                className="inline-flex h-10 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold"
                aria-label="toggle language"
              >
                {lang.toUpperCase()}
              </button>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
                aria-label="menu"
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
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
            {navItems.map((l) => (
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
              {t(dict.nav.cta)}
            </a>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section id="top" className="relative pt-32 sm:pt-40 pb-20 sm:pb-32">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--paper-2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sky)] animate-pulse" />
            {t(dict.hero.badge)}
          </div>
          <h1 className="display mt-6 text-4xl sm:text-6xl md:text-7xl font-bold leading-[1.05]">
            {t(dict.hero.titleA)}
            <span className="text-[var(--sky)]">{t(dict.hero.titleB)}</span>
            <br className="hidden sm:block" />
            {t(dict.hero.titleC)}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-[var(--paper-2)] leading-relaxed">
            {t(dict.hero.body)} <span className="text-[var(--gold)] font-semibold">{t(dict.hero.bodyHighlight)}</span>
            {t(dict.hero.bodyTail)} <span className="text-white font-semibold">{t(dict.hero.bodyTailHi)}</span>
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href={LATEST_APK}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-6 py-3.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
            >
              <Smartphone className="h-4 w-4" />
              {t(dict.hero.ctaApk)}
            </a>
            <a
              href={IOS_SRC}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold hover:bg-white/10 transition"
            >
              <Apple className="h-4 w-4" />
              {t(dict.hero.ctaIos)}
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold hover:bg-white/10 transition"
            >
              <GitFork className="h-4 w-4" />
              {t(dict.hero.ctaGh)}
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
                {t(dict.hero.mockHint)}
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { app: 'LINE',      tag: t(dict.hero.mockTagScreenThem), text: t(dict.hero.mockMsg1), time: '08:42' },
                  { app: 'Messenger', tag: t(dict.hero.mockTagNoti),       text: t(dict.hero.mockMsg2), time: '08:15' },
                  { app: 'WhatsApp',  tag: t(dict.hero.mockTagScreenMe),   text: t(dict.hero.mockMsg3), time: '07:50' },
                ].map((r, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">{r.app} · {r.tag}</span>
                      <span className="text-[var(--muted)]">{r.time}</span>
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
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">{t(dict.features.eyebrow)}</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">{t(dict.features.title)}</h2>
            <p className="mt-4 text-[var(--paper-2)]">{t(dict.features.lead)}</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dict.features.items.map((f, i) => {
              const Icon = f.icon;
              const copy = f[lang];
              return (
                <div
                  key={i}
                  className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.06] hover:border-[var(--sky)]/40 transition"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--sky)]/15 text-[var(--sky)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">{copy.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--paper-2)]">{copy.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--gold)]">{t(dict.security.eyebrow)}</p>
              <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">
                {t(dict.security.titleA)} <br /> {t(dict.security.titleB)}
              </h2>
              <p className="mt-4 text-[var(--paper-2)] max-w-lg">{t(dict.security.body)}</p>
              <a
                href={`${REPO}/blob/main/SECURITY.md`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--sky)] hover:text-white"
              >
                {t(dict.security.threatLink)} <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="space-y-3">
              {dict.security.layers.map((s, i) => {
                const Icon = s.icon;
                const copy = s[lang];
                return (
                  <div
                    key={i}
                    className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gold)]/15 text-[var(--gold)]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{copy.title}</h3>
                      <p className="mt-1 text-sm text-[var(--paper-2)]">{copy.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Download */}
      <section id="download" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">{t(dict.download.eyebrow)}</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">{t(dict.download.title)}</h2>
            <p className="mt-4 text-[var(--paper-2)]">{t(dict.download.body)}</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {/* Android */}
            <div className="relative overflow-hidden rounded-2xl border border-[var(--sky)]/30 bg-gradient-to-br from-[var(--sky)]/10 to-transparent p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sky)]/20 text-[var(--sky)]">
                  <Smartphone className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-[var(--sky)]/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sky)]">
                  {t(dict.download.android.tag)}
                </span>
              </div>
              <h3 className="display mt-5 text-2xl font-bold text-white">{t(dict.download.android.title)}</h3>
              <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">{t(dict.download.android.body)}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-[var(--paper-2)]">
                {dict.download.android.reqs[lang].map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={LATEST_APK}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--sky)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--sky-soft)] transition"
                >
                  <Download className="h-4 w-4" /> {t(dict.download.android.btnApk)}
                </a>
                <a
                  href={`${REPO}/releases`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 transition"
                >
                  {t(dict.download.android.btnRel)}
                </a>
              </div>
            </div>

            {/* iOS */}
            <div className="relative overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-gradient-to-br from-[var(--gold)]/10 to-transparent p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--gold)]/20 text-[var(--gold)]">
                  <Apple className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-[var(--gold)]/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]">
                  {t(dict.download.ios.tag)}
                </span>
              </div>
              <h3 className="display mt-5 text-2xl font-bold text-white">{t(dict.download.ios.title)}</h3>
              <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">{t(dict.download.ios.body)}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-[var(--paper-2)]">
                {dict.download.ios.reqs[lang].map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={IOS_SRC}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[#ffd887] transition"
                >
                  <Apple className="h-4 w-4" /> {t(dict.download.ios.btnSrc)}
                </a>
                <a
                  href={IOS_README}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 transition"
                >
                  {t(dict.download.ios.btnBuild)}
                </a>
                <a
                  href={IOS_ACTION}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 transition"
                >
                  {t(dict.download.ios.btnCi)}
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
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">{t(dict.install.eyebrow)}</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">{t(dict.install.title)}</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {dict.install.steps.map((s, i) => {
              const copy = s[lang];
              return (
                <div
                  key={i}
                  className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6"
                >
                  <span className="display absolute right-5 top-4 text-5xl font-bold text-white/5">{s.n}</span>
                  <h3 className="text-lg font-semibold text-white">{copy.title}</h3>
                  <p className="mt-2 text-sm text-[var(--paper-2)] leading-relaxed">{copy.body}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-10 rounded-2xl border border-[var(--sky)]/20 bg-gradient-to-br from-[var(--sky)]/10 to-transparent p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-6 w-6 text-[var(--sky)]" />
                <div>
                  <h3 className="font-semibold text-white">{t(dict.install.updateBoxTitle)}</h3>
                  <p className="mt-1 text-sm text-[var(--paper-2)]">{t(dict.install.updateBoxBody)}</p>
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
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--sky)]">{t(dict.docs.eyebrow)}</p>
            <h2 className="display mt-2 text-3xl sm:text-5xl font-bold leading-tight">{t(dict.docs.title)}</h2>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dict.docs.items.map((d) => (
              <a
                key={d.label}
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 hover:border-[var(--sky)]/40 hover:bg-white/[0.06] transition"
              >
                <div>
                  <div className="font-mono text-sm font-semibold text-white">{d.label}</div>
                  <div className="mt-0.5 text-xs text-[var(--paper-2)]">{d[lang]}</div>
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
          <p className="mt-6 max-w-2xl text-xs text-[var(--muted)] leading-relaxed">{t(dict.footer.note)}</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
