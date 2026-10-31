"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ToastProvider, useToast } from "@/components/Toaster";
import { DialogProvider, useDialog } from "@/components/Dialog";
import { Credit } from "@/components/Credit";
import { Wordmark } from "@/components/Logo";
import { BrandedLoader } from "@/components/ui";
import {
  IconCheck, IconCopy, IconLock, IconLogout, IconPlus, IconRefresh, IconSearch, IconTrash, IconWhatsApp, IconX, IconAlert,
} from "@/components/Icons";

interface CodeRecord {
  code: string;
  name: string;
  label?: string;
  note?: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
  uses: number;
  lastUsedAt?: number | null;
  saved?: boolean;
  /** kept only in this browser (the server has no database yet) */
  local?: boolean;
}
interface AdminSessionRow { id: string; createdAt: number; expiresAt: number; ip?: string; device?: string; current: boolean }
interface Session { adminReady: boolean; secretReady: boolean; storage: "redis" | "file" | "none"; authed: boolean; sessions?: AdminSessionRow[]; revocable?: boolean; sessionHours?: number }
type Status = "active" | "expired" | "revoked";
type Filter = "all" | Status;

const VALIDITY = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 8760, label: "1 year" },
  { hours: 0, label: "Never" },
];

const dt = (ms: number) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);

function rel(ms: number, now: number): string {
  const d = ms - now;
  const a = Math.abs(d);
  const unit = a < 3_600_000 ? [Math.max(1, Math.round(a / 60_000)), "min"] : a < 172_800_000 ? [Math.round(a / 3_600_000), "h"] : [Math.round(a / 86_400_000), "days"];
  return d >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}

const statusOf = (c: CodeRecord, now: number): Status =>
  c.revokedAt ? "revoked" : c.expiresAt !== null && c.expiresAt <= now ? "expired" : "active";

const pretty = (n: string) => n.charAt(0) + n.slice(1).toLowerCase();
const who = (c: CodeRecord) => c.label || pretty(c.name);

function shareMessage(c: CodeRecord): string {
  const until = c.expiresAt === null ? "It never expires." : `It works until ${dt(c.expiresAt)}.`;
  return `Hi ${who(c).split(" ")[0]}! Here's your CapMitra watermark-free code:\n\n${c.code}\n\nOpen CapMitra → Export → Watermark, paste the code and press Unlock. ${until}`;
}

