+++
title = "Vasil Abdul Razak | Backend Engineer & Open-Source Contributor"
template = "index.html"

[extra]
subtitle = "Backend Engineer · Open-Source Contributor"
location = "Kerala, India"
phone = "+91 88912 85207"
email = "vazthesoftwareengg@gmail.com"
github = "vasil1729"
linkedin = "vasil-abdul-razak"

hero_title = "Scalable automation platforms & real-time systems."
hero_description = "Vasil Abdul Razak is a Backend Engineer with 5+ years of experience building enterprise-grade automation platforms. As a core contributor and backend owner of Wraft—an open-source document lifecycle automation platform—he specializes in distributed systems, real-time collaboration engines, cryptographic document signing, and background workflow pipelines using Elixir/Phoenix, Go, and Rust."

metrics = [
  { val = "5+ Years", label = "building production-ready, scalable platforms" },
  { val = "120+ Stars", label = "earned on Wraft open-source repository" },
  { val = "50K+ Lines", label = "of robust production backend code authored" },
  { val = "270+ Commits", label = "driving Wraft from MVP to enterprise scale" }
]

about_title = "Architecting backend systems for real-world complexity."
about_description = "Bridging the gap between low-level performance and user-centric collaboration. Specialized in building concurrency-friendly backends, multi-tenant databases, real-time message sync, and automated compliance pipelines."
about_background_title = "Scalable architecture from day one."
about_background_p1 = "Vasil's experience extends from co-founding content-sharing platforms to architecting multi-tenant document workflows. He builds systems that carry enterprise data, handle concurrent inputs under high load, and remain reliable in mission-critical pipelines."
about_background_p2 = "At Wraft, he led the backend effort from early-stage MVP to a production-ready system capable of hosting 270+ active communities. This operational rigor extends into his freelance consulting work, delivering high-performance accounting and automation modules."

quote = "Currently building a book-parsing and translation engine — inspired by a Google Stitch prototype — to make Mughal-era Urdu/Persian works and Sanskrit and Arabic theological texts readable end-to-end in English and Indic languages. Recent LLM translation quality is finally good enough that translating the whole book is more useful than learning the source language. The EPUB reader in Side Projects is the first working slice: real books, real readers, offline translation across the exact language pairs I care about."

experiences = [
  { date = "Dec 2024 – Present", company = "Independent Consultant", role = "Freelance Backend Engineer", desc = "Delivering backend engineering solutions for ERP-focused systems and business automation platforms, optimizing workflows for performance and data consistency.", bullets = [
    "Developing and extending ERPNext/Frappe modules to support complex accounting workflows, reporting systems, and operational automation.",
    "Building scalable backend services and API integrations using Node.js to connect ERP systems with third-party platforms.",
    "Providing technical consultation on database schema design, queries, and performance optimization for business-critical applications."
  ] },
  { date = "Jan 2022 – Nov 2024", company = "Functionary Lab", role = "Founding Engineer / Backend Engineer", location = "Bangalore, India", desc = "Served as the core contributor and backend owner of Wraft, driving the software architecture from inception to enterprise deployment.", bullets = [
    "Designed foundational backend using Elixir/Phoenix, including role-based access control (RBAC), multi-tenant authorization, and secure data isolation.",
    "Built real-time collaborative editing engine and form builder backend using Phoenix Channels and WebSockets for conflict-free live synchronization.",
    "Architected and shipped a scalable multi-organization onboarding structure supporting 270+ active communities.",
    "Developed extensible workflow pipelines using Oban to orchestrate document approvals and complex state transitions.",
    "Implemented secure document signing and PDF processing pipelines using Elixir NIFs (Native Implemented Functions), Rust, and Java."
  ] },
  { date = "2019 – 2020", company = "Knocus Solutions PVT LTD", role = "Founding Engineer / Backend Engineer", location = "Hyderabad, India", desc = "Co-founded and drove product development for a collaborative online platform designed for creating and sharing stories, poems, and articles.", bullets = [
    "Designed and built high-performance, real-time communication systems using Go (Golang) and WebSockets.",
    "Developed robust REST APIs and managed PostgreSQL databases for dynamic content retrieval and user management."
  ] }
]

