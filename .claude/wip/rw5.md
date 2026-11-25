# rw5 progress

Done (checkpoint 1): ops input host, prim, input.fth; worker types (protocol 2, BakeInput, StepOutputInfo,
StepReport.out/implicit, dataInfo), inputs.ts (rules), protocol/port/client/core wiring, render.outputInfo.

To do: update existing tests for protocol 2; new tests (CR242-246, 262, 266, protocol:1 init, input:tab);
input.test.json vector; e2e count 468 -> 469 in apps/web/e2e/reference.spec.ts; apps/web bake protocol check;
RECIPES-1.2 section 18 Done note; run the seven checks + gate2:browser; final amend (no WIP, delete this note).

Notes: ExtKind.schema is not in @forge/lang yet: outputInfo reads `schema` structurally, falling back to
`view({maxRows:0}).columns` (so the table kind works). RW3 not merged: compiler has no slots/implicit, so CR242
(lane join) and CR266 (implicit) are tested at the unit level only.
