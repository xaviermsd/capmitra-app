"use client";
/**
 * "Check spelling" for the captions: suggestions from your dictionary, built-in
 * fixes and tidy-ups, each accepted or rejected. Accepting changes only the
 * words' text; timings and animations stay.
 */
import { useMemo, useState } from "react";
import { useEditor } from "../EditorContext";
import { Section, Toggle } from "@/components/Controls";
import { IconCheck, IconX } from "@/components/Icons";
import { applySuggestions, suggestCorrections, whyLabel, type Suggestion } from "@/lib/correct";
import { parseRules } from "@/lib/keywords";

export function CorrectionsSection() {
  const ed = useEditor();
  const { doc, project, settings, setSettings, toast } = ed;
  const [open, setOpen] = useState(false);
  const [punct, setPunct] = useState(false);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [newWrong, setNewWrong] = useState("");
  const [newRight, setNewRight] = useState("");
  const dictionary = useMemo(() => parseRules(settings.rules), [settings.rules]);

  const all = useMemo(() => (open ? suggestCorrections(doc.words, dictionary, { punctuation: punct }) : []), [open, doc.words, dictionary, punct]);
  const list = all.filter((s) => !rejected.has(`${s.id}:${s.from}`));

  const accept = (items: Suggestion[]) => {
    if (!items.length) return;
    project.update((d) => ({ ...d, words: applySuggestions(d.words, items) }));
    toast({ kind: "success", title: `${items.length} correction${items.length === 1 ? "" : "s"} applied`, action: { label: "Undo", onClick: () => ed.undo() }, duration: 4000 });
  };
  const reject = (s: Suggestion) => setRejected((r) => new Set(r).add(`${s.id}:${s.from}`));
  const addToDictionary = () => {
    const a = newWrong.trim(), b = newRight.trim();
    if (!a || !b) return;
    setSettings({ rules: `${settings.rules.trim() ? settings.rules.trim() + "\n" : ""}${a} = ${b}` });
    setNewWrong(""); setNewRight("");
    toast({ kind: "success", title: "Added to your dictionary", message: `${a} → ${b}. Used in every project.`, duration: 2500 });
  };
  const seek = (s: Suggestion) => {
    const w = doc.words[s.index];
    const out = ed.outWords.find((o) => o.id === w?.id || o.id.startsWith(`${w?.id}#`));
    if (out) ed.playback.seek(out.start);
  };

  return (
    <Section title="Check spelling" right={<button className={`btn small ${open ? "" : "primary"}`} onClick={() => { setOpen((o) => !o); setRejected(new Set()); }}>{open ? "Close" : "Check now"}</button>}>
      {!open ? (
        <p className="muted">Finds likely mistakes using your dictionary and common Gujarati, Hindi and Hinglish fixes. You accept or reject each one; timings stay as they are.</p>
      ) : (
        <>
          <Toggle label="Add full stops after long pauses" value={punct} onChange={setPunct} />
          {list.length ? (
            <>
              <div className="fix-head">
                <span>{list.length} suggestion{list.length === 1 ? "" : "s"}</span>
                <button className="btn small primary" onClick={() => accept(list)}>Accept all</button>
              </div>
              <ul className="fix-list">
                {list.map((s) => (
                  <li key={s.id} className="fix">
                    <button className="fix-text" onClick={() => seek(s)} title="Play from here">
                      <s>{s.from}</s><span aria-hidden="true">→</span><b>{s.to}</b>
                      <em>{whyLabel(s.why)}</em>
                    </button>
                    <button className="btn icon small fix-yes" onClick={() => accept([s])} aria-label={`Accept ${s.to}`}><IconCheck size={15} /></button>
                    <button className="btn icon small fix-no" onClick={() => reject(s)} aria-label="Reject"><IconX size={15} /></button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No suggestions. Add names, brands and slang to your dictionary below and check again.</p>
          )}
          <div className="dict-add">
            <span className="field-label">Add to your dictionary<em>names, brands, technical words, local slang; used in every project</em></span>
            <div className="dict-row">
              <input value={newWrong} onChange={(e) => setNewWrong(e.target.value)} placeholder="Heard as (e.g. cap mitra)" aria-label="Heard as" />
              <span aria-hidden="true">→</span>
              <input value={newRight} onChange={(e) => setNewRight(e.target.value)} placeholder="Write as (e.g. CapMitra)" aria-label="Write as" onKeyDown={(e) => { if (e.key === "Enter") addToDictionary(); }} />
              <button className="btn small" disabled={!newWrong.trim() || !newRight.trim()} onClick={addToDictionary}>Add</button>
            </div>
            {dictionary.length ? <p className="muted">{dictionary.length} entr{dictionary.length === 1 ? "y" : "ies"} in your dictionary (Settings → Your word list).</p> : null}
          </div>
        </>
      )}
    </Section>
  );
}
