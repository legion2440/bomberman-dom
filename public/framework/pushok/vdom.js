/**
 * PushOK virtual DOM node factory.
 */
export function h(tag, attrs, ...children) {
  if (!isAttrs(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  return { tag, attrs, children: normalizeChildren(children) };
}

export function isVNode(value) {
  return typeof value === "object" && value !== null && typeof value.tag === "string";
}

function isAttrs(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isVNode(value);
}

export function normalizeChildren(children) {
  const result = [];
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    result.push(isVNode(child) ? child : String(child));
  }
  return result;
}
