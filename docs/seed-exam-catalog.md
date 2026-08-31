# Seed — exam catalog (mapping decisions)

`prisma/seed.catalog.sql` seeds the full exam catalog from
`Exam_Pattern_Base_Configurations.xlsx`: **4 families, 43 exams, 122 stages, 7 subjects,
30 default base-configs, 91 section-configs**. It runs after `prisma/seed.sql` via
`pnpm db:seed`, is **idempotent** (`ON CONFLICT DO NOTHING`), and uses **stable
readable ids** (`exam_ssc_cgl`, `stage_ssc_cgl_t1`, `config_ssc_cgl_t1`,
`section_<stagekey>_<n>`, `subject_*`) — the same convention as the hand-written seed.
Regenerate it from the workbook if the workbook changes.

## What gets a config

All 122 stages are seeded as `ExamStage` catalog rows (with `mode` + `disposition`).
A `BaseConfig` + sections is created **only** for a stage that (a) has section rows in the
workbook **and** (b) is CONDUCTED or PARTIAL by mode → **30 stages**. Every one reconciles
(section-question sum == declared total). Stages that are physical/interview/skill/
psychometric/descriptive are catalog-only (no config), including `IBPS_PO_MAIN_DESC`
(descriptive, has section rows but not auto-scorable).

## Mode → (ExamMode, StageDisposition)

| Workbook Mode                          | ExamMode     | Disposition                   |
| -------------------------------------- | ------------ | ----------------------------- |
| CBT                                    | CBT          | CONDUCTED                     |
| OMR (Pen & Paper)                      | OMR          | CONDUCTED (render-only mock)  |
| CBT/OMR (Obj + Descriptive…)           | CBT/OMR      | PARTIAL (objective part only) |
| Descriptive (typed / pen&paper)        | DESCRIPTIVE  | CATALOG_ONLY                  |
| Skill Test / Skill Test (CBT) / "Test" | SKILL        | CATALOG_ONLY                  |
| CBT (Psychometric)                     | PSYCHOMETRIC | CATALOG_ONLY                  |
| Physical                               | PHYSICAL     | CATALOG_ONLY                  |
| Interview                              | INTERVIEW    | CATALOG_ONLY                  |

## Section name → canonical Subject (7)

Each section keeps its **verbatim workbook name**; `subjectId` points at one of 7 canonical
subjects (the 4 from the existing seed are reused by id/name):
`Reasoning`, `Quantitative Aptitude`, `General Awareness`, `English (Comprehension)`,
`General Science`, `General Studies`, `Computer Knowledge`. Assignment is keyword-based
(reason/intelligence→Reasoning; quant/numeric/arith/math/data→Quant; english/comprehension→
English; computer→Computer Knowledge; science/physics/chem/engineering→General Science;
"general studies"→General Studies; else→General Awareness). A few RRB technical sections
(e.g. "General Engineering", "Technical Abilities") fall into General Science / General
Awareness — imperfect but the section keeps its real name; refine later if needed.

## Field mapping

- **Ids:** readable strings (per your instruction — the schema default is cuid, but the
  established seed convention is stable readable ids; workbook Stage Keys go into
  `stageKey`/`code` columns, not the PK).
- **Languages / languageMode:** family-aware — SSC → `[EN,HI]` **DUAL** (bilingual render);
  RRB → `[EN,HI]` (+`TE` for regional) SINGLE; Banking → `[EN,HI]` SINGLE; AP&TS Police →
  `[EN,TE]` SINGLE. **Urdu is dropped** (not in `SupportedLanguage`); regional languages
  beyond Telugu are not modelled.
- **Timer:** taken from the workbook, with two safety remaps to satisfy the DB triggers
  (modules aren't seeded — decision D7a): `SESSION_MODULE_LOCKED` → `COMPOSITE_FREE`, and
  `SECTIONAL_LOCKED` is kept **only** when every section has a parsed lock duration (else
  `COMPOSITE_FREE`). All sections have `moduleId = NULL`.
- **durationSec** = stage duration (min) × 60. **totalQuestions/totalMarks** = section sums
  (display cache). Section `marksPerQuestion`, `negativeMarks`, `meritOrQualifying`,
  `patternNote` (the workbook's `{indicative}` note, read by nothing) come straight from the section rows.
- Every default config is `isDefault = true`, `version = 1`, `scoringVersion = 1`.

## Notes / follow-ups

- **Modules (D7a):** SESSION_MODULE_LOCKED papers are seeded as **separate stages per
  module-key** (e.g. `SSC_CGL_T2_P1_S1`, `SSC_CGL_T2_CKT`), matching the workbook, with flat
  configs. `BaseConfigModule` seeding can come later if the module engine is built.
- **Legacy row:** the hand-seed created a bare `SSC_CGL_T2` (`stage_ssc_cgl_t2`) stage that
  the workbook doesn't have (it splits Tier 2). It's left untouched (idempotency) and carries
  no config — retire it on the admin Exam-taxonomy screen if you want it gone.
- **Topics** are intentionally **not** seeded (the workbook's syllabus/weightage text is
  better curated than auto-parsed).
- **Approximate fields** an admin may want to confirm per config (clone to change): the
  RRB multi-language sets, the RRB technical→subject bucketing, and any pattern flagged in
  the workbook's "Verify Before Launch" sheet.
