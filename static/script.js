document.addEventListener("DOMContentLoaded", () => {
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
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px"
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
});

// Mermaid initialization and expand-to-lightbox
(function() {
  function initMermaid() {
    if (!window.mermaid) return;
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: "#f4ede3",
        primaryTextColor: "#1f1a17",
        primaryBorderColor: "#6b5b4f",
        lineColor: "#6b5b4f",
        secondaryColor: "#e8dcc8",
        tertiaryColor: "#efe4d4",
        mainBkg: "#f4ede3",
        nodeBorder: "#6b5b4f",
        clusterBkg: "rgba(255,251,244,0.72)",
        clusterBorder: "rgba(69,52,39,0.18)",
        titleColor: "#1f1a17",
        edgeLabelBackground: "#f4ede3",
        nodeTextColor: "#1f1a17",
        fontSize: "14px"
      }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMermaid);
  } else {
    initMermaid();
  }
})();