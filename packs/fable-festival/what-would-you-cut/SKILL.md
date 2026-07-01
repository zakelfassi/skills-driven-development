---
name: what-would-you-cut
description: Subtraction-first review of a page, copy deck, API, schema, or config — judge the real rendered artifact, inventory everything it contains, and rank what should be removed. Use when something reads as bloated, generic, or untrustworthy; before a launch; when asked to "make it better" or "polish this"; or when a design/doc/API has grown by accretion and nobody remembers why.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: taste is knowing what to remove — the hierarchy that lies, the four font weights doing the job of two, the button louder than its promise. 'What would you cut?' is a four-word prompt that outperforms 'make it pretty' on every surface: homepage, schema, pitch. Frozen here so subtraction survives as a procedure."
  usage-count: "0"
  last-used: "2026-07-01"
---

# What Would You Cut

Improve by removal. Inventory the artifact as a stranger encounters it,
price every element by what it costs the reader, and rank the cuts.
Addition is allowed only after subtraction is done.

## Inputs
- The artifact: a page/screen (preferred: running, in a real browser),
  copy, an API surface, a schema, a README, a pitch
- The one action that matters: what a first-time stranger should
  understand, trust, and *do*

## Steps

1. **Judge the rendered thing, not the source.** For UI: boot it, open a
   real browser, resize to a phone, hit empty and error states. For copy:
   read it aloud, at arm's length, as someone with no context. Never audit
   a design from the JSX or a doc from its outline.

2. **The 800ms read.** Record first impressions before analysis: what does
   this appear to be, who is it for, do I trust it, what is it asking me to
   do? These four answers are the baseline everything else is judged against.

3. **Inventory.** List every element competing for attention: headings,
   buttons, badges, sections, fields, endpoints, config keys, adjectives.
   Yes, adjectives.

4. **Price each element.** For each item ask: *what does it cost the
   stranger* (attention, doubt, a decision they shouldn't have to make) and
   *what breaks if it's gone?* If the answers are "something" and "nothing",
   it's a cut.

5. **Rank the cut list.** Order by trust-damage first, attention-cost
   second. Classic offenders: hierarchy that lies about what matters, two
   CTAs of equal weight, jargon naming the maker's internals instead of the
   user's outcome, decoration masquerading as information, the third
   font weight, the "and more!" clause.

6. **Name the keep.** State the single element that must survive every cut
   — the one action, the one claim, the one field. Cuts are safe only when
   the keep is explicit.

7. **Apply and re-judge.** Make the safe cuts (copy, spacing, dead options,
   redundant sections); list the structural ones as recommendations. Then
   repeat step 2 on the result — if the 800ms answers didn't improve, the
   cuts were cosmetic.

## Conventions
- Additions are debt until proven otherwise; every proposed addition must
  name what it displaces.
- Never touch payment, delete, or publish flows during the apply step.
- Report cuts as "element → cost → what breaks (nothing)" so each one is
  checkable, not a taste assertion.

## Edge Cases
- **Dense expert tools** (dashboards, terminals, IDEs): the stranger test
  becomes the *returning expert* test — cut what slows the hundredth visit,
  not the first.
- **Legal/compliance text**: exempt from cutting, not from demotion — it
  can lose visual priority without losing presence.
- **The artifact is genuinely minimal already**: say so and stop. A
  subtraction pass that invents cuts is the same failure as a review that
  invents praise.
