// Ported from apps/mobile/native/ios/Modules/SharedWebView/Injected/at_start.js

const RNMessageHandlers = `
if(!window.webkit) {
  window.webkit = {
    messageHandlers: {
      message: ReactNativeWebView
    },
  }
}
`

export const atStart = `
;(() => {
  ${RNMessageHandlers}
  window.__RN__ = true

  function send(data) {
    window.webkit.messageHandlers.message.postMessage?.(JSON.stringify(data))
  }

  window.bridge = {
    measure: () => {
      send({
        type: "measure",
      })
    },
    setContentHeight: (height) => {
      send({
        type: "setContentHeight",
        payload: height,
      })
    },
    previewImage: (data) => {
      send({
        type: "previewImage",
        payload: {
          imageUrls: data.imageUrls,
          index: data.index || 0,
        },
      })
    },
    seekAudio: (time) => {
      send({
        type: "audio:seekTo",
        payload: {
          time,
        },
      })
    },
  }

  // Layout enforcement functions to prevent horizontal scrolling on newsletters
  window.__cleanCss = function(css) {
    if (typeof css !== 'string') return css;
    return css
      .replace(/\\bmin-width\\s*:\\s*[^;!}]+(!important)?/gi, 'min-width: 0 !important')
      .replace(/\\bwidth\\s*:\\s*(?:[2-9]\\d{2,}|\\d{4,})px\\s*(!important)?/gi, 'width: 100% !important; max-width: 100% !important')
      .replace(/\\bwidth\\s*:\\s*(?:[1-9]\\d{2,}|\\d{4,})pt\\s*(!important)?/gi, 'width: 100% !important; max-width: 100% !important')
      .replace(/\\bwhite-space\\s*:\\s*nowrap\\s*(!important)?/gi, 'white-space: normal !important')
      .replace(/\\btable-layout\\s*:\\s*auto\\s*(!important)?/gi, 'table-layout: fixed !important');
  };

  window.__sanitizeHast = function(tree) {
    if (!tree || !Array.isArray(tree.children)) return;
    function walk(node) {
      if (node.type === 'element') {
        if (node.properties) {
          var w = node.properties.width;
          if (w !== undefined && w !== null) {
            if (typeof w === 'number' && w > 200) {
              delete node.properties.width;
            } else if (typeof w === 'string' && (!w.endsWith('%') || parseInt(w, 10) > 100)) {
              delete node.properties.width;
            }
          }
          var st = node.properties.style;
          if (typeof st === 'string') {
            node.properties.style = window.__cleanCss(st);
          }
        }
      }
      if (Array.isArray(node.children)) {
        for (var i = 0; i < node.children.length; i++) {
          walk(node.children[i]);
        }
      }
    }
    walk(tree);
  };

  // Signal readiness once DOM is interactive/loaded (guard to send once)
  if (!window.__FO_WEBVIEW_READY__) {
    let sent = false
    const sendReady = () => {
      if (sent) return
      sent = true
      window.__FO_WEBVIEW_READY__ = true
      try {
        send({ type: "ready" })
      } catch {
        /* empty */
      }
    }
    document.addEventListener("DOMContentLoaded", sendReady)
    window.addEventListener("load", sendReady)
  }
})()
`

export const atEnd = `
;(() => {
  const root = document.querySelector("#root")
  let ticking = false
  const handleHeight = () => {
    if (ticking) return
    ticking = true
    setTimeout(() => {
      try {
        window.webkit.messageHandlers.message.postMessage(
          JSON.stringify({
            type: "setContentHeight",
            payload: root?.scrollHeight || document.documentElement.scrollHeight,
          }),
        )
      } finally {
        ticking = false
      }
    }, 16)
  }
  window.addEventListener("load", handleHeight)
  const observer = new ResizeObserver(handleHeight)

  setTimeout(() => {
    handleHeight()
  }, 1000)
  observer.observe(root)

  // Layout enforcement observer to eliminate horizontal scroll in emails
  const sanitizeDOM = () => {
    const els = document.querySelectorAll('table, td, th, div, center, img, p, span, section, article, a');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const w = el.getAttribute('width');
      if (w && (parseInt(w, 10) > 200 || !w.endsWith('%'))) {
        el.removeAttribute('width');
      }
      if (el.style) {
        if (el.style.minWidth && el.style.minWidth !== '0px') {
          el.style.setProperty('min-width', '0px', 'important');
        }
        if (el.style.width) {
          const val = parseInt(el.style.width, 10);
          if (val > 200 || (el.style.width.indexOf('px') !== -1 && val > 150)) {
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('max-width', '100%', 'important');
          }
        }
        if (el.tagName === 'TABLE') {
          el.style.setProperty('table-layout', 'fixed', 'important');
          el.style.setProperty('width', '100%', 'important');
          el.style.setProperty('max-width', '100%', 'important');
        }
        if (el.tagName === 'TD' || el.tagName === 'TH') {
          el.style.setProperty('word-break', 'break-word', 'important');
          el.style.setProperty('overflow-wrap', 'anywhere', 'important');
          el.style.setProperty('white-space', 'normal', 'important');
          el.style.setProperty('max-width', '100%', 'important');
        }
      }
    }
  };

  sanitizeDOM();
  const mutationObs = new MutationObserver(sanitizeDOM);
  mutationObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'width', 'class'] });

  // Fallback: ensure readiness is signaled at end if not yet sent
  if (!window.__FO_WEBVIEW_READY__) {
    try {
      window.__FO_WEBVIEW_READY__ = true
      window.webkit.messageHandlers.message.postMessage(JSON.stringify({ type: "ready" }))
    } catch {
      /* empty */
    }
  }
})()
`
