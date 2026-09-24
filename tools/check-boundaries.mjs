import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "src");

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const coreModules = new Set([
  "domain",
  "connectivity",
  "simulation",
  "diagnostics",
  "wire-geometry",
  "activity",
  "feedback",
]);
const uiAndBrowserModules = new Set([
  "app",
  "editor",
  "measurement",
  "visualization",
  "potential-3d",
  "export",
  "persistence",
  "shared-ui",
  "feedback-local",
  "feedback-firebase",
]);
const uiAndBrowserPackages = ["react", "react-dom", "three", "lucide-react", "firebase"];

const importPattern =
  /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g;

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }
      return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function sourceModule(filePath) {
  const relativePath = path.relative(sourceRoot, filePath);
  const [moduleName] = relativePath.split(path.sep);
  return relativePath.includes(path.sep) ? moduleName : null;
}

function packageMatches(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function resolveInternalImport(importer, specifier) {
  if (specifier.startsWith("@/")) {
    return path.join(sourceRoot, specifier.slice(2));
  }
  if (specifier.startsWith("src/")) {
    return path.join(repositoryRoot, specifier);
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return null;
}

function describeInternalImport(importer, specifier, sourceModules) {
  const resolved = resolveInternalImport(importer, specifier);
  if (!resolved) {
    return null;
  }

  const relativeTarget = path.relative(sourceRoot, resolved);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    return null;
  }

  const segments = relativeTarget.split(path.sep);
  const moduleName = sourceModules.has(segments[0]) ? segments[0] : null;
  return {
    moduleName,
    pathWithinModule: moduleName ? segments.slice(1).join("/") : "",
  };
}

function isPublicIndexPath(pathWithinModule) {
  return (
    pathWithinModule === "" ||
    /^index(?:\.[cm]?[jt]sx?)?$/.test(pathWithinModule)
  );
}

function addEdge(graph, from, to) {
  if (!graph.has(from)) {
    graph.set(from, new Set());
  }
  graph.get(from).add(to);
}

function findCycle(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];

  function visit(moduleName) {
    if (active.has(moduleName)) {
      const cycleStart = stack.indexOf(moduleName);
      return [...stack.slice(cycleStart), moduleName];
    }
    if (visited.has(moduleName)) {
      return null;
    }

    visited.add(moduleName);
    active.add(moduleName);
    stack.push(moduleName);

    for (const dependency of graph.get(moduleName) ?? []) {
      const cycle = visit(dependency);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    active.delete(moduleName);
    return null;
  }

  for (const moduleName of graph.keys()) {
    const cycle = visit(moduleName);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

let files;
try {
  files = await collectSourceFiles(sourceRoot);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    console.error("Boundary check failed: src directory does not exist.");
    process.exitCode = 1;
  } else {
    throw error;
  }
}

if (files) {
  const violations = [];
  const dependencyGraph = new Map();
  const sourceModules = new Set(files.map(sourceModule).filter(Boolean));

  for (const filePath of files) {
    const importerModule = sourceModule(filePath);
    if (!importerModule) {
      continue;
    }
    dependencyGraph.set(importerModule, dependencyGraph.get(importerModule) ?? new Set());

    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      const line = source.slice(0, match.index).split("\n").length;
      const location = `${path.relative(repositoryRoot, filePath)}:${line}`;

      if (
        coreModules.has(importerModule) &&
        uiAndBrowserPackages.some((packageName) => packageMatches(specifier, packageName))
      ) {
        violations.push(`${location} core module imports UI package "${specifier}"`);
      }

      const internalImport = describeInternalImport(filePath, specifier, sourceModules);
      if (!internalImport?.moduleName || internalImport.moduleName === importerModule) {
        continue;
      }

      if (importerModule === "wire-geometry" && internalImport.moduleName !== "domain") {
        violations.push(`${location} wire-geometry must depend only on domain point types`);
      }

      addEdge(dependencyGraph, importerModule, internalImport.moduleName);

      if (!isPublicIndexPath(internalImport.pathWithinModule)) {
        violations.push(
          `${location} imports internal file "${specifier}"; import ${internalImport.moduleName}'s public index instead`,
        );
      }

      if (
        coreModules.has(importerModule) &&
        uiAndBrowserModules.has(internalImport.moduleName)
      ) {
        violations.push(
          `${location} core module imports UI/browser module "${internalImport.moduleName}"`,
        );
      }

      if (importerModule === "domain") {
        violations.push(
          `${location} domain imports feature module "${internalImport.moduleName}"`,
        );
      }
    }
  }

  const cycle = findCycle(dependencyGraph);
  if (cycle) {
    violations.push(`module dependency cycle: ${cycle.join(" -> ")}`);
  }

  if (violations.length > 0) {
    console.error("Module boundary violations:\n");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Module boundaries are valid (${files.length} source files checked).`);
  }
}
