+++
title = "Inside Wraft: How We Built Digital Signing, PDF Analysis, and the Elixir-Rust-Java Bridge"
description = "A deep architectural walkthrough of Wraft's digital signing pipeline — from Rust NIFs that parse PDF geometry, through Java signing JARs, to Elixir/Oban workflow orchestration — and how every piece connects."
date = 2026-06-15
updated = 2026-06-17
tags = ["elixir", "rust", "pdf", "digital-signing", "nif", "architecture", "wraft"]

[extra]
generated = true
canonical = ""
+++

## The Problem

Documents in a contract lifecycle platform don't just need to look right — they need to be *signed*. Not with a drawn-on squiggle that anyone can paste, but with cryptographic digital signatures that bind identity to the document, and visual signatures that place a signatory's handwritten image at the exact coordinates the template designer intended.

Wraft is an open-source document lifecycle management platform ([github.com/wraft/wraft](https://github.com/wraft/wraft)) built primarily in Elixir/Phoenix. The signing pipeline touches three language runtimes — Elixir, Rust, and Java — and orchestrates them through Oban background workers, MinIO object storage, and Pandoc/Typst rendering engines. This post breaks down every layer.

---

## High-Level Architecture

{% mermaid() %}
flowchart TD
    subgraph Elixir["Elixir / Phoenix"]
        DI["Documents Instance"]
        SC["Signatures Context"]
        CP["CounterParty (signers)"]
        EN["Engine (Typst / LaTeX)"]
        PA["PdfAnalyzer (Rust NIF)"]
        OW["Oban Workers"]
    end

    subgraph Java["Java JARs"]
        VS["VisualSignerApp"]
        DS["DigitalSignerApp"]
    end

    subgraph Storage["MinIO Storage"]
        PDF["PDF files"]
    end

    DI --> SC
    SC --> CP
    DI --> EN
    SC --> PA
    SC --> Java
    Java --> Storage
    PA --> SC
    EN --> DI
    SC --> OW
    OW -->|"emails, notifications"| CP

    style Elixir fill:#e8f0f7,stroke:#546575,color:#16202c
    style Java fill:#d9e5f0,stroke:#546575,color:#16202c
    style Storage fill:#e2ebf4,stroke:#546575,color:#16202c
{% end %}

The flow is:

1. **Generate** a PDF from the template engine (Typst or LaTeX via Pandoc).
2. **Analyze** the PDF with the Rust NIF to find signature placeholder rectangles.
3. **Create** `ESignature` entries with the extracted coordinates.
4. **Assign** counterparties (signers) to those signature slots.
5. **Visual sign** — each counterparty uploads their handwritten image; Java stamps it onto the PDF at the exact coordinates.
6. **Digital sign** — after all visual signatures are placed, Java applies a PKCS#7 cryptographic signature with a keystore-backed certificate, attaching a signing certificate page.
7. **Finalize** — mark the document as fully signed, upload to MinIO, notify all parties.

---

<details>
<summary>Layer 1: Document Instance & State Machine</summary>

The core entity is `WraftDoc.Documents.Instance` ([`lib/wraft_doc/documents/instance.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/instance.ex)) — every document version is one, holding the rendered content, signature and approval flags, document type, and a pointer to the current `Flow.State` in the workflow state machine.

</details>

---

<details>
<summary>Layer 2: The Rust PDF Analyzer NIF</summary>

This is the most technically interesting piece. Wraft needs to know *where* signature fields are placed in the generated PDF — not at the template level, but at the rendered pixel-coordinate level, because PDF coordinate systems differ between engines.

### Why Rust?

PDF parsing is CPU-intensive. Elixir is not built for tight-loop binary processing. A Rust NIF (Native Implemented Function) compiled via [Rustler](https://rustler.nz/) gives us:

- **Zero-copy interop** — Rust runs in the same BEAM process, no port/IPC overhead
- **Speed** — `lopdf` parses and walks PDF content streams in microseconds
- **Safety** — Rust's ownership model prevents the class of NIF crashes that would bring down the BEAM VM

### The Crate: `native/pdf_analyzer/`

```
native/pdf_analyzer/
├── Cargo.toml          # rustler 0.37, lopdf 0.39, serde, flate2
├── src/
│   ├── lib.rs          # NIF entrypoint + dispatch
│   ├── common.rs       # Shared types (RectangleData, GraphicsState, etc.)
│   ├── typst.rs        # Typst engine analysis
│   └── latex.rs        # LaTeX engine analysis (annotation-based)
```

#### `lib.rs` — The NIF Entry Point

```rust
#[rustler::nif(name = "analyze_pdf_nif")]
fn analyze_pdf_nif<'a>(env: Env<'a>, path: &str,
    _target_fill_color: Option<&str>,
    _target_stroke_color: Option<&str>,
    engine: Option<&str>) -> NifResult<Term<'a>>
```

It dispatches to either `typst::analyze_pdf_typst` or `latex::analyze_pdf_latex` based on the `engine` parameter, serializes the result to JSON, and returns `{:ok, json_string}` or `{:error, reason}` — idiomatic Elixir tuples from Rust.

On the Elixir side, `WraftDoc.PdfAnalyzer` ([`lib/wraft_doc/pdf_analyzer.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/pdf_analyzer.ex)) wraps this:

```elixir
use Rustler, otp_app: :wraft_doc, crate: "pdf_analyzer", mode: :release

def analyze_pdf(path, engine) do
  analyze_pdf_nif(path, nil, nil, engine)
end
```

### NIF Internals: How the PDF Gets Parsed

{% mermaid() %}
flowchart TD
    PDF["PDF Document"] --> Load["lopdf::Document::load"]
    Load --> Pages["Iterate pages"]
    Pages --> StreamCheck{"Contents entry?"}
    StreamCheck -->|"Reference"| RefResolve["Resolve indirect ref"]
    StreamCheck -->|"Array"| IterArr["Iterate stream refs"]
    StreamCheck -->|"Fallback"| PageContent["get_page_content"]
    RefResolve --> Decompress
    IterArr --> Decompress["Decompress stream"]
    PageContent --> Decode["Content::decode"]
    Decompress --> Decode
    Decode --> Ops["Walk operations"]
    Ops --> GraphicsState

    subgraph GraphicsState["Graphics State Machine"]
        PushPop["q / Q push & pop state stack"]
        Cm["cm compose transformation matrix"]
        ColorOps["rg/RG/g/G/scn/SCN set fill & stroke colors"]
        RectOp["re record rectangle + transform coords"]
        TfOp["Tf track current font"]
    end

    GraphicsState --> Match{"Color matches target?"}
    Match -->|"Yes"| Record["Record RectangleData"]
    Match -->|"No"| Skip["Skip"]
    Record --> Result["DocumentAnalysisResult"]
    Skip --> Ops

    style PDF fill:#e8f0f7,stroke:#546575,color:#16202c
    style GraphicsState fill:#d9e5f0,stroke:#546575,color:#16202c
    style Result fill:#e2ebf4,stroke:#546575,color:#16202c
{% end %}

#### `typst.rs` — Content Stream Geometry

Typst renders signature placeholders as colored rectangles with specific fill (`RGB(214, 255, 244)`) and stroke (`RGB(0, 184, 148)`) colors. The Typst analyzer:

1. Loads the PDF with `lopdf::Document::load`
2. Iterates every page, extracting the `Contents` stream
3. Decompresses and decodes the PDF content stream operations
4. Maintains a **graphics state stack** (`q`/`Q` operators) and a **transformation matrix stack** (`cm` operator)
5. Tracks fill/stroke colors through `rg`, `RG`, `g`, `G`, `scn`, `SCN` operators with color space awareness (DeviceRGB, DeviceGray, sRGB, d65gray)
6. On each `re` (rectangle) operator, applies the current transformation matrix to the coordinates, checks if the fill/stroke colors match the target, and if so, records a `RectangleData` with page number, position, dimensions, corners, colors, and operation type (Fill, Stroke, Fill+Stroke)

The transformation matrix multiplication is critical — PDFs use a bottom-left origin with arbitrary affine transforms. The analyzer correctly composes matrices so that nested `q`/`Q` save/restore blocks produce accurate screen coordinates.

#### `latex.rs` — Annotation-Based Detection

LaTeX/Pandoc takes a different approach. Instead of colored rectangles in the content stream, it embeds **PDF annotation widgets** of type `/Sig` (signature fields) — the standard PDF form-field mechanism for digital signatures.

The LaTeX analyzer:

1. Loads the PDF with `lopdf`
2. Iterates pages and their `/Annots` arrays
3. Resolves annotation references (direct dictionaries or indirect references)
4. Filters for annotations where `FT` (field type) is `/Sig`
5. Reads the `/Rect` array (4 floats: x1, y1, x2, y2) from each signature annotation
6. Returns `RectangleData` with `operation_type: "SignatureField"`

This dual-engine approach means the same `PdfAnalyzer.analyze_pdf/2` API works whether the template was rendered by Typst (colored-rectangle convention) or LaTeX (AcroForm signature field convention).

</details>

---

<details>
<summary>Layer 3: Signature Data Model</summary>

{% mermaid() %}
erDiagram
    INSTANCE ||--o{ E_SIGNATURE : "has"
    INSTANCE ||--o{ COUNTER_PARTY : "has"
    COUNTER_PARTY ||--o{ E_SIGNATURE : "assigned to"
    E_SIGNATURE {
        uuid content_id FK
        uuid user_id FK
        uuid counter_party_id FK
        enum signature_type
        map signature_data
        map signature_position
        string signed_file
        string verification_token
        boolean is_valid
    }
    COUNTER_PARTY {
        string name
        string email
        enum signature_status
        datetime signature_date
        string signature_ip
        string device
        string signed_file
        map color_rgb
    }
    INSTANCE {
        string instance_id
        string raw
        map serialized
        boolean signature_status
        boolean approval_status
        integer type
    }
{% end %}

### `ESignature` Schema

[`lib/wraft_doc/documents/e_signature.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/e_signature.ex)

```elixir
schema "e_signature" do
  field :signature_type, Ecto.Enum, values: [:digital, :electronic, :handwritten]
  field :signature_data, :map          # %{page: 1, coordinates: %{x1: ..., y1: ..., x2: ..., y2: ...}}
  field :signature_position, :map     # same as coordinates, denormalized for quick access
  field :signed_file, :string         # MinIO path after signing
  field :verification_token, :string  # for email-based signer verification
  field :is_valid, :boolean           # validation flag
  field :ip_address, :string
  belongs_to :content, Instance
  belongs_to :user, User
  belongs_to :counter_party, CounterParty
end
```

### `CounterParty` Schema

[`lib/wraft_doc/counter_parties/counter_party.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/counter_parties/counter_party.ex)

Each signer is a CounterParty with:

- `signature_status` — `:pending → :accepted → :signed`
- `signature_date`, `signature_ip`, `device` — audit trail
- `signature_image` — uploaded handwritten image (stored via Waffle in MinIO)
- `signed_file` — the MinIO path to the resulting signed PDF
- `color_rgb` — validation ensures the assigned color is in the 200-255 range (light colors only, so the signature image is visible over it)

A counterparty can have multiple `ESignature` entries (one per signature field on the document). The unique constraint `e_signature_content_id_counter_party_id_index` prevents duplicate signature assignments.

</details>

---

<details>
<summary>Layer 4: The Signing Pipeline</summary>

[`lib/wraft_doc/documents/signatures.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/signatures.ex) — the central orchestrator.

### Phase 1: `generate_signature/2` — Discover Signature Fields

This is the entry point when a user initiates signing on a document instance:

1. **Clean slate** — Delete existing `ESignature` and `CounterParty` entries for the instance, reset `signature_status` to `false`, delete the old signed PDF from MinIO
2. **Build the PDF** — Call `Documents.build_doc(instance, layout, sign: true)` to render the template with signature placeholders
3. **Analyze the PDF** — Call `PdfAnalyzer.analyze_pdf(pdf_path, engine_type)` where `engine_type` is determined by the layout's engine (`"Pandoc + Typst"` → `"typst"`, `"Pandoc"` → `"latex"`)
4. **Extract signature fields** — Parse the JSON result, map each rectangle into `%{page, dimensions, coordinates}` structs
5. **Create `ESignature` entries** — Insert one `ESignature` per detected field, with `signature_type: :electronic` and `counter_party_id: nil` (unassigned, waiting for a signer)

### Phase 2: `apply_visual_signature_to_document/4` — Stamp the Image

When a counterparty signs:

1. **Guard clauses** — Reject if: no signatures assigned, already signed, or document fully signed
2. **Download or fetch the PDF** — If a partially-signed PDF exists in MinIO, download it; otherwise download the original
3. **Build coordinates JSON** — From the counterparty's `ESignature` entries, extract `%{page, x1, y1, x2, y2}` and JSON-encode them
4. **Call Java VisualSignerApp** — `System.cmd("java", ["-cp", pdf_signer_jar, "com.wraft.VisualSignerApp", "--input", pdf_path, "--signature", signature_image_path, "--output", signed_pdf_path, "--coordinates-json-string", coordinates])`
5. **Upload to MinIO** — `Minio.upload_file(signed_pdf_path)`
6. **Notify the document owner** — Enqueue `EmailWorker` job with `notify_document_owner_signature_complete` tag
7. **Cleanup** — If this isn't the last signer, delete the local PDF file (the signed version lives in MinIO for the next signer to download and layer on)

### Phase 3: `apply_digital_signature_to_document/3` — Cryptographic Seal

When the last counterparty visually signs (`document_signed?/1` returns `true`):

1. **Generate a signing certificate** — Build a Markdown document listing all signers (name, email, auth level, IP, device, signed-at timestamp, reason, and signature image path). Render it to PDF via `pandoc --template=certificate.html --pdf-engine=wkhtmltopdf`
2. **Call Java DigitalSignerApp** — `System.cmd("java", ["-cp", signature_jar_file, "com.wraft.DigitalSignerApp", "--input", pdf_path, "--output", signed_pdf_path, "--keystore", keystore_file, "--keystore-password", ..., "--certificate", certificate_path])`
3. This applies a PKCS#7 digital signature using a Java keystore, embedding the certificate page into the PDF
4. **Upload to MinIO** — The final, cryptographically signed PDF
5. **Mark counterparties as signed** — Update `CounterParty.sign_changeset` with `signed_file` path
6. **Finalize** — Set `instance.signature_status = true`, send "document fully signed" emails and in-app notifications to all parties
7. **Cleanup** — Remove local files

### The Java Layer

Two JAR applications handle the actual PDF manipulation:

- **`com.wraft.VisualSignerApp`** — Accepts `--input`, `--signature` (image path), `--output`, and `--coordinates-json-string`. Stamps the signature image at each specified page/rectangle coordinate. Coordinates use bottom-left origin (PDF convention).

- **`com.wraft.DigitalSignerApp`** — Accepts `--input`, `--output`, `--keystore`, `--keystore-password`, `--key-alias`, `--reason`, `--location`, and `--certificate`. Applies a PKCS#7 cryptographic digital signature using the provided keystore and attaches the certificate page.

Why Java? The Apache PDFBox and BouncyCastle libraries provide mature, well-tested implementations for PDF signature manipulation and PKCS#7 that have no equivalent in the Elixir ecosystem. The `System.cmd("java", ...)` call is a pragmatic bridge — the signing operation is I/O-bound (reading/writing the PDF), not latency-sensitive, so the subprocess overhead is negligible.

</details>

---

<details>
<summary>Layer 5: Workflow & Approval Pipelines</summary>

Signing doesn't happen in isolation. Documents go through approval workflows before they're ready for signing.

### Pipeline Stages

[`lib/wraft_doc/pipelines/stages/stage.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/pipelines/stages/stage.ex)

A `Stage` links a `ContentType`, `DataTemplate`, `Pipeline`, and `State` together. Stages form the steps of a document pipeline — each stage represents a state transition in the workflow, optionally with a form that must be filled and a data template for the document fields.

### Approval System

[`lib/wraft_doc/documents/approval.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/approval.ex)

A document `Instance` lives at a `Flow.State` inside a `Flow` defined in [`lib/wraft_doc/organisation/flow.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/organisation/flow.ex). Each approval action is recorded as a row in `WraftDoc.Documents.InstanceTransitionLog` ([`lib/wraft_doc/documents/instance_transition_log.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/instance_transition_log.ex)) with `from_state_id`, `to_state_id`, `reviewer_id`, `review_status` (`:approved` or `:rejected`), and `reviewed_at`. `WraftDoc.Documents.Approval.get_document_approval_history/1` reads those transition rows in reverse chronological order, preloading the destination `Flow.State` and the reviewer's profile.

The approval workflow uses Oban workers (`EmailWorker`, `ReminderWorker`) to send approval requests and reminders. A document must clear all approvals before it enters the signing phase.

### Oban Workers

The workers directory ([`lib/wraft_doc/workers/`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/workers/)) contains:

- **`EmailWorker`** — Sends signature request emails, signing-complete notifications, fully-signed notifications
- **`ReminderWorker`** — Follows up on pending approvals
- **`PdfMetadataWorker`** — Extracts PDF metadata (title, author, creation date) asynchronously
- **`BulkWorker`** — Handles bulk document generation
- **`CloudImportWorker`** — Imports documents from external cloud storage
- **`WebhookWorker`** / **`AdminWebhookWorker`** — Dispatches webhook notifications on document events

</details>

---

<details>
<summary>Layer 6: Storage & File Management</summary>

### MinIO

All PDFs (original, partially-signed, fully-signed) live in MinIO (S3-compatible), organized as:

```
organisations/{org_id}/contents/{instance_id}/
  ├── {instance_id}.pdf              # original rendered PDF
  ├── signed_{instance_id}.pdf       # signed version
  └── certificate.pdf                # signing certificate (temporary)
```

The `get_or_download_pdf/3` helper in `Signatures` checks MinIO first — if a signed PDF already exists (from a previous counterparty's visual signature), it downloads that as the base for the next signature. This layering approach means each signer stamps on top of the previous signer's work.

</details>

---

## The Complete Signing Flow — End to End

{% mermaid() %}
flowchart TD
    A["1. User clicks 'Generate Signature'"] --> B["2. Wraft builds PDF<br/>(Typst or LaTeX engine)"]
    B --> C["3. Rust NIF analyzes PDF<br/>Finds signature placeholders"]
    C --> D["4. ESignature entries created<br/>with page + coordinate data"]
    D --> E["5. User assigns CounterParties<br/>(signers) to signature slots"]
    E --> F["Email with verification<br/>token sent to each signer"]
    F --> G["6. Signer opens link<br/>Uploads handwritten signature image"]
    G --> H["7. Java VisualSignerApp<br/>stamps image at coordinates on PDF"]
    H --> I{"Last signer?"}
    I -->|"No"| J["PDF uploaded to MinIO<br/>Owner notified<br/>Next signer downloads"]
    I -->|"Yes"| K["8. Generate certificate page<br/>(Pandoc + wkhtmltopdf)"]
    K --> L["9. Java DigitalSignerApp<br/>applies PKCS#7 signature"]
    L --> M["instance.signature_status = true<br/>All parties notified"]
    M --> N["10. Final signed PDF<br/>stored in MinIO<br/>Complete audit trail"]

    J --> F

    style A fill:#e8f0f7,stroke:#546575,color:#16202c
    style C fill:#d9e5f0,stroke:#546575,color:#16202c
    style H fill:#cddbe9,stroke:#546575,color:#16202c
    style L fill:#cddbe9,stroke:#546575,color:#16202c
    style N fill:#e2ebf4,stroke:#546575,color:#16202c
{% end %}

---

<details>
<summary>Design Decisions & Tradeoffs</summary>

### Why three languages?

| Concern | Language | Reason |
|---------|----------|--------|
| Business logic, web layer, orchestration | Elixir | Phoenix, Oban, Ecto, real-time channels |
| CPU-intensive PDF parsing | Rust | Performance + memory safety as a NIF |
| PKCS#7 signing + visual stamping | Java | PDFBox/BouncyCastle — no Elixir equivalent |

{% mermaid() %}
flowchart LR
    subgraph Polyglot["Language Boundaries"]
        direction LR
        EX["Elixir<br/>Orchestration<br/>Oban, Phoenix, Ecto"]
        RU["Rust<br/>CPU Parsing<br/>lopdf NIF, in-process"]
        JA["Java<br/>Crypto Signing<br/>PDFBox, BouncyCastle"]
        MI["MinIO<br/>Shared File Store"]
    end

    EX -->|"NIF call<br/>sub-microsecond"| RU
    EX -->|"System.cmd<br/>subprocess"| JA
    RU -->|"JSON result"| EX
    JA -->|"signed PDF"| MI
    EX -->|"upload/download"| MI

    style Polyglot fill:none,stroke:#546575,color:#16202c
    style EX fill:#e8f0f7,stroke:#546575,color:#16202c
    style RU fill:#d9e5f0,stroke:#546575,color:#16202c
    style JA fill:#e2ebf4,stroke:#546575,color:#16202c
    style MI fill:#cddbe9,stroke:#546575,color:#16202c
{% end %}

Each language is used where it's strongest. The interop cost is minimal: Rust runs in-process via NIF (sub-microsecond call overhead), Java runs as a subprocess (acceptable for I/O-bound signing operations that take hundreds of milliseconds anyway).

### Why not a Rust signing implementation?

PKCS#7 and PDF signature dictionaries have subtle compliance requirements (PAdES, ETSI). The Java ecosystem has battle-tested libraries for this. Rewriting in Rust would be a significant effort with no practical performance gain — signing is not a hot path.

### Why colored rectangles for Typst?

Typst doesn't natively output AcroForm fields. The convention of using specific fill/stroke colors as "signature zone markers" is a practical workaround: the template author places a colored rectangle, and the Rust analyzer identifies it by color match. The `color_rgb` validation on CounterParty (200-255 range for R, G, B) ensures the assigned colors are light enough for the signature image to be legible.

</details>

---

## Key Source Files Reference

| Component | File |
|-----------|------|
| Rust NIF entry point | [`native/pdf_analyzer/src/lib.rs`](https://github.com/wraft/wraft/blob/main/native/pdf_analyzer/src/lib.rs) |
| Typst rectangle analyzer | [`native/pdf_analyzer/src/typst.rs`](https://github.com/wraft/wraft/blob/main/native/pdf_analyzer/src/typst.rs) |
| LaTeX annotation detector | [`native/pdf_analyzer/src/latex.rs`](https://github.com/wraft/wraft/blob/main/native/pdf_analyzer/src/latex.rs) |
| Shared types & graphics state | [`native/pdf_analyzer/src/common.rs`](https://github.com/wraft/wraft/blob/main/native/pdf_analyzer/src/common.rs) |
| Elixir NIF wrapper | [`lib/wraft_doc/pdf_analyzer.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/pdf_analyzer.ex) |
| Signing orchestrator | [`lib/wraft_doc/documents/signatures.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/signatures.ex) |
| E-Signature schema | [`lib/wraft_doc/documents/e_signature.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/e_signature.ex) |
| CounterParty (signer) schema | [`lib/wraft_doc/counter_parties/counter_party.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/counter_parties/counter_party.ex) |
| Document instance schema | [`lib/wraft_doc/documents/instance.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/instance.ex) |
| Approval context | [`lib/wraft_doc/documents/approval.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/approval.ex) |
| Approval transition log | [`lib/wraft_doc/documents/instance_transition_log.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/documents/instance_transition_log.ex) |
| Pipeline stage model | [`lib/wraft_doc/pipelines/stages/stage.ex`](https://github.com/wraft/wraft/blob/main/lib/wraft_doc/pipelines/stages/stage.ex) |
| Oban workers | [`lib/wraft_doc/workers/`](https://github.com/wraft/wraft/tree/main/lib/wraft_doc/workers/) |

---

## Closing Thought

The Wraft signing pipeline is a study in pragmatic polyglot architecture. Elixir owns the orchestration because Oban and Phoenix Channels make workflow and real-time collaboration natural. Rust owns the parsing because NIF performance matters when you're walking every operation in a PDF content stream. Java owns the signing because compliance-grade cryptographic libraries don't exist in the BEAM ecosystem. The seams between them — NIF calls, `System.cmd`, MinIO as the shared file store — are chosen deliberately at natural boundaries in the pipeline. No language is doing another language's job.