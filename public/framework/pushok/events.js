/**
 * PushOK event delegation and global event multiplexing.
 */
const elementHandlers = new WeakMap();
const delegatedTypes = new Set();
const globalHandlers = new WeakMap();
const NON_BUBBLING = new Set(["blur", "focus", "mouseenter", "mouseleave"]);

export function setHandlers(element, handlers) {
  if (!handlers) {
    elementHandlers.delete(element);
    return;
  }

  elementHandlers.set(element, handlers);
  for (const type of Object.keys(handlers)) delegate(type);
}

function delegate(type) {
  if (delegatedTypes.has(type)) return;
  delegatedTypes.add(type);
  document.addEventListener(type, dispatch, NON_BUBBLING.has(type));
}

function dispatch(event) {
  let node = event.target;
  while (node && node !== document) {
    const handler = elementHandlers.get(node)?.[event.type];
    if (handler) {
      handler(event, node);
      if (event.cancelBubble) return;
    }
    node = node.parentNode;
  }
}

export function listen(target, type, handler) {
  const byType = globalHandlers.get(target) ?? new Map();
  globalHandlers.set(target, byType);

  let entry = byType.get(type);
  if (!entry) {
    const handlers = new Set();
    const native = (event) => handlers.forEach((fn) => fn(event));
    entry = { handlers, native };
    byType.set(type, entry);
    target.addEventListener(type, native, NON_BUBBLING.has(type));
  }

  entry.handlers.add(handler);
  return () => {
    entry.handlers.delete(handler);
    if (entry.handlers.size === 0) {
      target.removeEventListener(type, entry.native, NON_BUBBLING.has(type));
      byType.delete(type);
    }
  };
}
