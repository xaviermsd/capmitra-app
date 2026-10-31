"use client";

import { Color, Section, Select, Slider, Toggle } from "./Controls";
import { AspectGlyph } from "./Icons";
import { ASPECTS, PLATFORMS, describeShape, platformById } from "@/lib/frame";
import type { FrameSettings } from "@/lib/types";

export function FramePanel({
  frame, patch, srcW, srcH,
}: { frame: FrameSettings; patch: (p: Partial<FrameSettings>) => void; srcW: number; srcH: number }) {
  const shape = describeShape(srcW, srcH);
  const platform = platformById(frame.platform);
  const ratioOf = (id: string) => ASPECTS.find((a) => a.id === id)?.ratio ?? (srcW && srcH ? srcW / srcH : null);
  return (
    <>
      <Section title="Your video">
        <p className="shape-line">{shape ? shape : "Open a video to see its size and shape."}</p>
      </Section>

      <Section title="Where will you post it?">
        <div className="platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              className={`platform ${frame.platform === p.id ? "on" : ""}`}
              onClick={() => patch({ platform: p.id, aspect: p.aspect })}
            >
              <AspectGlyph ratio={ratioOf(p.aspect)} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Frame shape">
        <Select label="Aspect ratio" value={frame.aspect} options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))} onChange={(v) => patch({ aspect: v })} />
        <Select
          label="Fill the frame by"
          value={frame.fit}
          options={[
            { value: "crop", label: "Cropping (fill, no bars)" },
            { value: "blur", label: "Fitting with blurred background" },
            { value: "color", label: "Fitting with a colour background" },
          ]}
          onChange={(v) => patch({ fit: v })}
        />
        {frame.fit === "color" ? <Color label="Background colour" value={frame.bg} onChange={(v) => patch({ bg: v ?? "#000000" })} /> : null}
        <Slider label="Zoom" value={frame.zoom} min={1} max={3} step={0.01} unit="×" onChange={(v) => patch({ zoom: v })} />
        <Slider label="Move left / right" value={frame.panX} min={0} max={100} step={0.5} unit="%" onChange={(v) => patch({ panX: v })} />
        <Slider label="Move up / down" value={frame.panY} min={0} max={100} step={0.5} unit="%" onChange={(v) => patch({ panY: v })} />
        <div className="row-btns">
          <button className="btn small" onClick={() => patch({ panX: 50, panY: 50, zoom: 1 })}>Re-centre</button>
        </div>
      </Section>

      <Section title="Safe zone">
        <Toggle
          label="Show safe-zone guide"
          value={frame.showSafeZone}
          onChange={(v) => patch({ showSafeZone: v })}
          hint={platform.safe ? `${platform.label}: shaded areas are covered by app buttons` : "Pick a Reel, Story, Shorts or TikTok preset"}
        />
        <p className="muted">The guide only shows in the editor, never in the exported video. Margins are approximate and change when the apps update.</p>
      </Section>
    </>
  );
}
