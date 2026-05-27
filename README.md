# Vasil Abdul Razak — Personal Portfolio

A premium, highly-optimized, and responsive personal portfolio website built using the **Zola** static site generator and **Tera** templates. 

Live URL: **[https://vasil1729.github.io/](https://vasil1729.github.io/)**

## 🎨 Theme Branches

The repository features two distinct themes designed using modular CSS custom properties:
1. **`main`**: The original warm/beige/earthy design inspired by modern, minimalist interfaces.
2. **`purple-theme`**: An elegant layout using a premium lavender and purple palette.

To switch themes, checkout the respective Git branch:
```bash
git checkout main
# or
git checkout purple-theme
```

---

## 🛠️ Architecture

Instead of hardcoding details, the site is designed to be fully **data-driven**. The layout and text content are separated cleanly:
- **Site Settings**: Configuration details like title and base URLs are defined in `config.toml`.
- **Website Content**: All biography text, metrics lists, professional timeline entries, project cards, and tech stack categories are defined in the front matter (TOML) of [content/_index.md](content/_index.md).
- **Structure**: Tera template layout logic is located in [templates/index.html](templates/index.html).
- **Styles**: Vanilla CSS is located in [static/styles.css](static/styles.css).

---

## 🚀 Local Development

Ensure you have Zola installed. (An x86_64 Linux binary `./zola` is included in the root folder).

1. **Start the local hot-reloading dev server**:
   ```bash
   ./zola serve --port 8080
   ```
   Open `http://localhost:8080` in your web browser. Any changes to markdown contents or template layouts will compile and refresh instantly.

2. **Validate syntax and template compilation**:
   ```bash
   ./zola check
   ```

3. **Build the production static assets**:
   ```bash
   ./zola build
   ```
   This will output the compiled website inside the `public/` directory.

---

## 📦 Deployment

Deploys automatically to **GitHub Pages** on every push to the `main` branch. 
- Deployment configurations are handled via GitHub Actions in [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
- The workflow installs Zola, compiles the project, and deploys it natively to Pages.
