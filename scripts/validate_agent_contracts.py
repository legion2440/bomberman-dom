#!/usr/bin/env python3
"""Validate repository-local agent navigation contracts without third-party packages."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agent"
INDEX_PATH = AGENT / "module-index.json"
GRAPH_PATH = AGENT / "dependency-graph.json"
MODULES_DIR = AGENT / "modules"

VALID_MODULE_STATUS = {"planned", "implemented", "deprecated"}
VALID_LIFECYCLE = {"planned", "implemented", "deprecated"}
VALID_PROVENANCE = {"authored", "generated"}

errors: list[str] = []
warnings: list[str] = []


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
        return None


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def validate_sizes() -> None:
    if INDEX_PATH.exists() and INDEX_PATH.stat().st_size > 12 * 1024:
        warnings.append("agent/module-index.json exceeds 12 KB navigation warning budget")
    for path in MODULES_DIR.glob("*.json"):
        if path.stat().st_size > 10 * 1024:
            warnings.append(f"{path.relative_to(ROOT)} exceeds 10 KB navigation warning budget")


def validate_manifest_shape(path: Path, manifest: dict) -> None:
    required = {"schema_version", "module_id", "purpose", "paths", "contracts", "validators", "tests", "runtime_evidence"}
    require(required <= manifest.keys(), f"{path.relative_to(ROOT)}: missing required fields")
    require(manifest.get("schema_version") == 1, f"{path.relative_to(ROOT)}: schema_version must be 1")
    require(isinstance(manifest.get("paths"), list), f"{path.relative_to(ROOT)}: paths must be a list")

    for item in manifest.get("paths", []):
        rel = item.get("path")
        lifecycle = item.get("lifecycle")
        provenance = item.get("provenance")
        require(isinstance(rel, str) and bool(rel), f"{path.relative_to(ROOT)}: path entry requires path")
        require(lifecycle in VALID_LIFECYCLE, f"{path.relative_to(ROOT)}: invalid lifecycle for {rel}")
        require(provenance in VALID_PROVENANCE, f"{path.relative_to(ROOT)}: invalid provenance for {rel}")
        if provenance == "generated":
            require(bool(item.get("generator")), f"{path.relative_to(ROOT)}: generated {rel} requires generator")
            require(bool(item.get("check")), f"{path.relative_to(ROOT)}: generated {rel} requires check")
        if lifecycle == "deprecated":
            require(isinstance(item.get("legacy_consumers"), list), f"{path.relative_to(ROOT)}: deprecated {rel} requires legacy_consumers")


def check_path_contract(item: dict, owner: str) -> None:
    rel = item["path"]
    path = ROOT / rel
    lifecycle = item["lifecycle"]
    provenance = item["provenance"]

    if lifecycle == "planned":
        require(not path.exists(), f"{owner}: planned path exists: {rel}")
        return

    require(path.exists(), f"{owner}: {lifecycle} path missing: {rel}")
    if provenance == "generated" and path.exists():
        generator = ROOT / item["generator"]
        require(generator.exists(), f"{owner}: generator missing for {rel}: {item['generator']}")
        if generator.exists():
            result = subprocess.run(item["check"], shell=True, cwd=ROOT)
            require(result.returncode == 0, f"{owner}: generated check failed for {rel}: {item['check']}")


def main() -> int:
    for schema in (AGENT / "schemas").glob("*.json"):
        load(schema)

    index = load(INDEX_PATH)
    graph = load(GRAPH_PATH)
    if not isinstance(index, dict) or not isinstance(graph, dict):
        return finish()

    modules = index.get("modules", {})
    require(index.get("schema_version") == 1, "agent/module-index.json: schema_version must be 1")
    require(isinstance(modules, dict), "agent/module-index.json: modules must be an object")
    known = set(modules)

    manifests_on_disk = {path.stem: path for path in MODULES_DIR.glob("*.json")}
    require(set(manifests_on_disk) == known, "module index and agent/modules/*.json must be bidirectionally identical")

    loaded_manifests: dict[str, dict] = {}
    for module_id, meta in modules.items():
        status = meta.get("status")
        require(status in VALID_MODULE_STATUS, f"{module_id}: invalid module status {status!r}")
        for dep in meta.get("dependencies", []):
            require(dep in known, f"{module_id}: unknown dependency {dep!r}")

        manifest_rel = meta.get("manifest")
        require(manifest_rel == f"agent/modules/{module_id}.json", f"{module_id}: manifest must use canonical location")
        manifest_path = ROOT / str(manifest_rel)
        require(manifest_path.exists(), f"{module_id}: manifest missing: {manifest_rel}")

        if status == "implemented":
            for rel in meta.get("roots", []):
                require((ROOT / rel).exists(), f"{module_id}: implemented root missing: {rel}")
            for rel in meta.get("entrypoints", []):
                require((ROOT / rel).exists(), f"{module_id}: implemented entrypoint missing: {rel}")

        manifest = load(manifest_path) if manifest_path.exists() else None
        if isinstance(manifest, dict):
            validate_manifest_shape(manifest_path, manifest)
            require(manifest.get("module_id") == module_id, f"{module_id}: manifest module_id mismatch")
            loaded_manifests[module_id] = manifest

    edges = graph.get("edges", [])
    require(graph.get("schema_version") == 1, "agent/dependency-graph.json: schema_version must be 1")
    require(isinstance(edges, list), "agent/dependency-graph.json: edges must be a list")
    edge_set = set()
    for edge in edges:
        require(isinstance(edge, list) and len(edge) == 2, f"invalid dependency edge: {edge!r}")
        if isinstance(edge, list) and len(edge) == 2:
            src, dst = edge
            require(src in known and dst in known, f"unknown module in dependency edge: {edge!r}")
            edge_set.add((src, dst))

    declared_edges = {(src, dst) for src, meta in modules.items() for dst in meta.get("dependencies", [])}
    require(edge_set == declared_edges, "dependency graph must match module-index dependency declarations")

    for module_id, manifest in loaded_manifests.items():
        for item in manifest.get("paths", []):
            check_path_contract(item, module_id)

    validate_sizes()
    return finish()


def finish() -> int:
    for warning in warnings:
        print(f"[WARN] {warning}")
    if errors:
        for error in errors:
            print(f"[ERROR] {error}")
        print(f"[FAIL] agent contracts: {len(errors)} issue(s)")
        return 1
    print("[OK] agent contracts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
