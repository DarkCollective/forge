# Relix in the recipe pane: lanes and slots, design, v1

Status: draft v1 (2026-11-22), brought into line with the Gate T1 decisions on 2026-11-23. This file is the **design rationale** for lanes and slots in the recipe pane: the model, the gestures, the three views and the alternatives. [RECIPES-1.2.md](RECIPES-1.2.md) and [RELIX.md](RELIX.md) are **normative for the details**: the recipe JSON, the validator rules and issue codes, the compiled form and the text form (RECIPES-1.2), and the names, effects and parameters of the Relix words (RELIX.md). Where this file differs from them, they win. Open questions that the owner has decided are marked *decided* in §12.2. It builds on [PLAN.md](PLAN.md) (§1 principles, §4 UI, §7–8 phases and orchestration), [TOOLKIT.md](TOOLKIT.md) (§2.3 recipe shape, §8 the Relix pack, §13 phases and gates), [UI.md](UI.md) (§2.3 recipe pane and fit levels, §3 shared contracts, §4 CSP) and [RECIPES.md](RECIPES.md) (§3 recipe JSON v1 and v1.1, §3.7 issues, Appendix A). It elaborates TOOLKIT §8.2, "Recipes and drag and drop". The editing model was worked out in an interactive mock-up (a single HTML page with no engine behind it). Where this document says "the prototype", it means that mock-up. The prototype is the reference for behaviour. This document is the reference for the proposal.

> **Packages are frozen.** `packages/*` hold frozen Phase 1–2 contracts (CLAUDE.md). The recipe format change in §9 (`@forge/recipe`) and the named-inputs bake protocol change (`@forge/worker`, TOOLKIT X5) had the explicit owner-approved version bump at Gate T1 (approved on 2026-11-23 as v1.2, RECIPES-1.2.md; TOOLKIT §13.3). Everything else here is `apps/web` work, and `apps/web` is not frozen. The gate has passed, so the work starts by the packages of §11.

> **Estimates are marked.** Sizes in §11 are relative (S, M, L) and are estimates. There are no calendar dates. Names of files and work packages are proposals; the brief for each package fixes them.

## Contents

1. Goal and scope
2. The model: lanes, slots and the pipe rule
3. Swap sides and Main line
4. Gestures and drop rules
5. Three views of one model
6. Types and the traffic light
7. Keyboard, touch and announcements
8. Paths, issues and timings
9. Recipe JSON for slots
10. Alternatives considered
11. Dependencies, phasing and work packages
12. Decisions and open questions

---

## 1. Goal and scope

TOOLKIT §8.2 says that a binary Relix operator is a recipe step with a relation-valued parameter, shown as a nested lane. This document answers the questions that sentence leaves open. A join has two inputs. One of them is the data that already flows down the recipe. Which one is it? How does the user change that? How does a user who thinks in tables, not in pipelines, add a second table without learning a new editor?

**Goals.**

- A recipe stays a linear lane of steps. Unary steps are unchanged, so a byte or text recipe looks exactly as it does today.
- A binary relational operator is one more step on that lane. Its second input is a nested lane, which reuses the nested-block UI of `fork` and `subsection`.
- One rule says where the data from above goes. The user can move it to the other side with one gesture, and the UI says what that did to the result.
- Every gesture has a keyboard and a touch route (UI.md §2.3). Drag and drop is never the only way.
- The compact layout (390 px) keeps working, so the only editor that must work there is the one that is already a vertical list.

**Not goals.**

- Relix syntax. This document does not define one. "View as Relix" is printed by the engine (§5.3).
- The parameter fields of a step (predicates, projections, aggregates). They stay `relix-expr` text fields (TOOLKIT §8.2, R5).
- Row counts and schemas on steps. They are R8 and are only mentioned where the views could show them.
- A graph canvas (§10).

---

## 2. The model: lanes, slots and the pipe rule

### 2.1 Terms

- A **lane** is a list of steps. The recipe's own `steps` is the **main line**. Today `fork`, `subsection`, `repeat` and `if` already hold child lists (RECIPES §3.2).
- A **slot** is a named input of a step, and it holds a lane. A binary operator has two slots, `left` and `right`.
- A **source** is a step that starts a lane with data and ignores what is above it (its data input is `any`). It is an input tab, read by name through the named-inputs protocol (TOOLKIT §8.2): either `relix:input`, which reads the tab, parses it and gives a relation, or the core op `input:tab`, which gives the raw bytes, for recipes that run byte steps first (RELIX.md §3.2 and §3.2.1; decision RQ1). Or it is a saved relation, which is a recipe promoted to a word (PLAN §3.6). A slot lane normally begins with a source. It may also begin with byte steps, which then work on a copy of the data that enters the slot step (RECIPES-1.2 §4.3; Q5, decided).
- A **binary step** is an operator with two slots. In v1 these are ⋈ join, ⟕ left join, ▷ anti join, ∪ union and − minus. Later operators (÷ divide, ASOF and so on) add no new idea.
- A **base-and-step step** is `FIX` or `ITERATE`. Its two slots are named `base` and `step` (Q3, decided). The data above may feed `base` only, as `"pipe": "base"`. The `step` lane is always explicit, and it starts with `relix:recur`, which reads the accumulator (RECIPES-1.2 §4; RELIX.md §3.5).

### 2.2 The pipe rule

> **The pipe rule.** Every step reads the output of the step above it. A binary step records which slot that data feeds, as `"pipe": "left"` or `"pipe": "right"`. The other slot holds a lane, normally one that begins with a source. A binary step that is first in its lane has no pipe in the editor's normal form: both of its slots are lanes. (The format also accepts a `pipe` on a first step, RECIPES-1.2 Q4. A base-and-step step follows the same rule with `"pipe": "base"` as the only pipe.)

The rule keeps the recipe a pipeline. Unary steps never see a slot. A binary step is the one place where the pipeline meets a second input, and the `pipe` key says which side of the operator the pipeline is on. That matters for operators where sides differ (⟕ ▷ −), and it is the one thing that a plain "relation-valued parameter" cannot say (§10.2).

### 2.3 Normal form

