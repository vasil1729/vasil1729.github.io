document.addEventListener("DOMContentLoaded", () => {
  var savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.className = savedTheme;

  function currentTheme() {
    return document.documentElement.className;
  }

  function applyTheme(name) {
    document.documentElement.className = name;
    localStorage.setItem("theme", name);
    if (window.mermaid) {
      var vars = themeMermaidVars(name);
      mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: vars });
      mermaid.run({ querySelector: ".mermaid", suppressErrors: true });
    }
  }

  function themeMermaidVars(name) {
    var palettes = {
      light:         { primary: "#e8f0f7", text: "#16202c", border: "#546575", line: "#546575", secondary: "#d9e5f0", tertiary: "#e2ebf4", mainBkg: "#e8f0f7", nodeBorder: "#546575", clusterBkg: "rgba(255,255,255,0.60)", clusterBorder: "rgba(46,80,144,0.20)", title: "#16202c", edgeLabel: "#e8f0f7", nodeText: "#16202c" },
      dark:          { primary: "#2d2824", text: "#f0e8dc", border: "#9a8876", line: "#9a8876", secondary: "#1e1a16", tertiary: "#1a1714", mainBkg: "#2d2824", nodeBorder: "#9a8876", clusterBkg: "rgba(45,40,36,0.72)", clusterBorder: "rgba(154,136,118,0.18)", title: "#f0e8dc", edgeLabel: "#2d2824", nodeText: "#f0e8dc" },
      catppuccin:    { primary: "#181825", text: "#cdd6f4", border: "#6c7086", line: "#6c7086", secondary: "#11111b", tertiary: "#11111b", mainBkg: "#181825", nodeBorder: "#6c7086", clusterBkg: "rgba(24,24,37,0.72)", clusterBorder: "rgba(108,112,134,0.2)", title: "#cdd6f4", edgeLabel: "#181825", nodeText: "#cdd6f4" },
      "tokyo-night": { primary: "#16161e", text: "#a9b1d6", border: "#565f89", line: "#565f89", secondary: "#13141d", tertiary: "#13141d", mainBkg: "#16161e", nodeBorder: "#565f89", clusterBkg: "rgba(22,22,30,0.72)", clusterBorder: "rgba(86,95,137,0.2)", title: "#a9b1d6", edgeLabel: "#16161e", nodeText: "#a9b1d6" },
      dracula:       { primary: "#21222c", text: "#f8f8f2", border: "#6272a4", line: "#6272a4", secondary: "#191a21", tertiary: "#191a21", mainBkg: "#21222c", nodeBorder: "#6272a4", clusterBkg: "rgba(33,34,44,0.72)", clusterBorder: "rgba(98,114,164,0.2)", title: "#f8f8f2", edgeLabel: "#21222c", nodeText: "#f8f8f2" },
      nord:          { primary: "#242933", text: "#eceff4", border: "#81a1c1", line: "#81a1c1", secondary: "#1e232b", tertiary: "#1e232b", mainBkg: "#242933", nodeBorder: "#81a1c1", clusterBkg: "rgba(36,41,51,0.72)", clusterBorder: "rgba(129,161,193,0.2)", title: "#eceff4", edgeLabel: "#242933", nodeText: "#eceff4" },
      gruvbox:       { primary: "#1d2021", text: "#ebdbb2", border: "#a89984", line: "#a89984", secondary: "#181818", tertiary: "#181818", mainBkg: "#1d2021", nodeBorder: "#a89984", clusterBkg: "rgba(29,32,33,0.72)", clusterBorder: "rgba(168,152,132,0.2)", title: "#ebdbb2", edgeLabel: "#1d2021", nodeText: "#ebdbb2" },
      "rose-pine":   { primary: "#13111d", text: "#e0def4", border: "#6e6a86", line: "#6e6a86", secondary: "#0f0d1a", tertiary: "#0f0d1a", mainBkg: "#13111d", nodeBorder: "#6e6a86", clusterBkg: "rgba(19,17,29,0.72)", clusterBorder: "rgba(110,106,134,0.2)", title: "#e0def4", edgeLabel: "#13111d", nodeText: "#e0def4" },
    };
    var p = palettes[name] || palettes.light;
    return {
      primaryColor: p.primary,
      primaryTextColor: p.text,
      primaryBorderColor: p.border,
      lineColor: p.line,
      secondaryColor: p.secondary,
      tertiaryColor: p.tertiary,
      mainBkg: p.mainBkg,
      nodeBorder: p.nodeBorder,
      clusterBkg: p.clusterBkg,
      clusterBorder: p.clusterBorder,
      titleColor: p.title,
      edgeLabelBackground: p.edgeLabel,
      nodeTextColor: p.nodeText,
      fontSize: "14px"
    };
  }

  function initMermaid() {
    if (!window.mermaid) return;
    var vars = themeMermaidVars(currentTheme());
    mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: vars });
    mermaid.run({ querySelector: ".mermaid", suppressErrors: false })
      .then(function() { setupLightbox(); })
      .catch(function(err) { console.warn("Mermaid render error:", err); setupLightbox(); });
  }

  function setupLightbox() {
    document.addEventListener("click", function(e) {
      var overlay = document.querySelector(".mermaid-overlay");
      if (overlay && overlay.classList.contains("is-open")) {
        overlay.classList.remove("is-open");
        setTimeout(function() { overlay.remove(); }, 260);
        return;
      }
      var mermaidEl = e.target.closest(".mermaid");
      if (!mermaidEl) return;
      var svg = mermaidEl.querySelector("svg");
      if (!svg) return;
      e.preventDefault();
      var svgHTML = svg.outerHTML;
      var wrapper = document.createElement("div");
      wrapper.innerHTML = svgHTML;
      var svgClone = wrapper.firstChild;
      var vb = svgClone.getAttribute("viewBox");
      if (vb) {
        svgClone.removeAttribute("width");
        svgClone.removeAttribute("height");
        svgClone.setAttribute("width", "100%");
        svgClone.setAttribute("height", "100%");
      }
      svgClone.style.maxWidth = "94vw";
      svgClone.style.maxHeight = "90vh";
      var overlayDiv = document.createElement("div");
      overlayDiv.className = "mermaid-overlay";
      var innerDiv = document.createElement("div");
      innerDiv.className = "mermaid-overlay-inner";
      innerDiv.appendChild(svgClone);
      overlayDiv.appendChild(innerDiv);
      var hint = document.createElement("span");
      hint.className = "mermaid-close-hint";
      hint.textContent = "Click anywhere or press Esc to close";
      overlayDiv.appendChild(hint);
      document.body.appendChild(overlayDiv);
      requestAnimationFrame(function() { overlayDiv.classList.add("is-open"); });
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        var overlay = document.querySelector(".mermaid-overlay");
        if (overlay) {
          overlay.classList.remove("is-open");
          setTimeout(function() { overlay.remove(); }, 260);
        }
      }
    });
  }

  initMermaid();

  // Theme picker
  var themePicker = document.getElementById("theme-picker");
  if (themePicker) {
    themePicker.value = currentTheme();
    themePicker.addEventListener("change", function() {
      applyTheme(this.value);
    });
  }

  // Keyboard shortcut: [/] to toggle theme picker
  document.addEventListener("keydown", function(e) {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      var picker = document.getElementById("theme-picker");
      if (picker) {
        picker.focus();
        picker.size = picker.options.length;
        picker.addEventListener("blur", function() { picker.size = 1; }, { once: true });
        picker.addEventListener("change", function() { picker.size = 1; }, { once: true });
        picker.addEventListener("keydown", function(ev) {
          if (ev.key === "Escape") { picker.size = 1; picker.blur(); }
        }, { once: true });
      }
    }
  });

  // Mobile Navigation Toggle
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#primary-nav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!isOpen));
      navToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      nav.classList.toggle("is-open", !isOpen);
    });
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 720) {
          navToggle.setAttribute("aria-expanded", "false");
          navToggle.setAttribute("aria-label", "Open navigation");
          nav.classList.remove("is-open");
        }
      });
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) {
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open navigation");
        nav.classList.remove("is-open");
      }
    });
  }

  // Scroll Reveal Animation with Intersection Observer
  const revealElements = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealElements.length > 0) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          el.classList.add("visible");
          observer.unobserve(el);
          el.addEventListener("transitionend", () => el.classList.add("is-done"), { once: true });
        }
      });
    }, { threshold: 0, rootMargin: "0px 0px 15% 0px" });
    revealElements.forEach((el) => { revealObserver.observe(el); });
  } else {
    revealElements.forEach((el) => { el.classList.add("visible"); });
  }

  // Fetch Wraft GitHub Stars
  const wraftStarsElement = document.querySelector('[data-metric-id="wraft-stars"] strong');
  if (wraftStarsElement) {
    fetch("https://api.github.com/repos/wraft/wraft")
      .then(response => {
        if (!response.ok) throw new Error("API error");
        return response.json();
      })
      .then(data => {
        if (data.stargazers_count !== undefined) {
          wraftStarsElement.textContent = data.stargazers_count + "+ Stars";
        }
      })
      .catch(err => { console.warn("Failed to fetch dynamic GitHub stars for Wraft:", err); });
  }

  // Table of contents for blog posts
  const tocContainer = document.querySelector("[data-toc]");
  if (tocContainer) {
    const postContent = document.querySelector(".post-content");
    const tocNav = tocContainer.querySelector("[data-toc-nav]");
    const headings = postContent ? Array.from(postContent.querySelectorAll("h2")) : [];
    if (headings.length >= 2 && tocNav) {
      const slugify = (text) => text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
      const usedIds = new Set();
      headings.forEach((heading) => {
        if (!heading.id) {
          let id = slugify(heading.textContent || "section");
          let unique = id;
          let n = 2;
          while (usedIds.has(unique) || document.getElementById(unique)) { unique = id + "-" + n++; }
          heading.id = unique;
          usedIds.add(unique);
        } else { usedIds.add(heading.id); }
      });
      const tocList = document.createElement("ul");
      tocList.className = "post-toc-list";
      headings.forEach((heading) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#" + heading.id;
        a.className = "post-toc-link";
        a.textContent = heading.textContent;
        a.dataset.targetId = heading.id;
        li.appendChild(a);
        tocList.appendChild(li);
      });
      tocNav.appendChild(tocList);
      tocContainer.classList.add("is-ready");
      const stickyHeaderOffset = 90;
      tocList.addEventListener("click", (e) => {
        const link = e.target.closest(".post-toc-link");
        if (!link) return;
        const target = document.getElementById(link.dataset.targetId);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.pageYOffset - stickyHeaderOffset;
        window.scrollTo({ top: y, behavior: "smooth" });
        history.replaceState(null, "", "#" + link.dataset.targetId);
        tocList.querySelectorAll(".post-toc-link").forEach((l) => l.classList.remove("is-active"));
        link.classList.add("is-active");
      });
      const tocLinks = Array.from(tocList.querySelectorAll(".post-toc-link"));
      const headingById = new Map(headings.map((h) => [h.id, h]));
      const setActive = (id) => { tocLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.targetId === id)); };
      if ("IntersectionObserver" in window) {
        let visible = new Map();
        const spy = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) { visible.set(entry.target.id, entry.target.getBoundingClientRect().top); }
            else { visible.delete(entry.target.id); }
          });
          if (visible.size === 0) return;
          const sorted = Array.from(visible.entries()).sort((a, b) => a[1] - b[1]);
          setActive(sorted[0][0]);
        }, { rootMargin: "-90px 0px -65% 0px", threshold: [0, 1] });
        headings.forEach((h) => spy.observe(h));
      }
    } else if (tocContainer) { tocContainer.style.display = "none"; }
  }
});