// Small helpers (from PlanTape).

export function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// localStorage wrappers that never throw (private mode, quota, disabled storage).
export const storage = {
    get(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    }
};

export function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing?.dataset.loaded) return resolve();
        const s = existing || document.createElement('script');
        s.addEventListener('load', () => {
            s.dataset.loaded = '1';
            resolve();
        });
        s.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
        if (!existing) {
            s.src = src;
            s.async = true;
            document.head.appendChild(s);
        }
    });
}
