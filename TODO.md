# TODO — Bug fixes and improvements

## Observed during pizza-order-process session (March 2026, continued)

Issues surfaced: Z-shaped / non-orthogonal gateway flows; unnecessary extra
padding in generated PNGs.

### Z-shaped / non-orthogonal flows

- [x] **`src/rebuild/waypoints.ts` — `assignLShapeWaypoints` same-Y case emits a diagonal path** (c9f9293)
  When `abs(sourceMidY - targetMidY) ≤ SAME_Y_TOLERANCE`, both endpoints are
  written at their own element's Y (e.g. 200 and 205), producing a diagonal
  "straight" line instead of a truly horizontal segment. Fix: snap both
  endpoints to a shared Y (e.g. `Math.round((sourceMidY + targetMidY) / 2)`)
  so the resulting 2-waypoint path is provably orthogonal.

- [x] **`src/rebuild/waypoints.ts` — `SAME_Y_TOLERANCE` too small for grid-snapped layouts** (c9f9293)
  `gridSnap: 10` creates a systematic 5 px centre-Y mismatch between gateways
  (50 px tall → centre 25 px from top) and adjacent tasks (80 px tall → centre
  40 px from top) when both are snapped to a common top-left grid. The current
  `SAME_Y_TOLERANCE = 5` sits exactly at this boundary; raise it to ≥ 10 px to
  absorb grid-snap-induced drift.

- [x] **`src/handlers/layout/layout-diagram.ts` — `straightenFlows` defaults to `false`, so the
  post-layout straightening pass never runs automatically** (c9f9293)
  `applyPostLayoutStraighten` is gated on `args.straightenFlows`, which is
  `false` unless the caller explicitly sets it. AI callers following the prompt
  never add this flag, so Z-shaped flows are never fixed. Options:
  (a) default `straightenFlows` to `true`; (b) always run the pass after
  `applyPixelGridSnap`; (c) rename to `skipStraighten` so the default is
  "always straighten".

- [x] **`src/handlers/layout/layout-diagram.ts` — post-layout straightening must run AFTER
  `applyPixelGridSnap`** (c9f9293 — verified ordering correct; syncXml already called after straightening)

- [x] **`src/handlers/layout/layout-diagram-schema.ts` — `straightenFlows` description should
  reflect the new default and remove opt-in language** (c9f9293)
  The schema already documents the flag but marks its default as `false`. Update
  description to reflect always-on behaviour so AI callers do not think they
  must set it manually.

- [x] **`src/prompts.ts` — layout workflow step does not mention `straightenFlows: true` as
  the remedy for orthogonality below 90 %** (c9f9293 — updated to note automatic straightening)

- [x] **`src/rebuild/waypoints.ts` — `applyGatewayFanoutReset` skips small vertical offsets
  that ManhattanLayout then routes as Z-shapes** (c9f9293 — added explicit shared-Y path in resetStaleWaypoints)

### SVG / PNG extra padding

- [x] **`src/svg-to-png.ts` — `cropSvgToViewBox` removes origin dead-space but not bpmn-js
  internal diagram margin** (c9f9293 — added tightenSvgViewBox + computeElementBounds)

- [x] **`src/linter.ts` — inline SVG image content carries the same excess padding** (c9f9293 — wired tightenSvgViewBox in appendImageContent)

- [x] **`src/handlers/core/export.ts` — exported standalone SVGs also carry excess padding** (c9f9293 — already addressed by existing adjustSvgViewBox; confirmed tight bounds via element registry with 5px padding)