The editor keeps the model in a normal form after every action. **Rules 1 and 2 are editor rules. Rules 3 and 4 are validator rules** (RECIPES-1.2 §4.6), checked as `bad-slot` and `missing-slot` (§8). The prototype does this in one function, `normalize()`, and the real implementation does the same on the recipe tree after each edit. For each binary step in a lane, at position `i`:

1. If `i = 0` and the step has a `pipe`, the piped slot becomes a lane (empty if it was absent) and `pipe` is cleared. A first step has nothing above it. This is an editor rule: `pipe` on a first step is **valid** in the format. It then feeds a copy of the data entering the list (RECIPES-1.2 §4.6).
2. If `i > 0` and the step has no `pipe`, the first empty slot takes the pipe, trying `left` before `right`. A slot is empty when it is absent or its lane has no steps. If neither slot is empty, the step stays without a pipe and the data above is not used by it. The editor shows a warning on the card for this case, and the validator reports it as the `unused-pipe` warning (§8). The prototype left this case silent. For a base-and-step step the pipe goes on `base`, and only there.
3. If the step has a `pipe`, the piped slot is absent (it holds no lane, because the data above is that side).
4. Every slot that is not the piped one exists. It is a lane, possibly empty.

Normalisation then recurses into every slot lane. The result is that the user never sees a half-formed step. An empty slot is shown as a prompt to add a table (§7). It is not an error in the model, though the validator reports an empty slot at bake time (§8).

### 2.4 What a binary step looks like in Lanes

The Lanes view shows a binary step as an ordinary step card with two slot boxes in its body. The slot that holds the pipe shows the **↑ data above** chip. The other slot shows its lane, with the same step cards and gaps as any nested block.

```
 4  ⋈ Join  [relation · lazy]                 /steps/4    [↥ Main line] [⇄ Swap]
    +----------------------------------------------------------------------------+
    | operator [⋈ Join v]   same rows either way round                           |
    | on       [customer_id = id                                               ] |
    |                                                                            |
    | +- LEFT  (pipe) -------------------------------------------------------+  |
    | | [↑ data above]  from the step above                                   |  |
    | +-----------------------------------------------------------------------+  |
    | +- RIGHT  /steps/4/right/steps ----------------------------------------+  |
    | | :: [table] customers.csv               relix:input [relation · lazy]  |  |
    | |    ...                                                                |  |
    | | :: [σ]     Select  country = 'NZ'                  [relation · lazy]  |  |
    | +-----------------------------------------------------------------------+  |
    +----------------------------------------------------------------------------+
 5  γ Group ...
```

The pipe slot has a solid accent border and a filled label. The other slot has a dashed border until a drag is in progress. For an operator whose result depends on the order of its sides, the card shows "order matters". For a commutative one it shows "same rows either way round".

---

## 3. Swap sides and Main line

Two buttons on a binary step look alike and do different things. The design keeps them apart on purpose.

| | ⇄ Swap sides | ↥ Main line |
|---|---|---|
| What it changes | The query. Left and right trade places. | The layout only. The other slot's lane becomes the main line, and the steps above move into the slot. |
| Result | Same rows for ⋈ and ∪, with the column order changed. Different rows for ⟕, ▷ and −. | Always identical. |
| Gesture | Drag the ↑ chip (or a Tree socket) to the other slot. Or press the chip, or ⇄. | A button or menu item. It has no drag gesture, because it moves no data. |
| JSON | `left` and `right` trade lanes, and `pipe` flips. | Steps move between the lane and the slot, and `pipe` flips to the other side. The slots keep their names. |
| Available when | Always (any binary step). | The step has a `pipe` (it is not first in its lane). |

### 3.1 Why the UI keeps them separate

Users will ask to "put this table on the left". That sentence means one of two things. Either the user wants the query to change (customers on the left of a left join), or the user wants the picture to change (customers as the line down the middle, because that table is the one they care about). The first changes the rows that come back for ⟕, ▷ and −. The second must not change any row. If one button did both, the user would have to guess which it did, and a wrong guess changes results silently.

So the UI says what happened after each one, in the announcement area (UI.md §1.6) and in the "What happened" log of the prototype:

- Swap, commutative operator: "Swapped the sides of Join. It returns the same rows, and the columns of customers.csv now come first."
- Swap, left join: "Swapped sides. Left join now keeps every row of customers.csv."
- Swap, anti join: "Swapped sides. Anti join now returns rows of customers.csv that have no match."
- Swap, minus: "Swapped sides. Minus now takes the data above away from customers.csv." (The prototype fills the two names from the sides; here the data above is named by its step position.)
- Main line: "Redrew the recipe with customers.csv as the main line. The result is unchanged; the steps that were above are now the left side."
- Main line on a first step: "This step is first in its lane, so there is no main line to change."

Changing the operator in the card's select (⋈ to ⟕, say) does not swap anything. For an operator where order matters, the announcement adds "Order matters for this operator, so check which side is which."

### 3.2 Before and after

The example recipe is the one in §9: orders arrive as Base64 CSV, are decoded, parsed and filtered, joined to the New Zealand customers, grouped and sorted. Before:

```
 main line (lane)                                      the Join step
 ----------------                                      -------------
 0  ▤ orders.b64
 1  ≡ From Base64
 2  ▦ Parse CSV
 3  σ Select status = 'paid'
 4  ⋈ Join  pipe: left      LEFT  = [↑ data above]
                            RIGHT = ▤ customers.csv
                                    σ Select country = 'NZ'
 5  γ Group
 6  τ Sort
```

After **Swap sides**. The data above is still orders. It now feeds the right side. For ⋈ the rows are the same, and the columns of customers come first. For ⟕ the join would now keep every row of customers.

```
 0  ▤ orders.b64
 1  ≡ From Base64
 2  ▦ Parse CSV
 3  σ Select status = 'paid'
 4  ⋈ Join  pipe: right     LEFT  = ▤ customers.csv
                                    σ Select country = 'NZ'
                            RIGHT = [↑ data above]
 5  γ Group
 6  τ Sort
```

After **Main line**. Customers is now the main line. The steps that were above the join sit in the left slot, which keeps its name. Nothing about the query changed. The join has moved from index 4 to index 2, and the orders steps are at `/steps/2/left/steps/0` to `/steps/2/left/steps/3`.

