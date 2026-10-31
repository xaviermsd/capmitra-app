"use client";
import type { PanelId } from "../EditorContext";
import { TemplatesPanelView, StylePanelView, MotionPanelView, FramePanelView } from "./LookPanels";
import { TextPanel } from "./TextPanel";
import { CaptionsPanel } from "./CaptionsPanel";
import { LanguagePanel } from "./LanguagePanel";
import { GraphicsPanel } from "./GraphicsPanel";
import { EditPanel } from "./EditPanel";
import { AudioPanel } from "./AudioPanel";
import { BrandPanel } from "./BrandPanel";
import { ExportPanel } from "./ExportPanel";
import { SettingsPanel } from "./SettingsPanel";
import { EffectsPanel } from "./EffectsPanel";
import { TranscriptPanel } from "./TranscriptPanel";
import { ShortsPanel } from "./ShortsPanel";

export function PanelHost({ id }: { id: PanelId }) {
  switch (id) {
    case "effects": return <EffectsPanel />;
    case "templates": return <TemplatesPanelView />;
    case "text": return <TextPanel />;
    case "style": return <StylePanelView />;
    case "motion": return <MotionPanelView />;
    case "captions": return <CaptionsPanel />;
    case "transcript": return <TranscriptPanel />;
    case "shorts": return <ShortsPanel />;
    case "language": return <LanguagePanel />;
    case "graphics": return <GraphicsPanel />;
    case "edit": return <EditPanel />;
    case "audio": return <AudioPanel />;
    case "frame": return <FramePanelView />;
    case "brand": return <BrandPanel />;
    case "export": return <ExportPanel />;
    case "settings": return <SettingsPanel />;
  }
}
