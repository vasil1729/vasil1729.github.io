# Implementation Plan - Personal Portfolio for Vasil Abdul Razak (Zola Migration)

Migrate the personal portfolio website to use **Zola**, a fast, single-binary static site generator. This allows all content to be managed modularly via Markdown and front matter (TOML), rendering the pages dynamically using Tera templates.

## User Review Required

> [!IMPORTANT]
> - **Zola Installation**: The `zola` v0.22.1 binary has been downloaded and verified locally.
> - **Data-Driven Architecture**: Instead of hardcoding content in HTML, all portfolio data (experiences, projects, metrics, skills) will reside in the front matter of `content/_index.md`. Updating your portfolio will be as simple as editing a single Markdown file.
> - **Template rendering**: Tera templates inside the `templates/` directory will handle the rendering.

## Proposed Changes

We will restructure the repository `/home/ultimatum/frontend_labs/frontend_practice/personal_portfolio` to conform to Zola's standards:

```
├── config.toml            (Zola configuration)
├── zola                   (Prebuilt Zola binary)
├── content/
│   └── _index.md          (Data-driven portfolio content)
├── templates/
│   └── index.html         (Tera template with layout structure)
└── static/
    ├── styles.css         (Vanilla CSS styles)
    ├── script.js          (Interactive Javascript)
    ├── Vasil_resume_v3.pdf (Resume download target)
    └── imgs/
        └── avatar.png     (Profile avatar)
```

### 1. Zola Configuration

#### [NEW] [config.toml](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/config.toml)
- Define basic configuration variables: `title`, `base_url = "/"`, `compile_sass = false`, and site language specifications.

### 2. Content & Templates

#### [NEW] [_index.md](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/content/_index.md)
- Contains complete TOML front-matter (`+++` enclosures) storing all section content, metrics lists, timeline cards, project lists, and skills arrays.

#### [NEW] [index.html](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/templates/index.html)
- Main page layout rewritten using **Tera template engines**.
- Loops over `section.extra.metrics`, `section.extra.experiences`, `section.extra.projects`, `section.extra.recognition`, and `section.extra.skills` to dynamically render lists.
- Serves static assets using Zola's relative url syntax `{{ get_url(path="styles.css") | safe }}`.

### 3. Static Assets Migration

#### [MODIFY] [styles.css](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/styles.css) (moved to `static/`)
- Relocated styling file containing warm beige palette, grid alignments, and animations.

#### [MODIFY] [script.js](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/script.js) (moved to `static/`)
- Relocated interaction script for menu and reveals.

#### [MODIFY] [Vasil_resume_v3.pdf](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/Vasil_resume_v3.pdf) (moved to `static/`)
- Relocated resume file.

---

## Verification Plan

### Automated Verification
- Run `./zola check` to verify configuration, front-matter syntax, and template compilation.
- Start the Zola local dev server: `./zola serve --port 8080`.

### Manual Verification
- Access `http://localhost:8080` to verify all dynamic data renders correctly.
- Test scroll-reveal animations, responsive hamburger menu, and file downloads.