```
 0  ▤ customers.csv
 1  σ Select country = 'NZ'
 2  ⋈ Join  pipe: right     LEFT  = ▤ orders.b64
                                    ≡ From Base64
                                    ▦ Parse CSV
                                    σ Select status = 'paid'
                            RIGHT = [↑ data above]
 3  γ Group
 4  τ Sort
```

Main line followed by Swap, or the reverse, can reach every layout that has the same two lanes. Main line only changes which lane is the spine. It needs `pipe` set, and it cuts at the join: only the steps above the join move into the slot. Steps below stay where they are. If the other slot is empty, the lane that remains has the join as its first step, and §2.3 rule 1 then turns the join's pipe into a lane. Q5 notes a related edge, a main line whose first step is not a source.

---

## 4. Gestures and drop rules

### 4.1 Drag payloads and targets

Drag and drop uses the pointer service `state/dnd.ts` (UI.md §3.6). The service handles the pointer route only. The prototype uses four payload types:

| Payload | Where it starts |
|---|---|
| `op` | an operation in the operations drawer |
| `source` (a table) | a table in the drawer: an input tab or a saved relation |
| `step` | a step card's handle (existing `{ type: "step"; path }`) |
| `pipe` | the ↑ data above chip, or a socket in the Tree view |

Targets are **gaps** (the space between steps, in any lane) and **slots** (a whole slot box, or an empty-slot placeholder in the Tree). The gap rule that rejects a step dropped next to itself, and the rule that rejects a step dropped into its own descendants (`isWithin`), stay as they are. A slot lane counts as a descendant of its own step, so a step cannot be moved into its own slot.

### 4.2 Drop rules

| Drag | Drop on | Result |
|---|---|---|
| Op | a gap in any lane | Inserted there. A binary op at a position after the first takes the pipe on the left, and its right slot starts empty. At the top of a lane it has no pipe and both slots are empty lanes. |
| Op | a slot that holds a lane | Added at the end of that lane. |
| Op | the piped slot | Refused: "The left side takes the data above. Drop the operation on the main line instead." |
| Table | a gap at the top of a lane | Becomes the lane's source, or replaces the source that is already there. |
| Table | a gap between steps | **Join it in.** Forge inserts a ⋈ with the pipe on the left and the table on the right. A table that is an input tab becomes a `relix:input` source, which reads and parses a CSV, TSV, JSON or NDJSON tab, so the right lane needs no Parse CSV step. A tab that is not in one of those formats (a Base64 tab, say) becomes an `input:tab` source, and the traffic light asks for the byte steps and the Parse CSV that the lane needs (§6). A saved relation needs no parse step. The user can swap with ⇄ afterwards. |
| Table | an empty slot | Fills it. If the slot holds the pipe and the other side is empty, the pipe moves to the other side first, and the table fills the slot. |
| Table | the piped slot, other side not empty | Refused: "The left side takes the data above. Drop the table on the right side, or swap sides first." |
| Table | a slot that holds a lane | Replaces the lane's source, or is put at its start if the lane has no source. |
| ↑ chip or socket | the other slot of the same step | Swap sides. |
| Step card | a gap in another lane, slots included | Moves, as `moveStep` does today. Dropping into the step's own slot is refused: "A step can't be moved into its own slot." |

**Join it in** is the shortcut that a user from a byte or text tool will reach for. They have a recipe, and a second tab, and they drag the tab onto the recipe. The result is a join with the data on the left and the new table on the right, which is what "the data I have, joined with this table" means. Whether Forge should assume the left is Q1.

Clicking an operation or table in the drawer, without dragging, adds it at the end of the main line (the same code path as a drop on the last gap).

### 4.3 Feedback while dragging

While a drag is in progress, every target that accepts the payload is highlighted, gaps grow (14 px to 22 px in the prototype), and the target under the pointer gets a stronger mark. The ghost label follows the pointer (`forge-drag-ghost`). Escape cancels and announces "Drag cancelled." All colour cues are paired with a shape or a text cue, as in UI.md §1.6.

---

## 5. Three views of one model

The recipe has one model, the recipe tree. The recipe pane shows it in three ways, chosen by a segmented control in the pane header: **Lanes**, **Tree** and **As text**. Edits in any view call the same tree actions (UI.md §3.2), so undo and redo are shared and the selected step carries across views.

### 5.1 Lanes

Lanes is the editor. It is the current recipe pane (UI.md WP 3.3) with slots added. It is the default, and it is the only view in the compact layout. Everything that exists today carries over unchanged: step controls, disable and breakpoint, step timings, issue badges, keyboard lift, undo. A recipe with no binary step looks the same as it does today.

### 5.2 Tree

Tree draws the recipe as a **query plan**. Sources are at the top and the result is at the bottom, so data flows down, as it does in Lanes. Each step is a node. A unary node has one child, the step above it in its lane. A binary node has two children, one per slot: the piped side continues up the lane, and the other side continues up its slot lane. An empty slot is a placeholder node ("left side is empty, drop a table here"). The main line, which is the root lane, is drawn as a thick path in the accent colour, so the spine of the Lanes view is also the spine of the plan.

```
 ▤ orders.b64                              ▤ customers.csv
      #                                         |
 ≡ From Base64                             σ Select country = 'NZ'
      #                                         |
 ▦ Parse CSV                                    |
      #                                         |
 σ Select status = 'paid'                       |
      #                                         |
      #  [L]  (pipe)                       [R]  |
      +=====> ⋈ Join  customer_id = id <=========+
                  #
              γ Group
                  #
              τ Sort

   # thick, accent colour: the main line      | thin: a slot lane
```

Each binary node has two **sockets**, L and R. The socket that holds the pipe is filled. A socket is a button and a drag handle. Drag a socket onto its sibling to swap sides, or drop a table or an operation on a socket (the same rules as §4.2, with the socket standing for the slot). The node also carries ⇄ and ↥ buttons, so the Tree view has the same two operations as the card.

