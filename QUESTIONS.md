# Test questions

Ten questions to run against the seeded data (`npm run seed`). Ask them in the embedded widget (`npm run demo`), the dashboard **Ask tester**, or with curl. Use the **Northbridge** token unless a question says otherwise.

**Deterministic vs. LLM-dependent.** The System 1 column is produced by plain TypeScript (`src/lib/ask/system1/`), so it is always the same for the same Decomposer output. The answer wording comes from the Synthesizer LLM and will vary, but it should cite the pages listed. The Ask tester's pipeline trace shows every stage.

The rules being exercised (`src/lib/ask/system1/rules.ts`) are:
- eligible = GPA ≥ 3.0 **and** year ∈ {2, 3, 4}
- categories route to one of five policy offices

## Eligibility: multi-condition (Decomposer extracts parameters, `checkEligibility` decides)

### 1. Both conditions met
> I have a 3.2 GPA and I am a junior. Am I eligible for the merit scholarship?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "eligibility"`, `gpa: 3.2`, `year: 3`, `category: "scholarship"` |
| System 1 | `checkEligibility` → **eligible: true** ("GPA 3.2 meets the minimum of 3.0", "Year 3 is an eligible year")<br>`routePolicy("scholarship")` → `financial_aid`, **Financial Aid Office** |
| Answer | Eligible according to the rules engine, consistent with the guide's two requirements. Cites `[Northbridge Merit Scholarship Guide.pdf - Page 1]`. |

### 2. GPA fails, year passes
> I'm a sophomore with a 2.8 GPA. Can I get the Merit Scholarship?

| Stage | Expected |
|---|---|
| Decomposer | `gpa: 2.8`, `year: 2` |
| System 1 | **eligible: false**, reason "GPA 2.8 is below the minimum of 3.0" |
| Answer | Not eligible, because the guide requires a 3.0 GPA. Cites Merit Guide p. 1. It may mention that renewal and reapplication need a 3.0 (p. 2). |

### 3. GPA passes, year fails
> I'm a freshman with a 3.9 GPA. Do I qualify for the scholarship?

| Stage | Expected |
|---|---|
| Decomposer | `gpa: 3.9`, `year: 1` (freshman → 1) |
| System 1 | **eligible: false**, reason "Year 1 is not an eligible year (eligible: 2, 3, 4)" |
| Answer | Not eligible yet; first-year students can apply in their second year. Cites Merit Guide p. 1. |

### 4. Missing inputs: System 1 refuses to guess
> Am I eligible for the Merit Scholarship?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "eligibility"`, `gpa: null`, `year: null` |
| System 1 | `status: "insufficient_input"`, `missing: ["gpa", "year"]`, eligible: null |
| Answer | Asks for your GPA and year of study, and states the requirements from Merit Guide p. 1. It must **not** say "yes" or "no". |

## Structured routing (`routePolicy` chooses exactly one policy track)

### 5. Housing
> Which office handles housing policies?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "policy_choice"`, `category: "housing"` |
| System 1 | `routePolicy` → `housing`, **Housing Services** (matched by id) |
| Answer | Housing Services, located in Carver Hall. Cites `[Northbridge Student Policy Handbook.pdf - Page 2]`. |

### 6. Synonym routing
> Who do I contact if I'm accused of plagiarism?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "policy_choice"`, `category: "plagiarism"` |
| System 1 | `routePolicy("plagiarism")` → `conduct`, **Dean of Students** (matched by synonym) |
| Answer | The Dean of Students. Instructors report within 14 days and you can respond within 7 days. Cites Handbook p. 3. |

### 7. Health
> Where do I go to request a medical leave of absence?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "policy_choice"`, `category: "medical"` |
| System 1 | `routePolicy("medical")` → `health`, **Student Health Services** |
| Answer | Student Health Services: up to two semesters, with documentation from a licensed provider. Cites Handbook p. 4. |

## Knowledge retrieval (no System 1 model applies)

### 8. Facts spread across two pages
> How much is the Merit Scholarship and when is the application deadline?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "general_knowledge"` |
| System 1 | none |
| Answer | $2,500 per semester `[Northbridge Merit Scholarship Guide.pdf - Page 1]`; deadline March 15 `[Northbridge Merit Scholarship Guide.pdf - Page 2]`. |

## Not in the knowledge base

### 9. Missing information
> What is on the cafeteria lunch menu this week?

| Stage | Expected |
|---|---|
| Decomposer | `intent: "general_knowledge"` |
| System 1 | none |
| Retrieval | No chunk above the relevance threshold (likely) |
| Answer | Exactly: *"The knowledge base does not contain information to answer this question."* If nothing was retrieved, the Synthesizer is skipped entirely (trace shows `synthesizer: skipped`). The widget shows the "Not in the knowledge base" style. |

## Tenant isolation

### 10. Another organization's facts
> How much is the Lakeside Achievement Award and when is it due?

| Token | Expected |
|---|---|
| **Northbridge** token | The not-found reply. Lakeside's documents are invisible to Northbridge, because vector search is pre-filtered by `organizationId`. |
| **Lakeside** token | $1,800 per academic year, due April 30. Cites `[Lakeside Achievement Award.pdf - Page 1]`. |

Same question, two tokens, two tenants: only the token's organization's documents are ever searched.

## Extra checks
- **Lakeside eligibility:** *"I'm a senior with a 3.0 GPA, do I qualify for the Lakeside Achievement Award?"* with the Lakeside token. System 1 → eligible (3.0 is inclusive); cites the Lakeside Achievement Award p. 1.
- **Revoked token:** revoke the token on the dashboard, then ask anything in the widget. It shows "This assistant is no longer available" and the input is disabled.
- **Wrong site:** serve `demo.html` on a port the token doesn't allow (`npm run demo -- --port 5600`). The browser refuses to render the iframe, because of the `frame-ancestors` policy.

## Asking from the command line

```bash
TOKEN=ka_live_...   # from .seed-output.json
curl -s http://localhost:3000/api/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5500" \
  -H "Content-Type: application/json" \
  -d '{"question":"I have a 3.2 GPA and I am a junior. Am I eligible for the merit scholarship?"}'
```
