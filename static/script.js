document.addEventListener("DOMContentLoaded", () => {
  // Dark mode toggle
  var savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }

  function isDark() {
    return document.documentElement.classList.contains("dark");
  }

  var lightMermaidVars = {
    primaryColor: "#e8f0f7",
    primaryTextColor: "#16202c",
    primaryBorderColor: "#546575",
    lineColor: "#546575",
    secondaryColor: "#d9e5f0",
    tertiaryColor: "#e2ebf4",
    mainBkg: "#e8f0f7",
    nodeBorder: "#546575",
    clusterBkg: "rgba(255,255,255,0.60)",
    clusterBorder: "rgba(46,80,144,0.20)",
    titleColor: "#16202c",
    edgeLabelBackground: "#e8f0f7",
    nodeTextColor: "#16202c",
    fontSize: "14px"
  };

  var darkMermaidVars = {
    primaryColor: "#2d2824",
    primaryTextColor: "#f0e8dc",
    primaryBorderColor: "#9a8876",
    lineColor: "#9a8876",
    secondaryColor: "#1e1a16",
    tertiaryColor: "#1a1714",
    mainBkg: "#2d2824",
    nodeBorder: "#9a8876",
    clusterBkg: "rgba(45,40,36,0.72)",
    clusterBorder: "rgba(154,136,118,0.18)",
    titleColor: "#f0e8dc",
    edgeLabelBackground: "#2d2824",
    nodeTextColor: "#f0e8dc",
    fontSize: "14px"
  };

  function initMermaid() {
    if (!window.mermaid) return;
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: isDark() ? darkMermaidVars : lightMermaidVars
    });

    mermaid.run({
      querySelector: ".mermaid",
      suppressErrors: false
    }).then(function() {
      setupLightbox();
    }).catch(function(err) {
      console.warn("Mermaid render error:", err);
      setupLightbox();
    });
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

      requestAnimationFrame(function() {
        overlayDiv.classList.add("is-open");
      });
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

  var themeBtn = document.querySelector(".theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function() {
      var dark = isDark();
      document.documentElement.classList.remove(dark ? "dark" : "light");
      document.documentElement.classList.add(dark ? "light" : "dark");
      localStorage.setItem("theme", dark ? "light" : "dark");
      if (window.mermaid) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: dark ? lightMermaidVars : darkMermaidVars
        });
        mermaid.run({ querySelector: ".mermaid", suppressErrors: true });
      }
    });
  }

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
          // Free the GPU layer once the entrance animation has finished so we
          // don't keep dozens of will-change layers alive while scrolling.
          el.addEventListener("transitionend", () => el.classList.add("is-done"), { once: true });
        }
      });
    }, {
      // Start the reveal a bit before the element scrolls into view so the
      // animation has finished by the time it's on screen — this keeps things
      // smooth even when scrolling medium-fast instead of popping in late.
      threshold: 0,
      rootMargin: "0px 0px 15% 0px"
    });

    revealElements.forEach((el) => {
      revealObserver.observe(el);
    });
  } else {
    revealElements.forEach((el) => {
      el.classList.add("visible");
    });
  }

  // Fetch Wraft Github Stars dynamically
  const wraftStarsElement = document.querySelector('[data-metric-id="wraft-stars"] strong');
  if (wraftStarsElement) {
    fetch("https://api.github.com/repos/wraft/wraft")
      .then(response => {
        if (!response.ok) throw new Error("API error");
        return response.json();
      })
      .then(data => {
        if (data.stargazers_count !== undefined) {
          wraftStarsElement.textContent = `${data.stargazers_count}+ Stars`;
        }
      })
      .catch(err => {
        console.warn("Failed to fetch dynamic GitHub stars for Wraft:", err);
      });
  }

  // Table of contents for blog posts
  const tocContainer = document.querySelector("[data-toc]");
  if (tocContainer) {
    const postContent = document.querySelector(".post-content");
    const tocNav = tocContainer.querySelector("[data-toc-nav]");
    const headings = postContent
      ? Array.from(postContent.querySelectorAll("h2"))
      : [];

    if (headings.length >= 2 && tocNav) {
      const slugify = (text) =>
        text
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-");

      const usedIds = new Set();
      headings.forEach((heading) => {
        if (!heading.id) {
          let id = slugify(heading.textContent || "section");
          let unique = id;
          let n = 2;
          while (usedIds.has(unique) || document.getElementById(unique)) {
            unique = `${id}-${n++}`;
          }
          heading.id = unique;
          usedIds.add(unique);
        } else {
          usedIds.add(heading.id);
        }
      });

      const tocList = document.createElement("ul");
      tocList.className = "post-toc-list";

      headings.forEach((heading) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#${heading.id}`;
        a.className = "post-toc-link";
        a.textContent = heading.textContent;
        a.dataset.targetId = heading.id;
        li.appendChild(a);
        tocList.appendChild(li);
      });

      tocNav.appendChild(tocList);
      tocContainer.classList.add("is-ready");

      // Smooth scroll on click (account for sticky header)
      const stickyHeaderOffset = 90;
      tocList.addEventListener("click", (e) => {
        const link = e.target.closest(".post-toc-link");
        if (!link) return;
        const target = document.getElementById(link.dataset.targetId);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.pageYOffset - stickyHeaderOffset;
        window.scrollTo({ top: y, behavior: "smooth" });
        history.replaceState(null, "", `#${link.dataset.targetId}`);
        tocList.querySelectorAll(".post-toc-link").forEach((l) => l.classList.remove("is-active"));
        link.classList.add("is-active");
      });

      // Scroll spy using IntersectionObserver
      const tocLinks = Array.from(tocList.querySelectorAll(".post-toc-link"));
      const headingById = new Map(headings.map((h) => [h.id, h]));

      const setActive = (id) => {
        tocLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.targetId === id));
      };

      if ("IntersectionObserver" in window) {
        let visible = new Map();
        const spy = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                visible.set(entry.target.id, entry.target.getBoundingClientRect().top);
              } else {
                visible.delete(entry.target.id);
              }
            });
            if (visible.size === 0) return;
            // Pick the heading closest to the top within the activation band
            const sorted = Array.from(visible.entries()).sort((a, b) => a[1] - b[1]);
            const activeId = sorted[0][0];
            setActive(activeId);
          },
          { rootMargin: "-90px 0px -65% 0px", threshold: [0, 1] }
        );
        headings.forEach((h) => spy.observe(h));
      }
    } else if (tocContainer) {
      tocContainer.style.display = "none";
    }
  }
});