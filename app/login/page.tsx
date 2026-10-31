"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { IconLock } from "@/components/Icons";
import { ToastProvider, useToast } from "@/components/Toaster";
import { BrandedLoader } from "@/components/ui";
import { Credit } from "@/components/Credit";

/** True when the field was filled in one go (paste or the browser's password manager), not typed. */
function filledAtOnce(e: React.ChangeEvent<HTMLInputElement>, before: string): boolean {
  const kind = (e.nativeEvent as InputEvent).inputType;
  return e.target.value.trim().length - before.length > 1 && kind !== "insertText" && kind !== "insertCompositionText";
}

export default function LoginPage() {
  return (
    <ToastProvider>
      <Login />
    </ToastProvider>
  );
}

function Login() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [shake, setShake] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const el = document.getElementById("splash");
    if (el) {
      el.classList.add("done");
      setTimeout(() => el.remove(), 500);
    }
    void fetch("/api/login").then((r) => r.json()).then((d: { locked?: boolean }) => {
      if (d.locked === false) window.location.replace("/");
    }).catch(() => {});
  }, []);

  const submit = async (value: string) => {
    if (!value || busy || unlocked || Date.now() < blockedUntil) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: value }) });
      if (res.ok) {
        setUnlocked(true);
        toast({ id: "login", kind: "success", title: "Unlocked", message: "Welcome to CapMitra. Opening your studio…" });
        try { sessionStorage.setItem("acg:justUnlocked", "1"); } catch { /* ignore */ }
        setTimeout(() => window.location.replace("/"), 900);
        return;
      }
      const d = await res.json().catch(() => ({}));
      let msg: string = d.error ?? "That passcode isn't right.";
      if (res.status === 429) {
        setBlockedUntil(Date.now() + (Number(d.retryAfter) || 900) * 1000);
        toast({ id: "login", kind: "warning", title: "Too many attempts", message: msg });
      } else {
        if (typeof d.remaining === "number" && d.remaining <= 3) msg += ` ${d.remaining} attempt${d.remaining === 1 ? "" : "s"} left before a short lock.`;
        toast({ id: "login", kind: "error", title: "Wrong passcode", message: "Check the code and try again." });
      }
      setErr(msg);
      setShake((n) => n + 1);
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch {
      setErr("Couldn't reach the server. Check your internet connection.");
      toast({ id: "login", kind: "error", title: "Couldn't unlock", message: "No connection to the server. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <LoginBackdrop />
      <form
        key={shake}
        className={`login-card ${shake ? "shake" : ""}`}
        onSubmit={(e) => { e.preventDefault(); void submit(code); }}
        aria-busy={busy || unlocked}
      >
        {unlocked ? (
          <BrandedLoader label="Opening your studio…" />
        ) : (
          <>
            <img src="/brand/icon-192.png" alt="" width={72} height={72} className="login-mark" />
            <h1 className="login-title">CapMitra <span className="wm-badge-edit">EDIT</span></h1>
            <p className="login-tag">Captions. Audio. Video Editing.</p>
            <p>Enter your team passcode to open the studio.</p>
            <label className={`login-field ${err ? "invalid" : ""}`}>
              <IconLock size={16} />
              <input
                ref={inputRef}
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder="Passcode"
                aria-label="Passcode"
                aria-invalid={!!err}
                aria-describedby={err ? "login-err" : undefined}
                value={code}
                disabled={busy}
                onChange={(e) => { const v = e.target.value.trim(); const auto = filledAtOnce(e, code); setCode(v); setErr(""); if (auto) void submit(v); }}
              />
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
            </label>
            {err ? <p className="login-err" id="login-err" role="alert">{err}</p> : null}
            <button className="btn primary wide" disabled={!code || busy}>{busy ? "Checking…" : "Unlock studio"}</button>
          </>
        )}
        <Credit className="on-light" />
      </form>
    </main>
  );
}

/** Decorative brand graphics behind the sign-in card: lime shapes, a caption bubble, a sound wave and timeline clips. */
function LoginBackdrop() {
  const bars = [18, 34, 52, 30, 64, 44, 26, 58, 38, 22, 48, 70, 40, 28, 54, 36, 20, 46, 62, 32, 24, 50, 42, 30];
  return (
    <>
    <svg className="login-bg login-bg-wide" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="lb-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#080808" opacity=".09" /></pattern>
      </defs>
      <rect width="1440" height="900" fill="url(#lb-dots)" />

      {/* lime slab, top left */}
      <g className="lb lb-1"><g className="lb-float">
        <rect x="-60" y="96" width="360" height="200" rx="40" transform="rotate(-8 120 196)" fill="#080808" />
        <rect x="-74" y="82" width="360" height="200" rx="40" transform="rotate(-8 106 182)" fill="#D6FF36" stroke="#080808" strokeWidth="4" />
        <rect x="40" y="150" width="150" height="16" rx="8" transform="rotate(-8 106 182)" fill="#080808" />
        <rect x="40" y="182" width="110" height="16" rx="8" transform="rotate(-8 106 182)" fill="#080808" />
      </g></g>

      {/* caption bubble, top right */}
      <g className="lb lb-2"><g className="lb-float lb-float-b">
        <rect x="1150" y="104" width="230" height="120" rx="30" fill="#080808" transform="translate(10 10)" />
        <rect x="1150" y="104" width="230" height="120" rx="30" fill="#FFFFFF" stroke="#080808" strokeWidth="4" />
        <path d="M1190 222 L1176 262 L1226 222 Z" fill="#FFFFFF" stroke="#080808" strokeWidth="4" strokeLinejoin="round" />
        <rect x="1180" y="140" width="130" height="16" rx="8" fill="#080808" />
        <rect x="1180" y="172" width="90" height="16" rx="8" fill="#D6FF36" stroke="#080808" strokeWidth="2" />
        <path d="M1330 146 v36 l28 -18 z" fill="#D6FF36" stroke="#080808" strokeWidth="3" strokeLinejoin="round" />
      </g></g>

      {/* play disc, right */}
      <g className="lb lb-3"><g className="lb-float">
        <circle cx="1290" cy="560" r="64" fill="#080808" transform="translate(8 8)" />
        <circle cx="1290" cy="560" r="64" fill="#D6FF36" stroke="#080808" strokeWidth="4" />
        <path d="M1272 530 v60 l48 -30 z" fill="#080808" />
      </g></g>

      {/* timeline strip, bottom left */}
      <g className="lb lb-4">
        <rect x="80" y="660" width="430" height="120" rx="22" fill="#FFFFFF" stroke="#080808" strokeWidth="3" />
        <rect x="104" y="684" width="120" height="30" rx="8" fill="#D6FF36" stroke="#080808" strokeWidth="2" />
        <rect x="232" y="684" width="90" height="30" rx="8" fill="#D6FF36" stroke="#080808" strokeWidth="2" />
        <rect x="330" y="684" width="150" height="30" rx="8" fill="#D6FF36" stroke="#080808" strokeWidth="2" />
        <rect x="104" y="726" width="200" height="30" rx="8" fill="#C9B8FF" stroke="#080808" strokeWidth="2" />
        <rect x="312" y="726" width="168" height="30" rx="8" fill="#FFA8A8" stroke="#080808" strokeWidth="2" />
        <rect x="270" y="672" width="3" height="96" fill="#080808" />
      </g>

      {/* sound wave, bottom */}
      <g className="lb lb-5"><g transform="translate(760 760)">
        {bars.map((h, i) => (
          <rect key={i} className="lb-bar" x={i * 22} y={-h / 2} width="10" height={h} rx="5" fill={i % 3 === 0 ? "#FFFFFF" : "#D6FF36"} stroke="#080808" strokeWidth="2" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
        ))}
      </g></g>
    </svg>
    <svg className="login-bg login-bg-phone" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="390" height="844" fill="url(#lb-dots-p)" />
      <defs><pattern id="lb-dots-p" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#080808" opacity=".09" /></pattern></defs>
      <g className="lb lb-1"><g className="lb-float">
        <rect x="-50" y="40" width="210" height="120" rx="28" transform="rotate(-8 55 100)" fill="#080808" />
        <rect x="-60" y="30" width="210" height="120" rx="28" transform="rotate(-8 45 90)" fill="#D6FF36" stroke="#080808" strokeWidth="3" />
        <rect x="16" y="76" width="96" height="12" rx="6" transform="rotate(-8 45 90)" fill="#080808" />
        <rect x="16" y="100" width="66" height="12" rx="6" transform="rotate(-8 45 90)" fill="#080808" />
      </g></g>
      <g className="lb lb-2"><g className="lb-float lb-float-b">
        <rect x="246" y="66" width="128" height="70" rx="20" fill="#080808" transform="translate(6 6)" />
        <rect x="246" y="66" width="128" height="70" rx="20" fill="#FFFFFF" stroke="#080808" strokeWidth="3" />
        <path d="M268 134 L260 158 L290 134 Z" fill="#FFFFFF" stroke="#080808" strokeWidth="3" strokeLinejoin="round" />
        <rect x="264" y="88" width="70" height="10" rx="5" fill="#080808" />
        <rect x="264" y="106" width="48" height="10" rx="5" fill="#D6FF36" stroke="#080808" strokeWidth="1.5" />
        <path d="M344 88 v24 l18 -12 z" fill="#D6FF36" stroke="#080808" strokeWidth="2" strokeLinejoin="round" />
      </g></g>
      <g className="lb lb-3"><g className="lb-float">
        <circle cx="330" cy="760" r="44" fill="#080808" transform="translate(6 6)" />
        <circle cx="330" cy="760" r="44" fill="#D6FF36" stroke="#080808" strokeWidth="3" />
        <path d="M318 740 v40 l32 -20 z" fill="#080808" />
      </g></g>
      <g className="lb lb-5"><g transform="translate(24 770)">
        {bars.slice(0, 11).map((h, i) => (
          <rect key={i} className="lb-bar" x={i * 20} y={-h / 2.4} width="9" height={h / 1.2} rx="4.5" fill={i % 3 === 0 ? "#FFFFFF" : "#D6FF36"} stroke="#080808" strokeWidth="2" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
        ))}
      </g></g>
    </svg>
    </>
  );
}
