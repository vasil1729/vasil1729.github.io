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

    // Close menu when a link is clicked (mobile navigation)
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 720) {
          navToggle.setAttribute("aria-expanded", "false");
          navToggle.setAttribute("aria-label", "Open navigation");
          nav.classList.remove("is-open");
        }
      });
    });

    // Reset menu state on window resize
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
          // Optionally stop observing once revealed
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1, // Element is 10% visible
      rootMargin: "0px 0px -50px 0px" // Trigger slightly before it fully appears
    });

    revealElements.forEach((el) => {
      revealObserver.observe(el);
    });
  } else {
    // Fallback if IntersectionObserver is not supported
    revealElements.forEach((el) => {
      el.classList.add("visible");
    });
  }
});
