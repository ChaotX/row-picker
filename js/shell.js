// The page frame: top bar, screens, toast and row-picker's stylesheet, put into the host page by startApp(), so
// an app built on row-picker only needs an index.html that calls startApp(config). Static markup only; every
// text comes from the UI strings (data-i18n) or the settings.

import { settings } from './settings.js';

const HERE = new URL('.', import.meta.url);

const FRAME = `
    <header class="topbar">
        <a class="brand" href="./"><img alt="" width="26" height="26"><span></span></a>
        <div id="sheetInfo" class="sheet-info hidden">
            <a id="sheetLink" target="_blank" rel="noopener" data-i18n-title="openInSheets"></a>
            <select id="tabSelect" data-i18n-title="tab"></select>
        </div>
        <span class="spacer"></span>
        <button id="reloadButton" class="top-btn hidden" data-i18n-title="reloadHint">⟳</button>
        <button id="changeSheetButton" class="top-btn hidden" data-i18n="changeSheet"></button>
        <div class="menu-wrap">
            <button id="savedButton" class="top-btn" data-i18n="saved"></button>
            <div id="savedMenu" class="menu hidden"></div>
        </div>
        <button id="accountButton" class="top-btn"></button>
        <select id="languageSelect" class="top-select" aria-label="Language"></select>
    </header>

    <main>
        <section id="startScreen" class="screen hidden"></section>

        <section id="loadingScreen" class="screen hidden">
            <div class="loading"><div class="spinner"></div><p id="loadingText"></p></div>
        </section>

        <section id="messageScreen" class="screen hidden">
            <div id="messageBox" class="card message">
                <h2 id="messageTitle"></h2>
                <div id="messageText"></div>
                <div id="messageActions" class="actions"></div>
            </div>
        </section>

        <section id="mainScreen" class="screen hidden">
            <div id="builder" class="card builder"></div>
            <div id="shareBar" class="share-bar"></div>
            <div id="results" class="results-area"></div>
        </section>
    </main>

    <div id="toast" class="toast hidden" role="status"></div>`;

// row-picker's stylesheet, from wherever row-picker is served (its own site, a CDN, a local copy). Resolves
// once it applies, so the page isn't shown unstyled.
function loadStyles() {
    const href = new URL('../style.css', HERE).href;
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise(resolve => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.addEventListener('load', resolve);
        link.addEventListener('error', resolve); // still show the page
        // Before the host's own stylesheets, so an app can override row-picker's styles.
        document.head.prepend(link);
    });
}

export async function mountShell() {
    await loadStyles();
    document.body.insertAdjacentHTML('afterbegin', FRAME);
    const icon = settings.icon || new URL('../favicon.svg', HERE).href;
    const brand = document.querySelector('.brand');
    brand.title = settings.name;
    brand.querySelector('img').src = icon;
    brand.querySelector('span').textContent = settings.name;
    if (!document.querySelector('link[rel="icon"]')) {
        document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: icon }));
    }
    if (!document.title) document.title = settings.name;
}