/** A phone number in the note? Then WhatsApp can open that chat directly. */
function waLink(c: CodeRecord): string {
  const digits = (c.note ?? "").replace(/[^\d]/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits.length >= 11 && digits.length <= 13 ? digits : "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(shareMessage(c))}`;
}

const LOCAL = "acg:adminCodes";
function readLocal(): CodeRecord[] {
  try { return (JSON.parse(localStorage.getItem(LOCAL) || "[]") as CodeRecord[]).map((c) => ({ ...c, local: true })); } catch { return []; }
}
function writeLocal(rows: CodeRecord[]): void {
  try { localStorage.setItem(LOCAL, JSON.stringify(rows.slice(0, 500))); } catch { /* storage full or blocked */ }
}

/** True when the field was filled in one go (paste or the browser's password manager), not typed. */
function filledAtOnce(e: React.ChangeEvent<HTMLInputElement>, before: string): boolean {
  const kind = (e.nativeEvent as InputEvent).inputType;
  return e.target.value.trim().length - before.length > 1 && kind !== "insertText" && kind !== "insertCompositionText";
}

export default function AdminPage() {
  return (
    <ToastProvider>
      <DialogProvider>
        <Admin />
      </DialogProvider>
    </ToastProvider>
  );
}

function Admin() {
  const { toast } = useToast();
  const dialog = useDialog();
  const [session, setSession] = useState<Session | null>(null);
  const [codes, setCodes] = useState<CodeRecord[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<CodeRecord | null>(null);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const refreshSession = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/admin/session", { cache: "no-store" })).json()) as Session;
      setSession(d);
    } catch {
      setSession({ adminReady: false, secretReady: false, storage: "none", authed: false });
    }
  }, []);

  useEffect(() => {
    const el = document.getElementById("splash");
    if (el) { el.classList.add("done"); setTimeout(() => el.remove(), 400); }
    void refreshSession();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/codes", { cache: "no-store" });
      const d = await r.json();
      if (r.status === 401) { setSession((s) => (s ? { ...s, authed: false } : s)); return; }
      if (!r.ok) throw new Error(d.error);
      setCodes(d.storage === "none" ? readLocal() : d.codes);
      setNow(d.now);
    } catch (e) {
      toast({ id: "admin-load", kind: "error", title: "Couldn't load the history", message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (session?.authed) void load(); }, [session?.authed, load]);

  const signInWith = async (pw: string) => {
    if (!pw || signingIn) return;
    setSigningIn(true);
    try {
      const r = await fetch("/api/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ id: "admin", kind: "error", title: "Couldn't sign in", message: d.error }); return; }
      setPassword("");
      await refreshSession();
      toast({ id: "admin", kind: "success", title: "Signed in", message: "Welcome back, Harsh." });
    } finally {
      setSigningIn(false);
    }
  };
  const signIn = (e: React.FormEvent) => { e.preventDefault(); void signInWith(password); };

  const signOut = async () => {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => {});
    setSession((s) => (s ? { ...s, authed: false } : s));
    setCodes([]);
    setFresh(null);
    toast({ kind: "info", title: "Signed out of admin" });
  };

  const endSession = async (id: string | "all") => {
    const r = await fetch(`/api/admin/session?${id === "all" ? "all=1" : `id=${encodeURIComponent(id)}`}`, { method: "DELETE" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    toast({ kind: "success", title: id === "all" ? "Other devices signed out" : "Device signed out", message: typeof d.revoked === "number" ? `${d.revoked} session${d.revoked === 1 ? "" : "s"} ended.` : undefined });
    await refreshSession();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const r = await fetch("/api/admin/codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, note, hours }) });
      const d = await r.json();
      if (r.status === 401) { setSession((s) => (s ? { ...s, authed: false } : s)); return; }
      if (!r.ok) { toast({ id: "admin", kind: "error", title: "Couldn't create the code", message: d.error }); return; }
      setFresh(d);
      setName("");
      setNote("");
      const row: CodeRecord = d.saved ? d : { ...d, local: true };
      if (!d.saved) writeLocal([row, ...readLocal().filter((c) => c.code !== row.code)]);
      setCodes((cs) => [row, ...cs.filter((c) => c.code !== row.code)]);
      toast({ id: "admin", kind: "success", title: `Code ready for ${who(d)}`, message: d.saved ? "Copy it or send it on WhatsApp. It's in your history." : "Copy it or send it on WhatsApp. Saved in this browser's history." });
    } finally {
      setCreating(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ id: "copy", kind: "success", title: `${what} copied`, duration: 1800 }); }
    catch { toast({ id: "copy", kind: "error", title: "Couldn't copy", message: "Select the text and copy it by hand." }); }
  };

  const needsDatabase = () => {
    toast({ id: "needdb", kind: "warning", title: "Revoking needs the free database", message: "Connect Upstash Redis in Vercel → Storage, then redeploy. Until then codes simply run until they expire.", action: { label: "Show steps", onClick: () => document.getElementById("db-setup")?.scrollIntoView({ behavior: "smooth", block: "center" }) } });
  };

  const setRevoked = async (c: CodeRecord, revoke: boolean) => {
    if (c.local) return needsDatabase();
    if (revoke) {
      const ok = await dialog.confirm({
        title: `Revoke ${who(c)}'s code?`,
        message: "It stops working straight away. Exports on their devices get the watermark again the next time they open the app or export.",
        confirmLabel: "Revoke code",
        danger: true,
      });
      if (!ok) return;
    }
    const r = await fetch("/api/admin/codes", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c.code, action: revoke ? "revoke" : "restore" }) });
    const d = await r.json();
    if (!r.ok) { toast({ kind: "error", title: "Couldn't update the code", message: d.error }); return; }
    setCodes((cs) => cs.map((x) => (x.code === c.code ? d : x)));
    toast({ kind: revoke ? "warning" : "success", title: revoke ? `${who(c)}'s code revoked` : `${who(c)}'s code restored` });
  };

  const remove = async (c: CodeRecord) => {
    if (c.local) {
      const ok = await dialog.confirm({ title: "Remove from this list?", message: `${c.code} disappears from this browser's history. The code itself keeps working until it expires.`, confirmLabel: "Remove", danger: true });
      if (!ok) return;
      writeLocal(readLocal().filter((x) => x.code !== c.code));
      setCodes((cs) => cs.filter((x) => x.code !== c.code));
      toast({ kind: "success", title: "Removed from this list", duration: 2000 });
      return;
    }
    const ok = await dialog.confirm({ title: "Delete from history?", message: `${c.code} will disappear from this list. It already doesn't work, so nothing else changes.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const r = await fetch(`/api/admin/codes?code=${encodeURIComponent(c.code)}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) { toast({ kind: "error", title: "Couldn't delete", message: d.error }); return; }
    setCodes((cs) => cs.filter((x) => x.code !== c.code));
    toast({ kind: "success", title: "Removed from history", duration: 2000 });
  };

  const reissue = (c: CodeRecord) => {
    setName(who(c));
    setNote(c.note ?? "");
    setFresh(null);
    document.getElementById("new-code")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast({ kind: "info", title: `Making a new code for ${who(c)}`, message: "Pick how long it should work, then press Create code." });
  };

  const stats = useMemo(() => {
    const s = { active: 0, expiring: 0, total: codes.length, uses: 0 };
    for (const c of codes) {
      const st = statusOf(c, now);
      if (st === "active") s.active++;
      if (st === "active" && c.expiresAt !== null && c.expiresAt - now < 86_400_000) s.expiring++;
      s.uses += c.uses || 0;
    }
    return s;
  }, [codes, now]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return codes.filter((c) => (filter === "all" || statusOf(c, now) === filter) && (!needle || `${c.name} ${c.label ?? ""} ${c.note ?? ""} ${c.code}`.toLowerCase().includes(needle)));
  }, [codes, q, filter, now]);

  if (!session) return <main className="adm-center"><BrandedLoader label="Opening admin…" /></main>;

  /* ---------- sign in ---------- */
  if (!session.authed) {
    return (
      <main className="adm-center">
        <form className="adm-signin" onSubmit={signIn}>
          <Wordmark />
          <div>
            <h1>Watermark <span className="grad">admin</span></h1>
            <p>Create, track and revoke the codes that remove the watermark from exports.</p>
          </div>
          {!session.adminReady ? (
            <SetupNote>
              Add <code>ADMIN_PASSWORD=your-password</code> to <code>.env.local</code> (or in Vercel → Settings → Environment Variables), then restart the app.
            </SetupNote>
          ) : (
            <>
              <label className="adm-field">
                <span>Admin password</span>
                <span className="adm-input"><IconLock size={15} /><input type="password" value={password} onChange={(e) => { const auto = filledAtOnce(e, password); setPassword(e.target.value); if (auto) void signInWith(e.target.value); }} autoFocus autoComplete="current-password" placeholder="Your admin password" /></span>
              </label>
              <button className="btn primary wide" disabled={!password || signingIn}>
                {signingIn ? <span className="spinner" aria-hidden="true" /> : null}
                {signingIn ? "Checking…" : "Sign in"}
              </button>
            </>
          )}
          <Credit />
        </form>
      </main>
    );
  }

  /* ---------- dashboard ---------- */
  return (
    <main className="adm">
      <header className="adm-top">
        <Wordmark />
        <span className="adm-chip">Admin</span>
        <div className="adm-top-right">
          <a className="btn small ghost" href="/">Open the editor</a>
          <button className="btn small ghost" onClick={() => void signOut()}><IconLogout size={15} /> Sign out</button>
        </div>
      </header>

      <div className="adm-body">
        <div className="adm-head">
          <h1>Watermark <span className="grad">codes</span></h1>
          <p>Everyone&apos;s exports carry the watermark. Make a personal code for anyone you approve, and switch it off any time.</p>
        </div>

        {!session.secretReady ? <SetupNote>Add <code>WATERMARK_SECRET</code> (a long random string, 16+ characters) to <code>.env.local</code> and restart, then you can create codes.</SetupNote> : null}
        {session.storage === "none" ? (
          <div className="adm-setup big" id="db-setup">
            <IconAlert size={18} />
            <div>
              <b>History is kept in this browser only, and codes can&apos;t be revoked yet.</b>
              <p>Vercel can&apos;t save files. Connect a free database once (about 2 minutes) to keep history everywhere and turn on Revoke:</p>
              <ol>
                <li>Vercel → your project → <b>Storage</b> → <b>Create Database</b> → <b>Upstash for Redis</b> → Free.</li>
                <li><b>Connect</b> it to <code>capmitra-app</code> (all environments).</li>
                <li><b>Deployments</b> → ⋯ → <b>Redeploy</b>. This warning disappears.</li>
              </ol>
            </div>
          </div>
        ) : null}

        <section className="adm-stats">
          <Stat label="Active" value={stats.active} tone="good" />
          <Stat label="Expire within 24 h" value={stats.expiring} tone="warn" />
          <Stat label="Codes issued" value={stats.total} />
          <Stat label="Times redeemed" value={stats.uses} />
        </section>

        <div className="adm-grid">
          <section className="adm-card" id="new-code">
            <h2><IconPlus size={17} /> New code</h2>
            <form onSubmit={create} className="adm-form">
              <label className="adm-field">
                <span>Name <em>shown in the app and on the code</em></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi Patel" maxLength={40} required />
              </label>
              <label className="adm-field">
                <span>Note <em>optional: phone, @instagram, reason</em></span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 98765 43210 · wedding reels" maxLength={120} />
              </label>
              <div className="adm-field">
                <span>Works for</span>
                <div className="adm-pills" role="radiogroup" aria-label="Works for">
                  {VALIDITY.map((v) => (
                    <button type="button" key={v.hours} role="radio" aria-checked={hours === v.hours} className={`adm-pill ${hours === v.hours ? "on" : ""}`} onClick={() => setHours(v.hours)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn primary wide" disabled={!name.trim() || creating || !session.secretReady}>
                {creating ? <span className="spinner" aria-hidden="true" /> : <IconPlus size={16} />}
                {creating ? "Creating…" : "Create code"}
              </button>
            </form>

            {fresh ? (
              <div className="adm-fresh">
                <div className="adm-fresh-top"><IconCheck size={16} /> Code for <b>{who(fresh)}</b> · {fresh.expiresAt === null ? "never expires" : `until ${dt(fresh.expiresAt)}`}</div>
                <button className="adm-code-big" onClick={() => void copy(fresh.code, "Code")} title="Copy code">{fresh.code}<IconCopy size={16} /></button>
                <div className="adm-actions">
                  <button className="btn small" onClick={() => void copy(fresh.code, "Code")}><IconCopy size={14} /> Copy code</button>
                  <button className="btn small" onClick={() => void copy(shareMessage(fresh), "Message")}><IconCopy size={14} /> Copy message</button>
                  <a className="btn small wa" href={waLink(fresh)} target="_blank" rel="noopener noreferrer"><IconWhatsApp size={14} /> Send on WhatsApp</a>
                </div>
              </div>
            ) : null}
          </section>

          <section className="adm-card adm-history">
            <div className="adm-history-head">
              <h2>History</h2>
              <button className="btn small ghost" onClick={() => void load()} disabled={loading}><IconRefresh size={14} /> Refresh</button>
            </div>
            <div className="adm-tools">
              <span className="adm-search"><IconSearch size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, note or code" /></span>
              <div className="adm-tabs" role="tablist">
                {(["all", "active", "expired", "revoked"] as Filter[]).map((f) => (
                  <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                    {f === "all" ? `All ${codes.length}` : `${f[0].toUpperCase()}${f.slice(1)} ${codes.filter((c) => statusOf(c, now) === f).length}`}
                  </button>
                ))}
              </div>
            </div>

            {loading && !codes.length ? <div className="adm-empty"><BrandedLoader label="Loading history…" /></div> : null}
            {!loading && !shown.length ? (
              <div className="adm-empty">{codes.length ? "Nothing matches." : "No codes yet. Create the first one on the left."}</div>
            ) : null}

            <ul className="adm-list">
              {shown.map((c) => {
                const st = statusOf(c, now);
                return (
                  <li key={c.code} className={`adm-row ${st}`}>
                    <div className="adm-row-main">
                      <div className="adm-who">
                        <span className="adm-avatar" aria-hidden="true">{c.name[0]}</span>
                        <div>
                          <strong>{who(c)}{c.local ? <span className="adm-local" title="Saved in this browser only">this browser</span> : null}</strong>
                          {c.note ? <span className="adm-note">{c.note}</span> : null}
                        </div>
                        <span className={`adm-status ${st}`}>{st === "active" ? "Active" : st === "expired" ? "Expired" : "Revoked"}</span>
                      </div>
                      <button className="adm-code" onClick={() => void copy(c.code, "Code")} title="Copy code">{c.code}<IconCopy size={13} /></button>
                      <dl className="adm-meta">
                        <div><dt>Created</dt><dd>{dt(c.createdAt)}</dd></div>
                        <div>
                          <dt>{st === "revoked" ? "Revoked" : st === "expired" ? "Expired" : "Expires"}</dt>
                          <dd>
                            {st === "revoked" && c.revokedAt ? dt(c.revokedAt)
                              : c.expiresAt === null ? "Never"
                              : <>{dt(c.expiresAt)} <span className="adm-rel">({rel(c.expiresAt, now)})</span></>}
                          </dd>
                        </div>
                        <div><dt>Used</dt><dd>{c.uses ? `${c.uses}× · last ${rel(c.lastUsedAt ?? c.createdAt, now)}` : "Not yet"}</dd></div>
                      </dl>
                    </div>
                    <div className="adm-row-actions">
                      {st === "active" ? (
                        <>
                          <a className="btn small ghost" href={waLink(c)} target="_blank" rel="noopener noreferrer" title="Send on WhatsApp"><IconWhatsApp size={14} /> Send</a>
                          <button className="btn small ghost danger" onClick={() => void setRevoked(c, true)}><IconX size={14} /> Revoke</button>
                        </>
                      ) : null}
                      {st === "revoked" && (c.expiresAt === null || c.expiresAt > now) ? (
                        <button className="btn small ghost" onClick={() => void setRevoked(c, false)}><IconRefresh size={14} /> Restore</button>
                      ) : null}
                      {st !== "active" ? (
                        <>
                          <button className="btn small ghost" onClick={() => reissue(c)}><IconPlus size={14} /> New code</button>
                          <button className="btn small ghost danger" onClick={() => void remove(c)} title="Delete from history"><IconTrash size={14} /></button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        {session.revocable && session.sessions?.length ? (
          <section className="adm-card adm-sessions" aria-labelledby="adm-sessions-h">
            <div className="adm-history-head">
              <h2 id="adm-sessions-h">Signed-in devices</h2>
              {session.sessions.length > 1 ? (
                <button className="btn small ghost danger" onClick={() => void endSession("all")}><IconLogout size={14} /> Sign out all others</button>
              ) : null}
            </div>
            <p className="adm-muted">Admin sign-ins end automatically after {session.sessionHours ?? 12} hours.</p>
            <ul className="adm-list">
              {session.sessions.map((s) => (
                <li key={s.id} className="adm-row">
                  <div className="adm-row-main">
                    <strong>{s.device ?? "Browser"}{s.current ? " · this device" : ""}</strong>
                    <span className="adm-muted">Signed in {rel(s.createdAt, now)}{s.ip ? ` from ${s.ip}` : ""} · ends {rel(s.expiresAt, now)}</span>
                  </div>
                  {!s.current ? <button className="btn small ghost" onClick={() => void endSession(s.id)}>Sign out</button> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Credit className="adm-credit" />
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className={`adm-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SetupNote({ children }: { children: React.ReactNode }) {
  return <div className="adm-setup"><IconAlert size={16} /><p>{children}</p></div>;
}
