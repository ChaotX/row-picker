// Tiny DOM builder: el('button', { class: 'x', onclick: fn }, 'text', child, …). Strings become text nodes, so
// sheet content never ends up parsed as HTML.

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (key === 'class') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key in node && typeof value !== 'string') node[key] = value;
        else node.setAttribute(key, value === true ? '' : value);
    }
    append(node, children);
    return node;
}

function append(node, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function option(value, label, selected = false, attrs = {}) {
    return el('option', { value, selected, ...attrs }, label);
}

export const $ = (selector, root = document) => root.querySelector(selector);
