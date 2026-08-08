/**
 * icons.js: engraved line icons, defined once as <symbol>s in index.html.
 * No emoji anywhere in the UI: they render differently on every platform and
 * read as generic, which is the opposite of what this thing should feel like.
 */

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} name symbol id without the `i-` prefix
 * @param {string} [extraClass] e.g. 'ico--fill' for solid marks
 * @returns {SVGSVGElement}
 */
export function icon(name, extraClass = '') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', `ico ${extraClass}`.trim());
    svg.setAttribute('aria-hidden', 'true');

    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);

    return svg;
}

/** Swap the symbol an existing <use> points at. */
export function setIcon(useNode, name) {
    useNode.setAttribute('href', `#i-${name}`);
}
