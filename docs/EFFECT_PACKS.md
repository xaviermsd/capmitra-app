# Effect packs

The Effects panel shows items from *packs*. The built-in pack (`lib/effects/packs.ts`, `capmitra-core`)
has presets, effects, looks, transitions, text animations, generated music and sound effects.

All built-in sounds (`lib/effects/sfx.ts`) and music (`lib/effects/music.ts`) are synthesised by the
app, so they are free to use. Only add third-party audio you have a licence for.

## Adding a pack without code

Effects → Effect packs → Import pack, choose a `.json` file:

```json
{
  "id": "my-pack",
  "name": "My pack",
  "version": "1.0.0",
  "author": "Me",
  "license": "CC0",
  "items": [
    { "id": "punchy", "name": "Punchy beats", "icon": "🥊", "categories": ["reels"],
      "action": { "type": "beat-sync", "fx": "zoom-punch", "every": 2, "intensity": 0.9 } },
    { "id": "boom-look", "name": "Boom look", "categories": ["trending"],
      "action": { "type": "preset", "steps": [
        { "type": "music", "style": "trap" },
        { "type": "fx", "fx": "grade-noir", "whole": true },
        { "type": "transition", "kind": "glitch", "duration": 0.4, "sfx": "glitch" } ] } }
  ]
}
```

Categories: `trending`, `reels`, `cinematic`, `transitions`, `text`, `music`, `sfx`.
Actions: `fx`, `transition`, `sfx`, `music`, `text`, `beat-sync`, `keyword-sync`, `preset`
(see `EffectAction` in `lib/effects/packs.ts`; effect names in `lib/effects/fx.ts`).

## Adding a pack in code

Call `registerPack({...})` from a module imported by `components/editor/panels/EffectsPanel.tsx`.
New effect *types* need a case in `fxStateAt` (fx.ts) and drawing in `fxRender.ts`; they then work in
preview and export automatically.
