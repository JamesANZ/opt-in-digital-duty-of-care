/**
 * @title Agent stylesheet
 * @notice CSS injected into every page for blur, hide, labels, the teach dialog, and the block screen.
 * @dev Rules use `!important` because host pages set their own styles. `.ddoc-ui` resets inheritance so the page cannot restyle the controls.
 */
export const AGENT_CSS = `
.ddoc-pending{filter:blur(6px)!important;transition:filter .2s}
.ddoc-blurred{filter:blur(14px)!important;pointer-events:none!important;user-select:none!important}
.ddoc-hidden{display:none!important}
.ddoc-labelled{outline:2px dashed #c58a00!important;outline-offset:2px}
.ddoc-ui{all:initial;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d2433;box-sizing:border-box}
.ddoc-ui *{font:inherit;color:inherit;box-sizing:border-box}
.ddoc-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0;padding:6px 10px;border-radius:10px;background:#eef3ff;border:1px solid #c9d6f5;max-width:100%}
.ddoc-bar.ddoc-label{background:#fff7e0;border-color:#f0d590}
.ddoc-bar.ddoc-hide{background:#f1f2f4;border-color:#d6d9de}
.ddoc-bar.ddoc-support{background:#ecf8f1;border-color:#a9dcc0;flex-direction:row}
.ddoc-support-msg{flex-basis:100%;order:3}
.ddoc-shield{font-size:14px}
.ddoc-label{font-weight:600}
.ddoc-btn{all:initial;font:600 12px system-ui,sans-serif;cursor:pointer;padding:4px 10px;border-radius:999px;background:#fff;border:1px solid #c3cad6;color:#1d2433}
.ddoc-btn:hover{background:#f5f7fb}
.ddoc-btn:focus-visible{outline:2px solid #3b6cf6;outline-offset:2px}
.ddoc-primary{background:#2f5bea;border-color:#2f5bea;color:#fff}
.ddoc-why{flex-basis:100%;padding:8px 10px;margin-top:4px;background:#fff;border-radius:8px;border:1px solid #dfe4ee;display:block}
.ddoc-why-title{font-weight:700;margin-bottom:4px;display:block}
.ddoc-meta{color:#5d6678;font-size:12px;margin-top:4px;display:block}
.ddoc-resources{flex-basis:100%;display:flex;gap:8px;flex-wrap:wrap;order:4}
.ddoc-res{color:#0b6b3a!important;text-decoration:underline;font-weight:600;cursor:pointer}
.ddoc-block{position:fixed;inset:0;z-index:2147483647;background:#0f1730;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}
.ddoc-block h1{font-size:24px;font-weight:700;color:#fff}
.ddoc-block p{color:#cdd6f0;max-width:520px}
.ddoc-block-icon{font-size:48px}
.ddoc-pill{position:absolute;z-index:2147483646;cursor:pointer;padding:6px 12px;border-radius:999px;background:#2f5bea;color:#fff;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.2)}
.ddoc-modal{position:fixed;inset:0;z-index:2147483647;background:rgba(10,15,30,.45);display:flex;align-items:center;justify-content:center}
.ddoc-card{background:#fff;border-radius:14px;padding:18px;width:min(440px,92vw);display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.ddoc-card label{display:flex;flex-direction:column;gap:4px;font-weight:600}
.ddoc-card select,.ddoc-card input{all:revert;font:14px system-ui;padding:6px;border:1px solid #c3cad6;border-radius:8px}
.ddoc-quote{display:block;margin:0;padding:8px 10px;border-left:3px solid #2f5bea;background:#f5f7fb;border-radius:6px;max-height:120px;overflow:auto}
.ddoc-row{display:flex;gap:8px;justify-content:flex-end}
.ddoc-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1d2433;color:#fff;padding:10px 16px;border-radius:10px}
.ddoc-scroll-stop{display:flex;flex-direction:column;align-items:center;gap:8px;margin:16px auto;padding:16px;border-radius:12px;background:#eef3ff;border:1px solid #c9d6f5;text-align:center;max-width:560px}
`;
