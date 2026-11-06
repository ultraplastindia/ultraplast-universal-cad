# Coverage

See the in-app **Coverage** page (generated from `src/data/catalogue.ts`).

Implemented in v0.3 (21 families): roller chain sprocket, stepped round shaft, deep groove ball bearing, parallel key, plain washer, hex nut, bushing/sleeve/spacer, conveyor roller, hexagonal shaft, wear strip, angle guide rail, rectangular hollow section, hex bolt, socket cap screw, dowel pin, belt pulley, guide wheel, U-channel, round tube, adjustable leg, mounting plate. Everything else is pending.

To add a family: create `src/families/<name>/` (or add to `src/families/extra/`) with calculation, 2D views, a `geo()` description built from the primitives in `src/core/prims.ts` (the 3D model, STEP solid, projected views and assembly checks all derive from it), register it in `src/families/index.ts`, then map catalogue items in `src/data/catalogue.ts`. Add tests; the generic family test automatically checks every variant.
