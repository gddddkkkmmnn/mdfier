import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { extractCapture, extractPageCapture } from '../lib/extract';
import { CAPTURE_PROTOCOL_VERSION, type CaptureCommand, type CaptureReply } from '../lib/types';

type CaptureRuntime = { protocol: number; dispose: () => void };
type CaptureWindow = Window & {
  __mdCaptureInstalled?: boolean;
  __mdfierCaptureRuntime?: CaptureRuntime;
};

export default defineContentScript({
  registration: 'runtime',
  // Runtime registration keeps capture dormant until the user invokes an action.
  main() {
    if (window !== window.top) return;
    const state = window as CaptureWindow;
    try { state.__mdfierCaptureRuntime?.dispose(); } catch { /* Old extension contexts may already be invalid. */ }
    delete state.__mdCaptureInstalled;
    document.querySelectorAll('[data-md-capture-ui]').forEach((element) => element.remove());
    let stopPicking: (() => void) | undefined;
    let activePickId: string | undefined;

    function pick(language: 'en' | 'uk', pickId: string) {
      stopPicking?.();
      activePickId = pickId;
      let selected: Element | null = null;
      const history: Element[] = [];
      const originalUrl = location.href;
      const previousFocus = document.activeElement;
      // pushState navigation has no cross-browser event; only watch while picking.
      const navigationCheck = window.setInterval(() => { if (location.href !== originalUrl) cancel(); }, 250);
      const overlay = document.createElement('div');
      const hint = document.createElement('div');
      for (const el of [overlay, hint]) el.setAttribute('data-md-capture-ui', '');
      overlay.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:2px solid #5b68ed;background:rgba(91,104,237,.12);border-radius:3px;display:none';
      hint.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483647;left:12px;top:12px;max-width:calc(100vw - 48px);padding:12px 16px;border-radius:8px;background:#1c2030;color:white;font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 20px #0004';
      hint.textContent = language === 'uk'
        ? 'Клацніть блок, щоб вибрати · ↑ — ширший блок · ↓ — попередній блок · Esc — скасувати'
        : 'Click a block to choose it · ↑ larger block · ↓ previous block · Esc to cancel';
      hint.tabIndex = -1;
      hint.setAttribute('role', 'status');
      document.documentElement.append(overlay, hint);
      // Move keyboard focus from the sidebar into the page for Esc and arrow controls.
      hint.focus({ preventScroll: true });

      function redraw() {
        if (!selected?.isConnected) { overlay.style.display = 'none'; return; }
        const rect = selected.getBoundingClientRect();
        Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      }
      function move(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Element) || target.closest('[data-md-capture-ui]')) return;
        if (selected !== target) { selected = target; history.length = 0; redraw(); }
      }
      function finish() {
        window.clearInterval(navigationCheck);
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('pointerdown', suppress, true);
        document.removeEventListener('mousedown', suppress, true);
        document.removeEventListener('keydown', key, true);
        window.removeEventListener('scroll', redraw, true);
        window.removeEventListener('resize', redraw);
        window.removeEventListener('pagehide', finish);
        window.removeEventListener('popstate', cancel);
        window.removeEventListener('hashchange', cancel);
        overlay.remove(); hint.remove(); stopPicking = undefined; activePickId = undefined;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      }
      function cancel() { finish(); void browser.runtime.sendMessage({ type: 'pick-cancelled', pickId }).catch(() => {}); }
      function suppress(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
      function click(event: MouseEvent) {
        if (!event.isTrusted) return;
        suppress(event);
        const target = selected ?? (event.target instanceof Element ? event.target : null);
        if (!target) return;
        try {
          const payload = extractCapture(document, 'element', target);
          finish();
          void browser.runtime.sendMessage({ type: 'capture-result', pickId, payload }).catch(() => {});
        } catch (error) {
          hint.textContent = error instanceof Error && error.message === 'capture-too-large'
            ? language === 'uk' ? 'Цей блок завеликий. Виберіть менший блок або натисніть Esc.' : 'This block is too large. Pick a smaller block or press Esc.'
            : language === 'uk' ? 'У цьому блоці немає тексту. Виберіть інший або натисніть Esc.' : 'This block has no text. Pick another or press Esc.';
        }
      }
      function key(event: KeyboardEvent) {
        if (event.key === 'Escape') { suppress(event); cancel(); }
        if (event.key === 'ArrowUp') {
          suppress(event);
          if (selected?.parentElement && selected !== document.body) { history.push(selected); selected = selected.parentElement; redraw(); }
        }
        if (event.key === 'ArrowDown') {
          suppress(event);
          const previous = history.pop();
          if (previous) { selected = previous; redraw(); }
        }
      }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('pointerdown', suppress, true);
      document.addEventListener('mousedown', suppress, true);
      document.addEventListener('keydown', key, true);
      window.addEventListener('scroll', redraw, true);
      window.addEventListener('resize', redraw);
      window.addEventListener('pagehide', finish);
      window.addEventListener('popstate', cancel);
      window.addEventListener('hashchange', cancel);
      stopPicking = finish;
    }

    const onMessage = (message: CaptureCommand) => {
      if (message?.type === 'capture-ping') return Promise.resolve({ protocol: CAPTURE_PROTOCOL_VERSION });
      if (message?.type === 'cancel-pick') {
        if (message.pickId === activePickId) stopPicking?.();
        return Promise.resolve({ ok: true });
      }
      if (message?.type !== 'capture' && message?.type !== 'pick') return;
      if (message.type === 'capture' && message.kind === 'page') {
        stopPicking?.();
        return extractPageCapture(document).then(payload => ({ payload }), error => ({ error: error instanceof Error ? error.message : 'capture-failed' }));
      }
      let reply: CaptureReply;
      try {
        if (message.type === 'pick') { pick(message.language, message.pickId); reply = { picking: true }; }
        else { stopPicking?.(); reply = { payload: extractCapture(document, message.kind) }; }
      } catch (error) { reply = { error: error instanceof Error ? error.message : 'capture-failed' }; }
      return Promise.resolve(reply);
    };
    browser.runtime.onMessage.addListener(onMessage);
    state.__mdfierCaptureRuntime = {
      protocol: CAPTURE_PROTOCOL_VERSION,
      dispose() {
        stopPicking?.();
        browser.runtime.onMessage.removeListener(onMessage);
        document.querySelectorAll('[data-md-capture-ui]').forEach((element) => element.remove());
        if (state.__mdfierCaptureRuntime?.dispose === this.dispose) delete state.__mdfierCaptureRuntime;
      },
    };
  },
});
