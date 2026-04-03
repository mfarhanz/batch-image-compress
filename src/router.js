import homeContent from "./pages/home.js";
import privacyContent from "./pages/privacy.js";
import termsContent from "./pages/terms.js";

let homeInitTask = null;

export function registerHomeInit(fn) {
    homeInitTask = fn;
}

const routes = {
    "/": {
        html: homeContent,
        getInit: () => homeInitTask,
        title: "WebPly - Compress Images to WebP",
        description: "Compress images and convert JPG, PNG, GIF, BMP, TIFF, and AVIF to WebP efficiently."
    },
    "/privacy": {
        html: privacyContent,
        getInit: null,
        title: "Privacy Policy - WebPly",
        description: "Learn how your images are processed locally in your browser and how your data is handled."
    },
    "/terms": {
        html: termsContent,
        getInit: null,
        title: "Terms of Service - WebPly",
        description: "Read the terms and conditions for using the WebPly image compression tool."
    },
};

function renderPage(route) {
    const app = document.getElementById("app");
    if (!app) return;

    app.innerHTML = route.html;
    window.scrollTo(0, 0);

    // --- UPDATE METADATA ---
    document.title = route.title;
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", route.description);
    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", window.location.href);
    updateMetaTag("property='og:title'", route.title);
    updateMetaTag("property='og:description'", route.description);
    updateMetaTag("property='og:url'", window.location.href);
    updateMetaTag("name='twitter:title'", route.title);
    updateMetaTag("name='twitter:description'", route.description);

    const init = route.getInit ? route.getInit() : null;
    if (typeof init === "function") init();
}

document.addEventListener("click", e => {
    const link = e.target.closest("[data-link]");
    if (!link) return;

    e.preventDefault();
    navigate(link.getAttribute("href"));
});

function updateMetaTag(selector, content) {
    const el = document.querySelector(`meta[${selector}]`);
    if (el) el.setAttribute("content", content);
}

export function router() {
    const path = window.location.pathname;
    const route = routes[path] || routes["/"];
    renderPage(route);
}

export function navigate(path) {
    history.pushState({}, "", path);
    router();
}

window.addEventListener("popstate", router);
