/**
 * PushOK DOM reconciler.
 */
import { isVNode } from "./vdom.js";
import { setHandlers } from "./events.js";

const PROPERTIES = new Set(["value", "checked", "selected", "disabled", "indeterminate"]);
const BOOLEAN_PROPERTIES = new Set(["checked", "selected", "disabled"]);
const RESERVED = new Set(["on", "key", "ref"]);
let pendingRefs = [];

export function patch(parent, oldChildren, newChildren) {
  patchChildren(parent, oldChildren, newChildren);
  flushRefs();
}

export function createDom(vnode) {
  if (!isVNode(vnode)) return document.createTextNode(vnode);

  const element = document.createElement(vnode.tag);
  applyAttrs(element, {}, vnode.attrs);
  for (const child of vnode.children) element.appendChild(createDom(child));
  queueRef(vnode.attrs.ref, element);
  return element;
}

function patchNode(parent, oldVNode, newVNode, index) {
  const existing = parent.childNodes[index];
  if (isDifferentNode(oldVNode, newVNode)) {
    parent.replaceChild(createDom(newVNode), existing);
    return;
  }
  patchSameNode(existing, oldVNode, newVNode);
}

function patchSameNode(element, oldVNode, newVNode) {
  if (!isVNode(newVNode)) {
    if (oldVNode !== newVNode) element.nodeValue = newVNode;
    return;
  }
  applyAttrs(element, oldVNode.attrs, newVNode.attrs);
  patchChildren(element, oldVNode.children, newVNode.children);
  queueRef(newVNode.attrs.ref, element);
}

function isDifferentNode(oldVNode, newVNode) {
  if (isVNode(oldVNode) !== isVNode(newVNode)) return true;
  if (!isVNode(newVNode)) return false;
  return oldVNode.tag !== newVNode.tag || oldVNode.attrs.key !== newVNode.attrs.key;
}

function patchChildren(parent, oldChildren, newChildren) {
  if (isKeyed(oldChildren) && isKeyed(newChildren)) {
    patchKeyedChildren(parent, oldChildren, newChildren);
    return;
  }

  const shared = Math.min(oldChildren.length, newChildren.length);
  for (let i = 0; i < shared; i++) patchNode(parent, oldChildren[i], newChildren[i], i);

  for (let i = oldChildren.length - 1; i >= newChildren.length; i--) {
    parent.removeChild(parent.childNodes[i]);
  }
  for (let i = oldChildren.length; i < newChildren.length; i++) {
    parent.appendChild(createDom(newChildren[i]));
  }
}

function patchKeyedChildren(parent, oldChildren, newChildren) {
  const oldEntries = new Map();
  oldChildren.forEach((vnode, i) => {
    oldEntries.set(vnode.attrs.key, { vnode, element: parent.childNodes[i] });
  });

  let cursor = parent.firstChild;
  for (const newChild of newChildren) {
    const entry = oldEntries.get(newChild.attrs.key);
    if (!entry) {
      parent.insertBefore(createDom(newChild), cursor);
      continue;
    }

    oldEntries.delete(newChild.attrs.key);
    const isAlreadyInPlace = entry.element === cursor;
    if (isAlreadyInPlace) cursor = cursor.nextSibling;

    let element = entry.element;
    if (isDifferentNode(entry.vnode, newChild)) {
      const replacement = createDom(newChild);
      parent.replaceChild(replacement, element);
      element = replacement;
    } else {
      patchSameNode(element, entry.vnode, newChild);
    }

    if (!isAlreadyInPlace) parent.insertBefore(element, cursor);
  }

  for (const { element } of oldEntries.values()) element.remove();
}

function isKeyed(children) {
  return children.length > 0 && children.every((child) => isVNode(child) && child.attrs.key != null);
}

function applyAttrs(element, oldAttrs, newAttrs) {
  for (const name of Object.keys(oldAttrs)) {
    if (!(name in newAttrs)) removeAttr(element, name, oldAttrs[name]);
  }

  for (const name of Object.keys(newAttrs)) {
    if (oldAttrs[name] !== newAttrs[name] || PROPERTIES.has(name)) {
      setAttr(element, name, newAttrs[name]);
    }
  }

  setHandlers(element, newAttrs.on);
}

function setAttr(element, name, value) {
  if (RESERVED.has(name)) return;

  if (name === "class" || name === "className") {
    if (value) element.className = value;
    else element.removeAttribute("class");
    return;
  }

  if (name === "style" && typeof value === "object" && value !== null) {
    element.style.cssText = "";
    Object.assign(element.style, value);
    return;
  }

  if (PROPERTIES.has(name)) {
    if (element[name] !== value) element[name] = value;
    if (BOOLEAN_PROPERTIES.has(name)) element.toggleAttribute(name, Boolean(value));
    return;
  }

  if (value === false || value == null) {
    element.removeAttribute(name);
    return;
  }

  element.setAttribute(name, value === true ? "" : value);
}

function removeAttr(element, name, oldValue) {
  if (RESERVED.has(name)) return;
  if (name === "class" || name === "className") {
    element.removeAttribute("class");
    return;
  }
  if (PROPERTIES.has(name)) {
    element[name] = typeof oldValue === "boolean" ? false : "";
    if (BOOLEAN_PROPERTIES.has(name)) element.removeAttribute(name);
    return;
  }
  element.removeAttribute(name);
}

function queueRef(ref, element) {
  if (typeof ref === "function") pendingRefs.push(() => ref(element));
}

function flushRefs() {
  const refs = pendingRefs;
  pendingRefs = [];
  for (const ref of refs) ref();
}
