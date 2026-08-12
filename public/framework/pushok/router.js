/**
 * PushOK hash router.
 */
import { listen } from "./events.js";

export function createRouter(routes) {
  const compiled = Object.entries(routes)
    .filter(([pattern]) => pattern !== "*")
    .map(([pattern, handler]) => ({ ...compile(pattern), handler }));
  const fallback = routes["*"];

  function resolve() {
    const path = current();
    for (const route of compiled) {
      const match = route.regex.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(route.paramNames.map((name, i) => [name, match[i + 1]]));
      route.handler(params, path);
      return;
    }
    fallback?.({}, path);
  }

  return {
    start() {
      const stop = listen(window, "hashchange", resolve);
      resolve();
      return stop;
    },
    navigate(path) {
      const target = normalize(path);
      if (target === current()) return;
      window.location.hash = target;
    },
    current,
  };
}

function current() {
  return normalize(window.location.hash.replace(/^#/, ""));
}

function normalize(path) {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function compile(pattern) {
  const paramNames = [];
  const source = normalize(pattern)
    .replace(/[.+*?^$()[\]{}|\\]/g, "\\$&")
    .replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
  return { regex: new RegExp(`^${source}$`), paramNames };
}
