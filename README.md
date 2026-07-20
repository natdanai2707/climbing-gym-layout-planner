# Climbing Gym Layout Planner

Isometric 3D dollhouse-style planner for laying out a bouldering gym — drag rooms, climbing walls, zones and fixtures onto a snapping grid, SimCity-style.

**Live:** https://natdanai2707.github.io/climbing-gym-layout-planner/

## Features

- Configurable building footprint (default 20 × 60 m), grid cell 0.5 / 1 m, outdoor apron margin
- Palette of gym objects: climbing walls (multi-angle polygon profiles with holds), island boulder, landing mats, mezzanine + staircase, zones (Hyrox, training, co-working), rooms, reception, furniture, doors, parking, recovery fixtures
- Drop → adjust with 3D dimension arrows (W/D/H) → confirm placement; 45° rotation steps; items can overlap freely
- Mezzanine at 4.5 m: place objects beneath it or lift them onto the upper level
- Works on phones and tablets: touch tap-to-place, slide-in drawers for palette and inspector, floating rotate/edit/delete controls
- Drag-and-drop placement with grid snapping; move, rotate 90° (`R`), resize, delete (`Delete`)
- Placement rules: doors snap to the perimeter only, parking only in the outdoor apron, overlap warnings tinted red
- Isometric orthographic camera with orbit/pan/zoom + reset view
- Live stats: used/free floor area, per-category breakdown, parking count
- Auto-save to localStorage, JSON export/import, PNG screenshot export

## Keyboard

`R` rotate · `Delete`/`Backspace` remove · `Esc` cancel/deselect · `G` toggle grid · `L` toggle labels

## Development

```bash
npm install
npm run dev
```

## Deployment

Pushed to `main` → GitHub Actions builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). Vite `base` is set to `/climbing-gym-layout-planner/`.

## Stack

Vite · React · TypeScript · three.js (@react-three/fiber, @react-three/drei) · zustand
