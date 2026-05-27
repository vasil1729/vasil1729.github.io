# Walkthrough - Personal Portfolio for Vasil Abdul Razak (Zola Edition)

The personal portfolio has been fully restructured and migrated to **Zola** inside `/home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/`. All content variables are now fully decoupled from presentation layouts.

## Changes Made

### 1. Zola Configuration
- Created [config.toml](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/config.toml) configuring global metadata like site title and disabling unneeded features.

### 2. Content & Variables
- Created [content/_index.md](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/content/_index.md) storing:
  - Header data (Subtitle, location, social links).
  - Main text (Hero description, About sections).
  - Complete structured arrays for Experiences (Consultant, Functionary Lab, Knocus Solutions).
  - Project entries (Wraft, ERPNext custom integrations).
  - Skills and technologies list.
  - *To update any of your text/experience items, simply modify the TOML front-matter blocks inside this file.*

### 3. Dynamic Templating
- Created [templates/index.html](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/templates/index.html) using Tera template engine to inject variables and loop over arrays (such as skills, metrics, and experiences).

### 4. Static Files
- Relocated files inside Zola's standard folders:
  - Stylesheet: [static/styles.css](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/styles.css)
  - JS Script: [static/script.js](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/script.js)
  - Profile Image: [static/imgs/avatar.png](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/imgs/avatar.png)
  - Resume: [static/Vasil_resume_v3.pdf](file:///home/ultimatum/frontend_labs/frontend_practice/personal_portfolio/static/Vasil_resume_v3.pdf)

---

## Verification & Testing

### 1. Template Validation
- Verified with `./zola check` which successfully validated front-matter variables, syntax loops, and compiled Tera layouts without warnings.

### 2. Dev Server
- Started `./zola serve --port 8080` in the background. Zola will watch folder changes and automatically hot-rebuild.
- Access the site via **`http://localhost:8080/`** inside your web browser.
