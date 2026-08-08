/**
 * toast.js: non-blocking notices and a styled confirm dialog.
 * These replace every native alert()/confirm() the game used to fire.
 */

import { el, openModal, closeModal } from './dom.js';
import { sfx } from './audio.js';

/**
 * A toast is a coloured rule and a line of text. No icon: the tone carries it.
 */
export function toast(message, { type = 'info', duration = 3400 } = {}) {
    const node = document.createElement('div');
    node.className = `toast toast--${type}`;
    node.textContent = message;
    el.toastStack.appendChild(node);

    if (type === 'error') sfx.error();
    else sfx.toast();

    const remove = () => {
        if (!node.isConnected) return;
        node.classList.add('is-leaving');
        node.addEventListener('animationend', () => node.remove(), { once: true });
        // animationend never fires in a backgrounded tab, so don't leak the node
        setTimeout(() => node.remove(), 400);
    };
    setTimeout(remove, duration);

    // keep the stack from growing without bound
    while (el.toastStack.children.length > 4) el.toastStack.firstElementChild.remove();

    return remove;
}

/* ------------------------------------------------------------------ */
/* confirm                                                             */
/* ------------------------------------------------------------------ */

let pendingResolve = null;

function settle(result) {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    closeModal(el.confirmModal);
    resolve(result);
}

el.confirmOkBtn.addEventListener('click', () => settle(true));
el.confirmCancelBtn.addEventListener('click', () => settle(false));
el.confirmModal.querySelector('.modal__backdrop').addEventListener('click', () => settle(false));

/**
 * @returns {Promise<boolean>} true if the user confirmed.
 */
export function confirmDialog({
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = true,
} = {}) {
    settle(false); // collapse any dialog already on screen

    el.confirmTitle.textContent = title;
    el.confirmTitle.classList.toggle('is-danger', danger);
    el.confirmMessage.textContent = message;
    el.confirmMessage.hidden = !message;
    el.confirmOkBtn.textContent = confirmText;
    el.confirmOkBtn.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    el.confirmCancelBtn.textContent = cancelText;

    openModal(el.confirmModal);
    requestAnimationFrame(() => el.confirmOkBtn.focus());

    return new Promise((resolve) => {
        pendingResolve = resolve;
    });
}

export const isConfirmOpen = () => pendingResolve !== null;
export const dismissConfirm = () => settle(false);
