# Nutrition Estimation — Problem Space & Potential Solutions

**Context:** Cegin v1.4  
**Audience:** future self / contributors  
**Status:** discussion doc (not a committed roadmap)

---

## 1. The problem in one sentence

Home recipes are **messy natural language**; nutrition DBs need **clean food + mass**. Bridging that gap is where every consumer cooking app either lies politely or works hard.

### What users write

```
6 cups (1.5 liters) chicken or beef stock (see basic stock, page 28) or dashi (page 31)
170g ¾ cup sushi rice
Options for topping:
Chili oil
Soy sauce
Thinly sliced green onion
```

### What a nutrition engine needs

```
{ food: "chicken stock", qty: 1500, unit: "ml" }
{ food: "sushi rice", qty: 170, unit: "g" }
# toppings without amounts → exclude or ask user
```

### Failure modes we hit in 1.4 development

| Failure | Example | Effect |
|---------|---------|--------|
| Wrong FDC match | sushi rice → rice crackers / black rice | Silent calorie inflation |
| Ghost ingredients | “Soy sauce” with no amount → AI invents 50g | Fake plate |
| Alternatives | chicken **or** beef stock | Match fails or double-count risk |
| Cookbook noise | page refs, dual units, headers | Parser soup |
| Servings divisor | same batch, servings 4 vs 1 | 4× per-serving swing |
| Overconfidence | partial match still “High” | Trust without truth |

---

## 2. What v1.4 already chose

```
AI structure (once) → USDA link + grams → store nutrition_data on recipe
```

| Layer | Responsibility |
|-------|----------------|
| AI structure | Cookbook English → include/exclude + qty/unit/food |
| USDA SQLite | Per-100g macros for known foods |
| User | Edit amounts; breakdown link/ignore; popup nudge |
| Store | Fingerprint ingredients; recompute offline until edit |

**Philosophy:** Prefer **honest incomplete** totals over **pretty wrong** totals.

---

## 3. Solution directions (potential)

### A. Deeper offline food data (helps matching)

| Source | Helps with | Caveat |
|--------|------------|--------|
| Full **USDA FDC** rebuild (Foundation + SR + portions) | More foods, better measures | APK size, rebuild pipeline |
| **Aliases** (UK CoFID / CIQUAL names) | British/EU wording | Mapping work |
| **Open Food Facts** | Branded soy sauce, oils | Quality varies; ODbL if redistributing |
| More nutrients (Na, sugar, sat fat) | Label-like UI | Still wrong if match/amount wrong |

**Verdict:** High value *after* structure is stable. Does not fix no-amount toppings alone.

### B. Structure at write-time, not estimate-time

| Approach | Pros | Cons |
|----------|------|------|
| Structure on **save/import** | Estimate is pure math; consistent across devices | AI cost on every save |
| Structure only on **first estimate** (1.4) | Lazy cost | First estimate still slow |
| Manual structured editor | Highest accuracy | UX heavy |

**Verdict:** Natural next product step: optional “Normalize ingredients” on Edit/Tidy that writes structured JSON *into* the recipe permanently (visible to the user).

### C. Hybrid online APIs (helps when offline fails)

| API | Role |
|-----|------|
| Edamam / Nutritionix / Spoonacular | Fallback analysis for low match ratio |
| FDC live API | Search better FDC ids at structure time |
| recipe-api.com-style catalog | Not applicable to *user* free-text recipes |

**Verdict:** Optional online fallback for self-hosters who allow cloud AI; never the only path for offline-first Cegin.

### D. UX & policy (cheap, high honesty)

| Idea | Why |
|------|-----|
| Popup for skipped lines (shipped 1.4) | Teach users to add g/ml |
| “Base only” vs “as served” modes | Porridge + drizzle vs fully dressed bowl |
| Require amount for calorie-dense foods | Oil/soy cannot be no-qty includes |
| Show batch + per serving always | Prevent servings confusion |
| Confidence tied to % mass measured | Don’t call cracker-hits “High” |

**Verdict:** Keep investing here; policy beats more regex.

### E. User-grounded truth

| Idea | Why |
|------|-----|
| Remember last FDC link per cleaned food name | Personal kitchen vocabulary |
| Household defaults (“our soy = 10ml drizzle”) | Ghost toppings become intentional |
| Barcode scan for bottles | Open Food Facts / branded FDC |

**Verdict:** Strong differentiator for a *personal* recipe app vs SaaS nutrition APIs.

### F. What not to do

- Ever-growing regex-only parser as the main path  
- AI freestyle whole-recipe kcal without line audit  
- Claiming 32 micronutrients from bad matches  
- Re-running structure on every screen open (cost + jitter)  

---

## 4. Comparison: free-text chaos vs structured contract

| | Free-text every time | Structure once (1.4+) | Commercial recipe APIs |
|--|----------------------|------------------------|-------------------------|
| Input | User recipes | User recipes | Their catalog |
| Offline | Hard | Lines stored → yes | Cache tiers |
| Accuracy ceiling | Low | Medium–high with user amounts | High for *their* data |
| Cost | High AI every estimate | AI on change only | Subscription |
| User ownership | Full | Full | Limited |

Cegin’s niche is the middle column: **your recipes, your hardware**, not a 25k public catalog.

---

## 5. Recommended long-term stack

```
1. User-facing structured ingredients (optional normalize on edit)
2. Offline USDA (+ aliases/measures rebuild)
3. Open Food Facts optional for branded condiments
4. nutrition_data on recipe as source of truth for display
5. Popup + edit flow for missing amounts
6. Optional paid NLP only as explicit “cloud analyze” button
```

### Priority if continuing after the break

| Priority | Work | Outcome |
|----------|------|---------|
| P0 | Polish structure prompt + skipped-item UX | Fewer ghosts, clearer trust |
| P1 | Rebuild offline DB from FDC + aliases | Better matches (rice, stocks, oils) |
| P2 | Normalize-on-edit (persist structure in UI) | Estimate never needs AI if list stable |
| P3 | Open Food Facts online helper | Real bottles |
| P4 | Micronutrients in DB | Label depth |

---

## 6. Success metrics (suggested)

- % of estimates with **zero** unexpected skipped calorie-dense items (oil/soy)  
- % mass of batch from **weight/volume units** (g/ml) vs guessed counts  
- Re-estimate rate (↻) after first estimate — should fall as store + structure improve  
- Spot checks: sushi rice kcal/100g ≈ 350–370 dry; stock ≈ 0.3–0.5 kcal/ml  

---

## 7. Summary

| Question | Answer |
|----------|--------|
| Is more food data useful? | **Yes**, for match quality |
| Is more data enough? | **No** — structure + amounts dominate |
| What’s Cegin’s edge? | Personal recipes + offline + honest skips |
| What did 1.4 establish? | Structure → USDA → store; no ghost pours |
| What’s the north star? | Structured kitchen data the user can see and edit |

When work resumes, start from **P0/P1** above rather than new regex layers.