A Tree node is a plain element, not a drawing primitive with its own hit model. The connecting paths are one SVG layer with `aria-hidden`. Nodes are laid out by a pure function (the prototype's is a short depth-first layout with leaves spaced by a fixed column width), tested without a DOM.

The Tree view is also the right place for the per-operator row counts and per-edge schemas that the Relix query-builder sketch asks for (TOOLKIT §8.2, R8). A card has little room for them. This document only reserves the room. Whether the Tree view is editable in v1 is open (Q4).

### 5.3 As text

As text shows the recipe as text. It becomes **View as Relix** (TOOLKIT §8.2, R7): the engine prints the recipe as a `.relix` script, and the recipe JSON sits beside it. The prototype shows an expression in a made-up notation that nests a join as `(left ⋈[condition] right)`. **That notation is illustrative. It is not Relix syntax**, and nothing in this document or in the implementation may depend on it. The real view comes from the engine's printer. Where a recipe has steps that Relix cannot print (the byte steps before the first Relix step: `input:tab`, From Base64, Parse CSV), the view prints the Relix part and says which steps it left out.

A recipe that uses slots cannot be shown by "View as FL" (UI.md WP 3.3) unless the compiler supports slots. §9.3 covers this.

---

## 6. Types and the traffic light

Relix introduces two data types into the pipeline: `table` and `relation` (TOOLKIT §7, §8.1). A `relation` is lazy. It runs when a non-Relix step or the end of the recipe needs rows, and the trace records the coercion `relation → table` (TOOLKIT §8.1).

**Type badges.** Each card shows the type of its output: `bytes`, `str`, `table`, or `relation · lazy`. A source shows the type it produces (an `input:tab` source is `bytes`, a `relix:input` source is `relation · lazy`, a saved relation is `relation`). The tooltip of the lazy badge says that the relation runs when a step that is not a Relix step needs rows.

**Rules.**

- A relational step needs `table` or `relation` as its input. A byte or text step that reads a `table` is checked against its declared input, as today.
- A binary step needs `table` or `relation` on both sides.
- A slot lane must end in `table` or `relation`.
- A slot lane runs on a copy of the data that enters the slot step (RECIPES-1.2 §4.3). A first step that is a source ignores that data, so it is not checked against an input. A lane that starts with a non-source step is checked against that data. The lane is checked from its first step on.

**The traffic light.** The checks reuse the fit levels of UI.md §2.3 (the `fit.ts` module, WP 6.1 and 6.21): green `yes`, amber `converts`, red `no`, each with a mark of a different shape and a short visible hint, so colour is never the only signal. In the prototype:

- A step that needs a table, after a step that produces `bytes`, shows red: "needs a table".
- A byte step that needs bytes, after a `table`, shows red: "needs bytes".
- A step that wants text and gets `bytes` shows amber: "converts to text".
- A slot that holds the pipe, when the data above is not a table or relation, shows an inline message on the slot: "The data above is bytes. Add Parse CSV above this step."
- A slot whose lane ends in the wrong type shows: "This side ends as bytes. Add Parse CSV to it."

The messages name the repair. Joining a table in (§4.2) already gives the lane a source that ends in a relation (`relix:input` parses), so a lane built that way needs no repair. The conversions between a `table` and a `relation` are inserted by the compiler (RECIPES-1.2 §6.9), so they are shown as a coercion badge (`table → relation`), not as a red mark. The "Fits the data" filter of the drawer (UI.md §2.3, WP 6.1) applies the same rules to the operation list, with the type of the lane under the insertion point. How it learns which gap is under the pointer is part of RL5.

---

## 7. Keyboard, touch and announcements

Drag and drop is never the only way (UI.md §2.3). The prototype implements the chip, the select and the buttons. The lift-and-move route extends UI.md WP 3.3 and is a proposal.

**Buttons and fields.**

- The **↑ data above** chip is a button. Enter or Space swaps sides, and so does the ⇄ button on the card. A drag is the pointer shortcut for the same action.
- An empty slot has a **Choose a table…** select, listing the input tabs and the saved relations. Choosing one is the keyboard and touch route for dropping a table on a slot.
- ↥ Main line and ⇄ Swap are buttons with text labels and tooltips. In the compact layout they may move into the card's overflow menu, but they stay reachable.
- The operator is a select in the card. Changing it is announced (§3.1).
- An operation or table in the drawer adds itself to the end of the main line on click, Enter or Space.

**Lift and move.** Space or Enter on a card's handle lifts it (UI.md WP 3.3). Up and Down move it among its siblings. Right moves it into the container above, as its last child. Left moves it out to the parent list. A slot adds stops to this route:

- A lifted step moving Down or Up reaches a binary step. A binary step is a container, so Right enters its **non-piped slot lane** as the last child, and Left leaves the slot lane back to the lane that holds the step. The piped slot has no lane and no stop.
- A lift never offers a stop in the lifted step's own slots.
- Every move is announced. The announcement names the slot: "Step 1 of 2 in the right side of Join". A move in the main line stays "Step 2 of 5".

**Touch.** The drag handle and the chip are at least 28 px high in the prototype. In the compact layout the target is the usual 44 px. The pointer service has a movement threshold so that taps stay taps. The buttons and selects above cover everything that a drag does.

**Screen readers.** The lane is a list. A binary step's slots are named regions ("Join, left side, takes the data above" and "Join, right side"). A slot with a lane contains a nested list, exactly as a `fork` does. An empty slot says "empty, choose a table". Announcements go to the same live region that the pane uses today.

---

## 8. Paths, issues and timings

Paths are RFC 6901 pointers, as in UI.md §3.2. A slot adds one segment: the slot's name, then `steps`:

```
/steps/4                      the join step
/steps/4/right                the right slot (a lane object)
/steps/4/right/steps          the lane's list
/steps/4/right/steps/1        its second step (Select)
```

This is the same shape as a `fork` (`/steps/1/steps/0`) and `if` (`/steps/2/then/0`), with `left` or `right` in the place of `steps`. In `state/recipe-ops.ts`, `childLists(step, stepPath)` gains one more case and returns the non-piped slots with their paths. `CHILD_LIST_KEYS` gains the two slot keys. `moveStep`, `insertStep`, `removeStep` and `isWithin` then work on slots without change, because they work on list paths. That is the main reason for spelling a slot as `{ "steps": [...] }`: it is one more kind of child list, not a new structure. A slot is a lane object so that a slot can carry fields later (a name, a note) without a format change. (Q3 and Q2 would use it.)

**Prefix matching keeps working.** Issue paths (`state.issues`), the failing-step path (`bake.result.error.path`) and step timings (`bake.result.steps`) are matched to cards by path prefix (`issuesForPath`, UI.md WP 3.3 and 3.4). A path below `/steps/4/right/steps/1` has the prefix `/steps/4`, so the join card shows an issue count that includes its slot lane, and a failing step inside the right lane highlights both its own card and the join card (as a failing step in a `fork` does today).

**What moves paths.** Swap trades `left` and `right` paths. Main line renumbers the main line and moves the steps above into a slot (§3.2). Both are ordinary tree edits: the store recomputes issues and marks the last bake stale, as it does after any edit.

**Issues.** The validator (RECIPES §3.7) gains the issue codes of RECIPES-1.2 §5.2 and §14.1, which replace this document's first proposals. `missing-slot` covers a slot that is absent where it must exist, an empty lane, and a slot op with no slot keys. `bad-pipe` is merged into `bad-slot` (reasons `not-slot-op`, `mixed-slots`, `wrong-slots`, `piped-slot-present` and `slot-in-params`). A `pipe` on a first step is valid, so it is no issue. `unused-pipe` (a warning) is a non-first slot step with a lane in every slot: the data above is dropped (§2.3 rule 2). `slot-type` is **not** a validator rule: the validator tracks no value types. "A slot lane does not end in a table or relation" is the traffic light of §6 in the editor (`fit.ts`) and `E_TYPE` at run time, attributed to the step. `relix:recur` outside a `step` lane is `bad-position`.

**Limits.** `RECIPE_LIMITS` counts steps over the whole tree (500) and container nesting depth (8). Slot lanes count toward both, in the same way as `fork` children. The raw JSON depth pre-walk (64) is above eight container levels with three JSON levels each (step, slot, `steps`), as RECIPES §3.7 already computes for params. The sums are checked in RL1.

### 8.1 Registers and return

Recipe JSON v1.1 added the `register` and `return` steps and `{ "ref": name }` parameter values (RECIPES §3.2, §3.4; UI.md §2.3, "Registers and return"). Slots meet them in four places. The rules below apply the existing ones. They are normative in RECIPES-1.2 §5.4.

**Scope inside a slot lane.** Every step list is a scope (RECIPES §3.2, R27), and a slot lane is a step list. A register is visible to the later steps of its own list and to everything nested in them. So a register defined earlier in the list that holds the binary step is visible in that step's own parameters (`on`, the `relix-expr` fields) and in the steps of both slot lanes, as inside a `fork`. `registersInScope(recipe, stepPath, catalogue?)` returns them for a path such as `/steps/4/right/steps/1`, once it knows the slot lists (RL1). A step in a slot lane uses the same Value / Register switch of the parameter form.

**A register defined inside a slot lane.** It is bound in that lane only. It is not visible to the steps after the join, and not visible in the other slot's lane, because no value survives past the container (RECIPES §3.2, as for a `fork` child). Two sibling lanes may use the same name, since `duplicate-register` looks only at names visible at the step. A register takes its copy of the data at its position. A slot lane has data at its top (the copy of the data that entered the slot step, RECIPES-1.2 §4.3), so a register at the top of a lane is valid and the validator reports nothing for it. To carry a value, for example a threshold, into a side, define the register above the join and read it in the lane.

**`return`.** A `return` is valid only in the root list and in the `then` and `else` lists of an `if` that is itself in a valid position (RECIPES §3.2). A slot lane is not the root list, so a `return` in a slot lane, or in an `if` inside a slot lane, is `bad-position`. The `container` and `containerKind` fields of the issue name the slot step (`containerKind` is `"op"`), and the new `slot` field names the slot. A `return` after the join, in the main line, is allowed. It ends the recipe with the relation, which runs at the end as usual (§6). The editor's `insertStep` guard for a misplaced Return (UI.md §2.3, WP 6.40) must refuse a slot lane as a target, and the keyboard lift must not give a Return a slot stop (§7).

**Registers and saved relations.** Both share work between steps, and they do different jobs.

| | Register | Saved relation |
|---|---|---|
| What it holds | A value of any tag, computed from a copy of the data | A relation: a saved recipe promoted to a word (PLAN §3.6) |
| Where it is used | As an op parameter value, `{ "ref": name }` | As a source step at the top of a lane, in any slot or recipe |
| Lifetime and scope | One step list and what is nested in it, bound afresh per piece | A word, shared across recipes, pinned like any op |

A register cannot be a slot's source. A reference is accepted only in the `params` of op steps and op tests (RECIPES §3.4), and a slot lane starts with a step, not a parameter. So the way to use one sub-expression twice is a saved relation, used as a source in both places. A recipe tree has no shared nodes, and the Tree view draws a saved relation that is used twice as two source nodes. A "register as source" step is Q6.

---

## 9. Recipe JSON for slots

> **Normative elsewhere.** The shape below is the shape of [RECIPES-1.2.md](RECIPES-1.2.md): §4 (the JSON), §5 (validation) and §6 (compilation and text). This section shows the example and records the versioning decision. If it ever differs from RECIPES-1.2, that file wins. The prototype's own sketch (its own header fields, steps with no `kind`, display names for ops) is retired.

### 9.1 The example

The orders recipe: orders arrive as a Base64 CSV tab, are decoded, parsed and filtered, joined with the New Zealand customers (a lane of its own on the right), then grouped and sorted. The main line starts with the core op `input:tab`, which reads the tab as raw bytes, then the byte steps, then Parse CSV. The right lane starts with `relix:input`, which reads the CSV tab and parses it, so that lane has no Parse CSV step.

```json
{
  "forge": 1,
  "name": "Paid orders by region",
  "steps": [
    { "kind": "op", "op": "input:tab", "params": { "tab": "orders.b64" } },
    { "kind": "op", "op": "base64:decode" },
    { "kind": "op", "op": "csv:parse" },
    { "kind": "op", "op": "relix:select", "params": { "cond": "status = 'paid'" } },
    {
      "kind": "op",
      "op": "relix:theta-join",
      "params": { "on": "customer_id = id" },
      "pipe": "left",
      "right": {
        "steps": [
          { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
          { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } }
        ]
      }
    },
    { "kind": "op", "op": "relix:group", "params": { "spec": "region; sum(total) as revenue" } },
    { "kind": "op", "op": "relix:sort", "params": { "keys": "revenue desc" } }
  ]
}
```

Read this as follows. The join has `pipe: "left"`, so its `left` slot is not stored: the data above is the left side. Its `right` slot is a lane that starts with an input tab. After a swap, the same step has `pipe: "right"`, no `right` key, and a `left` key that holds the customers lane. A saved relation as a source is a step whose `op` is the word of the saved recipe (the prototype writes `my:vip-customers`). The recipe holds no step that lifts the table that Parse CSV leaves into a relation: the compiler inserts `relix:from` where the next step needs a relation, and `relix:run` at the end (RECIPES-1.2 §6.9). `FIX` and `ITERATE` use the same shape with the slots `base` and `step` (RECIPES-1.2 §4.4).

### 9.2 What the sketch left open, and how it was settled

- **Header.** The real header is the one of RECIPES §3.1, and `"forge"` stays `1` (§9.3).
- **Step kind.** Real steps keep `"kind": "op"`. A step that has slots is still a `kind: "op"` step, with the extra keys `pipe`, `left`, `right`, `base` and `step`. It is not a new kind (L6, settled).
- **Op names.** The catalogue names come from the generated Relix wrappers (RELIX.md §4) and the existing vocabularies: `relix:theta-join`, `relix:select`, `input:tab`, `base64:decode`, `csv:parse`. The prototype's `csv:csv-parse` and `base64:from-base64` were display names.
- **Params.** The parameters follow the operator table (RELIX.md §4): `cond`, `on`, `spec`, `keys`.
- **Pins.** Steps keep `hash` pins (RECIPES §3.10). A slot lane's steps are pinned like any other.

### 9.3 Versioning and consequences for the format

**Precedent.** The one format change so far, Recipe JSON v1.1 (the `register` and `return` steps and register references, RECIPES.md Appendix A, with [RECIPES-1.1.md](RECIPES-1.1.md) as the historical note), was additive and kept `"forge": 1` (RECIPES R29, §3 introduction, §3.1). A recipe that uses none of the new features is a v1 recipe with the same canonical JSON, text and share fragment. A v1 reader rejects a recipe that uses them, and so never misreads it. Its issues (`bad-kind`, `unknown-field` and similar) are less explicit than a version error, and RECIPES Appendix A.11 records that this was accepted. The share link stays `v=1`. The web app's share dialog says "This recipe needs Forge 1.1 or later; older versions show an error." when a recipe uses the new features (`recipeUsesV11`, UI.md §2.3, "Registers and return").

**Decision: the Relix wave is v1.2 and keeps `"forge": 1`** (RECIPES-1.2 Q1, accepted at Gate T1 on 2026-11-23). The 1.1 precedent says that the number follows compatibility, not size.

- No v1 recipe changes meaning. The new keys `pipe`, `left`, `right`, `base` and `step` appear only on op steps with slots, which no v1 catalogue has. A recipe with no slot step is a v1 recipe, byte for byte (L5).
- A v1 reader fails closed. Its validator rejects the extra keys of an op step with `unknown-field`, and a `relix:*` op is `unknown-op` in a catalogue without the Relix pack. RECIPES-1.2 §2.1 records the run on the v1.1 code (2026-11-23) that confirms it, as WP 6.34 did for the 1.1 constructs.
- A bump to `"forge": 2` would give old readers `bad-version`, a clearer message. It would also make every new recipe unreadable by every existing Forge, plain byte recipes included, and every stored recipe, golden and share link would need a version decision. The 1.1 wave rejected that cost, and so did this one.
- The Relix wave has parts beyond slots: named inputs in the bake protocol (X5), ext values and parameters (TOOLKIT §6), and `relix-expr` parameters. The owner decided that the whole wave is v1.2.

**Consequences.**

1. **Old Forge versions.** A v1.1 or older Forge rejects a recipe with slots through its validator, with the issues above and no new message. We cannot change old code. What the new code does is (a) add `recipeUsesSlots(recipe)` and `recipeUsesV12`, and (b) show in the share dialog the same kind of note as in 1.1: "This recipe needs Forge 1.2 or later; older versions show an error." Accepting the less explicit old-reader message is the choice made for 1.1 (L7).
2. **The share format.** A link to a recipe with slots is an ordinary `v=1` fragment, as in RECIPES Appendix A.10. An old reader gets `invalid-recipe` with the issues of the new keys (RECIPES §7.3 step 7). The `v=2` rejection (`unsupported-version`) is untouched.
3. **A new reader accepts v1 and v1.1 unchanged.** Every such recipe has no slots and is valid as it stands. The goldens of RECIPES §12 do not change.
4. **The compiler.** `compileRecipe` turns a slot step into the lanes (`[ … ] recipe:peek`) and then the op, with a step map entry for each slot step and the paths `/left/steps/…`, `/right/steps/…`, `/base/steps/…` and `/step/steps/…` (RECIPES-1.2 §6.1 and §6.4). The 1.1 compile of registers composes with it (§8.1). The compiler also inserts the conversions between tables and relations (RECIPES-1.2 §6.9).
5. **The canonical text form.** The text of a slot lane and of `pipe` is specified in RECIPES-1.2 §6.5 and §6.6. The text form is not "View as Relix", which is the engine's printer and is lossy for byte steps (§5.3).
6. **Named inputs.** `relix:input` and `input:tab` read a tab by name. The bake protocol carries one input today (TOOLKIT §2.3). The named-inputs change (X5) is a `@forge/worker` protocol change (`PROTOCOL_VERSION` 2) and a dependency (§11).

---

## 10. Alternatives considered

### 10.1 A free-form node graph canvas

Rejected.

- It makes every recipe two-dimensional. A byte recipe is a straight line today and works well as one. Making it a canvas would cost that for the many users who never touch Relix.
- A recipe is a tree, not a DAG (TOOLKIT §2.3). Shared sub-expressions are already handled by named relations (saved recipes promoted to words) and by saved relations for whole lanes and by registers for values in parameters (§8.1), so they need no wires.
- A graph canvas is hard to use with a keyboard and at 390 px. Lanes already work with both, and reuse the nested-block UI.
- The Tree view gives the picture of the plan without making it the editing model.

### 10.2 A relation-valued parameter field with no pipe choice

This is the baseline of TOOLKIT §8.2: a binary operator is a step whose second input is a parameter that holds a nested lane. The data above is always the first input, and the nested lane is always the second.

It is the smaller change, and it fits the format with one new parameter kind. It was not chosen because it cannot say that the pipeline is on the right side. For ⟕ ▷ and −, a user who has a reference table and a data pipeline needs "keep every row of the table, joined with the data above". That needs the data above on the right. With a fixed side the user would have to restructure the recipe by hand, and the recipe pane has no gesture for that. The pipe key is one string, and it is the only new idea in the format. With it, the baseline is the special case where `pipe` is always `left`.

---

## 11. Dependencies, phasing and work packages

### 11.1 Dependencies

- **The recipe format change (SP2).** The additive v1.2 wave of §9.3 ([RECIPES-1.2.md](RECIPES-1.2.md), approved at Gate T1), on top of the 1.1 registers wave. Without it, nothing here is saved or shared.
- **Named inputs (X5).** The bake protocol change that lets `relix:input` and `input:tab` read another tab. Without it a slot lane cannot start from a second tab.
- **The Relix engine (R0, then R1 to R4).** The `relation` kind and the value-level words. The UI work below can be built and tested against a fixture catalogue and a fake engine, which is how the prototype works, but Gate T4 needs the real engine.
- **UI.md amendments (SP3).** This document adds a section to UI.md for the recipe pane when it is accepted.

TOOLKIT R6, "Nested-lane UI for relation-valued parameters", is the work package that this design refines. The packages below replace its scope with the slot design. Their ids are proposals and use the prefix RL (Relix lanes).

### 11.2 Work packages

All packages: Apache header on every new source file; the CSP rules of UI.md §4; `npm run lint && npm run typecheck && npm test && npm run build` pass; no edits outside owned paths. Sizes are relative (S, M, L) and are estimates.

| WP | Deliverable | Owns | Depends on | Agent | Size | Done when |
|---|---|---|---|---|---|---|
| RL1 | Recipe model for slots: types, `pipe`, `left`, `right`, `base` and `step` lanes, the validator rules and issue codes (§8), schema and canonical text form. **This is RECIPES-1.2 RW1** (model, schema, validator), with RW3 (compilation, step map, text) and RW6 (share). The normal form of §2.3 is the editor's, in RL2. | `packages/recipe/*` (frozen: a change needs Gate T1, which has passed) | RW1 | So | M | Schema and validator agree on a corpus with slots; every v1 and v1.1 recipe is unchanged; a recipe with slots is rejected by a v1.1 reader (§9.3); the scope and `bad-position` rules of §8.1 hold; `recipeUsesSlots` exists |
| RL2 | Tree actions for slots: `childLists`, `moveStep`, `insertStep`, `removeStep`, `isWithin` on slot paths; `swap`, `mainLine`, `fillSlot`, `joinIn`; normal form after every edit; announcement texts (§3.1) | `apps/web/src/state/recipe-ops.ts` and tests, `apps/web/src/recipe/move.ts` | RL1 | So | M | Pure unit tests: every row of §4.2; swap and main line give the layouts of §3.2 and are involutions where they should be; undo restores the tree |
| RL3 | Lanes rendering: binary step card, slot boxes, chip, empty-slot select, type badges and the traffic light, drag and drop through `state/dnd.ts` with the new payload and targets, keyboard lift with slot stops | `apps/web/src/recipe/*` (card, slots, styles) | RL2 | So | L | Add, nest, swap, main line, join in, move into a slot work by pointer and by keyboard alone, with announcements; unit tests for the pure parts; axe clean |
| RL4 | Tree view: layout function, node and socket rendering, shared actions, placeholder nodes (read-only or editable per Q4) | `apps/web/src/recipe/tree/*` | RL2 | So | M | Layout is tested without a DOM; the Tree view shows the same recipe as Lanes; if editable, every gesture calls the RL2 actions and undo is shared |
| RL5 | Operations drawer: tables group (tabs and saved relations), Relix group, the fit filter for slot lanes | `apps/web/src/ops/*` | RL2, D2 | Ha | S | Tables can be dragged or clicked; a table shows the right type |
| RL6 | As text and JSON: the "View as Relix" dialog on the engine's printer (R7), and the recipe JSON view; FL compile of slot steps. **The compiler half is RECIPES-1.2 RW3** (RECIPES §5; RECIPES-1.2 §6) | `apps/web/src/recipe/forge-fl-dialog.ts`, `packages/recipe/*` (compiler, frozen) | RW1, RW3, R7 | So | M | Recipe to text to recipe is the identity on supported steps; the slot step compiles and errors are attributed to `/left/steps/…` and `/right/steps/…` |
| RL7 | End-to-end and accessibility: the Gate T4 recipe through the UI under the production headers; axe on Lanes and Tree; the compact layout | `apps/web/e2e/*` | RL3, RL4, R3, X5 | Ha | S | The Gate T4 recipe (§11.3) is built with gestures and with the keyboard only; axe is clean in both views at the desktop and compact sizes |

RL1 and RL6's compiler part change frozen packages, and are RECIPES-1.2's RW1, RW3 and RW6. Gate T1 has passed, so they can start. RL5 and the pure parts of RL2 can start earlier on branches against a fixture, because they touch `apps/web` only. RL3 and RL4 are the biggest items and are independent of each other once RL2 has landed, so they run in parallel in separate worktrees.

### 11.3 Gate

Gate T4 (TOOLKIT §13.6) says that a recipe decodes Base64, parses CSV, filters, joins a second input tab, groups, shows a table and round-trips through "view as Relix". This design adds one condition: **the same recipe can be built, swapped, re-rooted and joined-in, using the keyboard alone, in the Lanes view, and read in the Tree view.** RL7 tests it.

---

## 12. Decisions and open questions

### 12.1 Decisions

These were proposals. The owner accepted the slot model at Gate T1 on 2026-11-23, through RECIPES-1.2 and RELIX.md. Ids use the prefix L (lanes) so that they do not clash with T (TOOLKIT), S (SYMBOLIC) or D (LANGUAGE).

| ID | Decision | Rationale |
|---|---|---|
| L1 | A recipe stays a linear lane. A binary operator is a step with two slots, `left` and `right` (`FIX` and `ITERATE`: `base` and `step`), and a slot holds a lane of the same shape as a `fork` child list. | Reuses the recipe tree, the nested-block UI and the tree actions. Unary and byte recipes are untouched. |
| L2 | The pipe rule: every step reads the step above. A binary step records the slot that data feeds, `pipe: "left" or "right"`. The other slot is a lane that starts with a source. A first step has no pipe. The editor keeps the normal form of §2.3 (an editor rule: the format accepts `pipe` on a first step). | One rule for where the data goes. It also says on which side the pipeline is, which matters for ⟕ ▷ and −. |
| L3 | Swap sides and Main line are two separate actions with separate gestures, and each announces what it did. | Swap changes the result. Main line changes only the layout. A single action would hide which one happened. |
| L4 | Three views of one model: Lanes (the editor, and the only view in the compact layout), Tree (the query plan) and As text (becomes "View as Relix", printed by the engine). Every edit calls the same tree actions. | Lanes keep the byte workflow. Tree shows the plan. One model means shared undo. |
| L5 | Slots are written as `{ "steps": [...] }` lanes under `left` and `right`, and a slot adds one path segment (`/steps/4/right/steps/1`). `"forge"` stays `1`: slots are an additive wave, like v1.1, and the wave is v1.2 (§9.3; decided at Gate T1). | One more child-list kind, so `recipe-ops` and prefix matching of issues, timings and failing steps work unchanged. Old links and old Forge versions keep working for all recipes that do not use slots. A v1.1 or older reader rejects one that does. |
| L6 | A step with slots stays a `kind: "op"` step with the extra keys `pipe`, `left`, `right`, `base` and `step`. It is not a new step kind (settled in RECIPES-1.2 §4.2). | The op carries the pin, params and notes. A new kind would need a second path through every consumer. |
| L7 | A Forge that does not know slots rejects such a recipe through its validator, as a v1 reader does for v1.1 (RECIPES Appendix A.11). The share dialog notes the version requirement. | A half-understood recipe must never run. The trade was accepted for 1.1 and is the same here (§9.3). |
| L10 | Registers and `return` follow the existing rules: a slot lane is a scope, a register defined in it is not visible after the join, a `return` in a slot lane is `bad-position`, and a register cannot be a slot source (§8.1). | Applies the v1.1 rules without a new mechanism. |
| L8 | The UI keeps drag and drop optional. Every gesture has a button, a select or a key (§7). | UI.md §2.3. |
| L9 | A graph canvas is not part of the design (§10.1). | Two-dimensional recipes, DAG semantics we do not have, keyboard and 390 px. |

### 12.2 Open questions

The numbering is local to this document. Q1 and Q4 are editor questions and are still open. Q2, Q3, Q5 (first point), Q6 and Q7 were decided at Gate T1 on 2026-11-23, and each says so.

- **Q1. Default pipe side for drop-to-join-in.** The prototype puts the data above on the left and the dropped table on the right: "the data I have, joined with this table". Is that the right default for every operator, or should a drop onto the main line ask? A hybrid is to default to the left and add a one-click "make this the left side" toast, which is a Swap.
- **Q2. N-ary union.** ∪ over several inputs could be one step with a list of slot lanes ("+ add input"), or a chain of binary ∪ steps. The lane model handles either. A list of slots needs a slot name per entry, and the lane-object spelling of a slot (§8) leaves room for that. A chain needs no format change and costs extra steps. **Decided (Gate T1, 2026-11-23): a chain of binary ∪ steps.** Binary operators have two slots only (RECIPES-1.2 Q5). A later wave can add named slots next to `left` and `right`, because a slot is a lane object.
- **Q3. FIX and ITERATE.** These operators take a base and a step. They could be slots named `base` and `step`, with the pipe feeding `base`. It fits the model with no new idea, but `step` is a lane whose input is the previous iteration, not a source. That is a second kind of slot (a "loop body", like `repeat`), and the traffic light needs a rule for it. **Decided (Gate T1): slots named `base` and `step`.** The data above may feed `base` only (`pipe: "base"`), and `step` is always explicit. `step` is an ordinary lane, a scope on a copy of the data entering the step, in which `relix:recur` is valid. It is not a second kind of slot: the loop belongs to the operator, and the traffic light needs no extra rule beyond "the lane ends in a relation" (RECIPES-1.2 Q5; RELIX.md RQ5).
- **Q4. Is the Tree view editable in v1?** The prototype lets the user drop and swap in the Tree. A smaller first cut makes it read-only and keeps all editing in Lanes. Read-only avoids a second hit-testing and keyboard design, and the Tree could still hold the L and R sockets as buttons that swap. Editable gives the Tree real value for the user who thinks in plans.
- **Q5. Byte steps inside slot lanes.** A slot lane may begin with byte steps (From Base64, Parse CSV), as the main line of the example does after its `input:tab` source. Its output must be a table or relation, and the traffic light checks it as a step. Open points: may a slot lane begin with no source (only byte steps, reading the main input)? If the other slot of a Main line is empty, what is the new first step? A rule that a slot lane's first step must be a source is simpler, and the join-in gesture already adds one. **Decided (Gate T1) for the first point: yes.** A slot lane may begin with byte steps and need not begin with a source: it runs on a copy of the data entering the step, so there is no "lane with no data" case (RECIPES-1.2 Q3). The editor's own gestures may still start a lane with a source. The second point (the new first step after Main line when the other slot is empty) is an editor question and is still open; §3.2 says that rule 1 then turns the join's pipe into a lane.

- **Q6. Register as a slot source.** A register holds a value, and a slot needs a lane. A source step that reads a register (a value that is a table or relation) would let one sub-expression feed two slots without saving a relation. It breaks the 1.1 rule that references go in op parameters only. Is it worth that, or are saved relations enough? **Decided (Gate T1): no.** Saved relations are enough (RECIPES-1.2 Q6).
- **Q7. Number of the wave.** Slots are additive and keep `"forge": 1` (§9.3). If the owner decides that the whole Relix wave (slots, named inputs, ext parameters) is a 2.0, slots go with it. Which? **Decided (Gate T1): v1.2 with `"forge": 1`, for the whole wave** (RECIPES-1.2 Q1).

Items outside this document that it depends on, and that TOOLKIT §14.2 tracks: which Relix API additions come into 1.0 (Q1 there), and where `relix-web` lives (Q11 there).