projects = [
  { title = "Wraft DLM Platform", category = "Document Lifecycle Management", desc = "An open-source document lifecycle automation system that treats documents like code—structured, version-controlled, and highly collaborative. Showcased at IndiaFOSS 2025.", bullets = [
    "Real-time collaborative editing using Phoenix Channels/WebSockets for conflict-free multi-user authoring.",
    "Extensible workflow engine built on top of Oban pipelines with granular state management.",
    "Cryptographic document signing and PDF processing utilizing high-performance Elixir NIFs and Rust."
  ], github = "https://github.com/wraft/wraft" },
  { title = "Accounting Collaboration Platform", category = "Multi-tenant ERPNext Integration", desc = "A platform that lets accounting firms collaborate with their clients on top of ERPNext—unifying task management, document exchange, and real-time notifications across multiple client instances behind a single interface.", bullets = [
    "Multi-tenant model where a single user can work across many client/company ERPNext instances through scoped access grants.",
    "Proxies live accounting data (invoices, journal entries, ledgers) from each client's ERPNext while owning task and comment workflows internally.",
    "Task-based workflow with comments, status transitions, audit trails, and cross-platform push notifications."
  ] }
]

side_projects = [
  { title = "LocalTube Audio", category = "Android · Rust + Dioxus", desc = "A local-first Android app that turns any YouTube URL into a 320 kbps MP3 with embedded album art. No backend, no ads, no tracking—everything runs on device.", stack = ["Rust", "Dioxus", "JNI", "NewPipe Extractor", "FFmpegKit", "Kotlin", "Gradle 9", "Material You"], bullets = [
    "Rust UI compiled with Dioxus and cross-compiled to aarch64-linux-android, packaged into a single APK.",
    "Calls into NewPipe Extractor (Java) and FFmpegKit (native) over JNI via the `jni` crate, with Kotlin injection bridging the Android lifecycle.",
    "Persistent download queue with animated progress and a dark Material You UI."
  ] },
  { title = "EPUB Reader", category = "Android · Flutter", desc = "A production-grade EPUB 2/3 reader with a full library, dual reading modes, and fully offline translation across 57 languages including Persian, Urdu, Arabic, and Hindi.", stack = ["Flutter", "Dart", "Google ML Kit", "CSS Columns", "SQLite"], bullets = [
    "Library with auto-scan, grid/list views, cover thumbnails, sorting, and per-chapter persistent reading position.",
    "Reader supports continuous-scroll and CSS-column paged modes, 13 themes (Solarized, Gruvbox, Dracula, Tokyo Night…), and full font/size/family controls.",
    "On-device ML Kit translation with RTL rendering, per-chapter translation cache, and an original ↔ translated toggle.",
    "Selection action bar with Copy and a conditional “Ask ChatGPT” action that appears only when the ChatGPT app is installed."
  ] }
]

recognition = [
  { title = "Wraft Featured at IndiaFOSS 2025", desc = "Showcased as an emerging open-source document automation platform at India’s premier FOSS conference, demonstrating community adoption." },
  { title = "B.Tech in Electronics & Communication", desc = "Indian Institute of Information Technology, Sri City (2014 – 2018)." }
]

skills = [
  { category = "Languages", tags = ["Elixir", "Go (Golang)", "Rust", "Python", "Java", "C/C++", "JavaScript"] },
  { category = "Backend & Databases", tags = ["Phoenix", "Ecto", "Oban", "Node.js", "PostgreSQL", "Redis", "Valkey"] },
  { category = "DevOps & Tools", tags = ["Kubernetes", "Docker", "GitHub Actions", "GitLab CI/CD", "WebSockets", "Pandoc", "LaTeX"] }
]
+++
