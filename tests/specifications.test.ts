import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  cloneDocument,
  diagnostic,
  documentMigrator,
  DocumentError,
  emptyDocument,
  validateDocument,
  type CircuitDocument as PublicCircuitDocument,
} from "../src/domain";

type JsonObject = Record<string, unknown>;

type EndpointRef = {
  kind: "terminal" | "junction";
  id: string;
};

type Terminal = {
  id: string;
};

type Component = {
  id: string;
  terminals: Terminal[];
};

type Wire = {
  id: string;
  start: EndpointRef;
  end: EndpointRef;
};

type Junction = {
  id: string;
};

type Annotation = {
  id: string;
  anchor: EndpointRef;
};

type CircuitDocument = {
  documentId: string;
  components: Component[];
  wires: Wire[];
  junctions: Junction[];
  annotations: Annotation[];
  referenceNode: EndpointRef | null;
};

type ExpectedFixtureResult = {
  probeVoltagesV: Record<string, number>;
  branchCurrentsA: Record<string, number>;
  componentVoltagesV: Record<string, number>;
  componentPowersW: Record<string, number>;
  compareWith?: string;
  equivalentResistance?: {
    port: {
      first: EndpointRef;
      second: EndpointRef;
    };
  };
};

type CircuitFixture = {
  id: string;
  document: CircuitDocument;
  expected: ExpectedFixtureResult;
};

type Requirement = {
  id: string;
  physics_rules: string[];
  fixtures: string[];
  docs: string[];
};

type RequirementsFile = {
  requirements: Requirement[];
};

type NamedRule = {
  id: string;
};

type PhysicsRulesFile = {
  rules: NamedRule[];
};

type ProductPrinciplesFile = {
  principles: NamedRule[];
};

const root = resolve(process.cwd());
const fixturesDirectory = join(root, "fixtures");
const invalidFixturesDirectory = join(root, "tests", "fixtures", "invalid");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function listJson(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(directory, name));
}

const canonicalFixturePaths = listJson(fixturesDirectory);
const canonicalFixtures = canonicalFixturePaths.map((path) => ({
  path,
  fixture: readJson<CircuitFixture>(path),
}));

const circuitSchema = readJson<JsonObject>(join(root, "schemas", "circuit-document.schema.json"));
const fixtureSchema = readJson<JsonObject>(join(root, "schemas", "fixture.schema.json"));
const diagnosticSchema = readJson<JsonObject>(join(root, "schemas", "diagnostic.schema.json"));
const requirementsSchema = readJson<JsonObject>(join(root, "requirements", "requirements.schema.json"));
const requirements = parseYaml(
  readFileSync(join(root, "requirements", "requirements.yaml"), "utf8"),
) as RequirementsFile;
const physicsRules = parseYaml(
  readFileSync(join(root, "requirements", "physics-rules.yaml"), "utf8"),
) as PhysicsRulesFile;
const productPrinciples = parseYaml(
  readFileSync(join(root, "requirements", "product-principles.yaml"), "utf8"),
) as ProductPrinciplesFile;

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(circuitSchema);
const validateFixture = ajv.compile(fixtureSchema);
const validateDiagnostic = ajv.compile(diagnosticSchema);
const validateRequirements = ajv.compile(requirementsSchema);

function formatSchemaErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(
    (error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`,
  );
}

function documentIntegrityErrors(document: CircuitDocument): string[] {
  const errors: string[] = [];
  const ids = new Map<string, string>();
  const terminalIds = new Set<string>();
  const junctionIds = new Set(document.junctions.map(({ id }) => id));

  const addId = (id: string, kind: string): void => {
    const existingKind = ids.get(id);
    if (existingKind !== undefined) {
      errors.push(`duplicate id ${id} (${existingKind}, ${kind})`);
      return;
    }
    ids.set(id, kind);
  };

  for (const component of document.components) {
    addId(component.id, "component");
    for (const terminal of component.terminals) {
      terminalIds.add(terminal.id);
      addId(terminal.id, "terminal");
    }
  }
  for (const junction of document.junctions) addId(junction.id, "junction");
  for (const wire of document.wires) addId(wire.id, "wire");
  for (const annotation of document.annotations) addId(annotation.id, "annotation");

  const checkEndpoint = (endpoint: EndpointRef, owner: string): void => {
    const known = endpoint.kind === "terminal" ? terminalIds.has(endpoint.id) : junctionIds.has(endpoint.id);
    if (!known) errors.push(`${owner} references unknown ${endpoint.kind} ${endpoint.id}`);
  };

  for (const wire of document.wires) {
    checkEndpoint(wire.start, `wire ${wire.id} start`);
    checkEndpoint(wire.end, `wire ${wire.id} end`);
  }
  for (const annotation of document.annotations) {
    checkEndpoint(annotation.anchor, `annotation ${annotation.id} anchor`);
  }
  if (document.referenceNode !== null) checkEndpoint(document.referenceNode, "referenceNode");

  return errors;
}

function fixtureReferenceErrors(fixture: CircuitFixture, fixtureIds: Set<string>): string[] {
  const errors: string[] = [];
  const componentIds = new Set(fixture.document.components.map(({ id }) => id));
  const terminalIds = new Set(
    fixture.document.components.flatMap(({ terminals }) => terminals.map(({ id }) => id)),
  );
  const junctionIds = new Set(fixture.document.junctions.map(({ id }) => id));
  const endpointIds = new Set([...terminalIds, ...junctionIds]);

  for (const id of Object.keys(fixture.expected.probeVoltagesV)) {
    if (!endpointIds.has(id)) errors.push(`probeVoltagesV references unknown endpoint ${id}`);
  }

  const componentResultMaps = [
    ["branchCurrentsA", fixture.expected.branchCurrentsA],
    ["componentVoltagesV", fixture.expected.componentVoltagesV],
    ["componentPowersW", fixture.expected.componentPowersW],
  ] as const;
  for (const [mapName, resultMap] of componentResultMaps) {
    for (const id of Object.keys(resultMap)) {
      if (!componentIds.has(id)) errors.push(`${mapName} references unknown component ${id}`);
    }
  }

  const port = fixture.expected.equivalentResistance?.port;
  if (port !== undefined) {
    for (const [name, endpoint] of [
      ["first", port.first],
      ["second", port.second],
    ] as const) {
      const known = endpoint.kind === "terminal" ? terminalIds.has(endpoint.id) : junctionIds.has(endpoint.id);
      if (!known) errors.push(`equivalentResistance.port.${name} references unknown endpoint ${endpoint.id}`);
    }
  }

  if (fixture.expected.compareWith !== undefined && !fixtureIds.has(fixture.expected.compareWith)) {
    errors.push(`compareWith references unknown fixture ${fixture.expected.compareWith}`);
  }
  return errors;
}

describe("canonical specification fixtures", () => {
  it.each([
    ["CircuitDocument", circuitSchema],
    ["fixture", fixtureSchema],
    ["diagnostic", diagnosticSchema],
    ["requirements", requirementsSchema],
  ])("uses a valid draft 2020-12 %s schema", (_name, schema) => {
    expect(ajv.validateSchema(schema), ajv.errorsText(ajv.errors)).toBe(true);
  });

  it.each(canonicalFixtures)("$fixture.id satisfies fixture and CircuitDocument schemas", ({ fixture }) => {
    expect(validateFixture({...fixture,document:documentMigrator.migrate(fixture.document)}), formatSchemaErrors(validateFixture).join("\n")).toBe(true);
  });

  it("uses unique fixture IDs that agree with their filenames", () => {
    const seen = new Set<string>();
    const errors: string[] = [];

    for (const { path, fixture } of canonicalFixtures) {
      if (seen.has(fixture.id)) errors.push(`duplicate fixture id ${fixture.id}`);
      seen.add(fixture.id);
      if (!basename(path).startsWith(`${fixture.id}-`)) {
        errors.push(`${basename(path)} does not start with ${fixture.id}-`);
      }
    }

    expect(errors).toEqual([]);
  });

  it.each(canonicalFixtures)("$fixture.id has unique document element IDs and valid endpoint references", ({ fixture }) => {
    expect(documentIntegrityErrors(fixture.document)).toEqual([]);
  });

  it("only references existing fixture, component, terminal, and junction IDs in expected results", () => {
    const fixtureIds = new Set(canonicalFixtures.map(({ fixture }) => fixture.id));
    const errors = canonicalFixtures.flatMap(({ fixture }) =>
      fixtureReferenceErrors(fixture, fixtureIds).map((error) => `${fixture.id}: ${error}`),
    );

    expect(errors).toEqual([]);
  });

  it.each(canonicalFixtures)("$fixture.id preserves its document through a JSON round trip", ({ fixture }) => {
    const restored = JSON.parse(JSON.stringify(fixture.document)) as CircuitDocument;
    expect(restored).toStrictEqual(fixture.document);
  });
});

describe("requirement and rule references", () => {
  it("validates requirements.yaml against its schema", () => {
    expect(
      validateRequirements(requirements),
      formatSchemaErrors(validateRequirements).join("\n"),
    ).toBe(true);
  });

  it.each([
    ["requirement", requirements.requirements],
    ["physics rule", physicsRules.rules],
    ["product principle", productPrinciples.principles],
  ] as const)("uses unique %s IDs", (_kind, entries) => {
    const ids = entries.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides the complete FIX-01 through FIX-10 baseline without duplicate IDs", () => {
    const actual = canonicalFixtures.map(({ fixture }) => fixture.id).sort();
    const expected = Array.from({ length: 10 }, (_unused, index) =>
      `FIX-${String(index + 1).padStart(2, "0")}`,
    );
    expect(actual).toEqual(expected);
  });

  it("resolves every requirement reference to an existing rule, fixture, and document", () => {
    const ruleIds = new Set(physicsRules.rules.map(({ id }) => id));
    const fixtureIds = new Set(canonicalFixtures.map(({ fixture }) => fixture.id));
    const errors: string[] = [];

    for (const requirement of requirements.requirements) {
      for (const ruleId of requirement.physics_rules) {
        if (!ruleIds.has(ruleId)) errors.push(`${requirement.id}: unknown physics rule ${ruleId}`);
      }
      for (const fixtureId of requirement.fixtures) {
        if (!fixtureIds.has(fixtureId)) errors.push(`${requirement.id}: unknown fixture ${fixtureId}`);
      }
      for (const documentPath of requirement.docs) {
        if (!existsSync(join(root, documentPath))) {
          errors.push(`${requirement.id}: missing document ${documentPath}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });
});

describe("public CircuitDocument contract", () => {
  it.each(canonicalFixtures)("accepts $fixture.id through the public domain validator", ({ fixture }) => {
    const result = validateDocument(fixture.document);
    expect(result).toEqual({ ok: true, document: {...fixture.document,version:2} });
  });

  it.each(canonicalFixtures)("clones $fixture.id without changing its JSON meaning", ({ fixture }) => {
    const validated = validateDocument(fixture.document);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const cloned = cloneDocument(validated.document);
    expect(cloned).toStrictEqual(validated.document);
    expect(cloned).not.toBe(validated.document);
  });

  it("creates an empty document accepted by both public and schema validators", () => {
    const document = emptyDocument("phase-zero");

    expect(validateDocument(document)).toEqual({ ok: true, document });
    expect(ajv.validate(circuitSchema, document), ajv.errorsText(ajv.errors)).toBe(true);
  });

  it("keeps the TypeScript contract aligned with optional schema fields", () => {
    const document: PublicCircuitDocument = {
      $schema: "https://example.invalid/edu-circuit/circuit-document.schema.json",
      format: "edu-circuit",
      version: 2,
      documentId: "contract-parity",
      title: "계약 일치",
      components: [
        {
          id: "R1",
          type: "resistor",
          label: "R1",
          position: { x: 10, y: 20 },
          rotation: 270,
          properties: { resistanceOhm: 1_000, editable: true, unit: "ohm" },
          terminals: [
            { id: "R1.a", role: "a", localPosition: { x: -10, y: 0 } },
            { id: "R1.b", role: "b", localPosition: { x: 10, y: 0 } },
          ],
        },
      ],
      wires: [],
      junctions: [{ id: "J1", position: { x: 0, y: 0 } }],
      annotations: [
        {
          id: "A1",
          kind: "note",
          anchor: { kind: "junction", id: "J1" },
          content: "메모",
          visibility: "always",
        },
      ],
      referenceNode: { kind: "terminal", id: "R1.b" },
      activity: {
        allowedCommands: ["SetValue"],
        revealSteps: [{ id: "step-1" }],
        resetSnapshotId: null,
        extensionField: "preserved",
      },
    };

    expect(ajv.validate(circuitSchema, document), ajv.errorsText(ajv.errors)).toBe(true);
    expect(validateDocument(document)).toEqual({ ok: true, document });
  });

  it("produces diagnostics that satisfy the public diagnostic schema", () => {
    const value = diagnostic("INVALID_REFERENCE", ["missing", "missing"]);

    expect(validateDiagnostic(value), formatSchemaErrors(validateDiagnostic).join("\n")).toBe(true);
    expect(value.affectedIds).toEqual(["missing"]);
  });

  it("migrates v1 by validation and cloning without mutating the source", () => {
    const fixture = canonicalFixtures[0].fixture;
    const source = fixture.document as PublicCircuitDocument;

    expect(documentMigrator.canMigrate(1)).toBe(true);
    expect(documentMigrator.canMigrate(2)).toBe(true);
    expect(documentMigrator.canMigrate(3)).toBe(false);
    const migrated = documentMigrator.migrate(source);
    expect(migrated).toStrictEqual({...source,version:2});
    expect(migrated).not.toBe(source);
  });

  it("rejects invalid input during migration with structured diagnostics", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "dangling-endpoint.json"));

    expect(() => documentMigrator.migrate(fixture.document)).toThrow(DocumentError);
    try {
      documentMigrator.migrate(fixture.document);
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      expect((error as DocumentError).diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "INVALID_REFERENCE" })]),
      );
    }
  });

  it("returns DUPLICATE_ID for IDs reused across element kinds", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "duplicate-document-id.json"));
    const result = validateDocument(fixture.document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ID", affectedIds: ["shared-id"] }),
      ]),
    );
  });

  it("returns INVALID_REFERENCE for a missing endpoint", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "dangling-endpoint.json"));
    const result = validateDocument(fixture.document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_REFERENCE", affectedIds: ["missing-terminal"] }),
      ]),
    );
  });

  it("returns INVALID_REFERENCE when an endpoint ID exists with a different kind", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "endpoint-kind-mismatch.json"));
    const result = validateDocument(fixture.document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_REFERENCE", affectedIds: ["R1.a"] }),
      ]),
    );
  });

  it("returns INVALID_DOCUMENT for a schema type mismatch", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "invalid-rotation.json"));
    const result = validateDocument(fixture.document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INVALID_DOCUMENT" })]),
    );
  });
});

describe("invalid specification fixtures", () => {
  it("rejects a document that violates the CircuitDocument schema", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "invalid-rotation.json"));

    expect(validateFixture(fixture)).toBe(false);
    expect(validateFixture.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: "/document/components/0/rotation",
          keyword: "enum",
        }),
      ]),
    );
  });

  it("rejects IDs duplicated across document element kinds", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "duplicate-document-id.json"));

    expect(validateFixture({...fixture,document:{...fixture.document,version:2}}), formatSchemaErrors(validateFixture).join("\n")).toBe(true);
    expect(documentIntegrityErrors(fixture.document)).toContain(
      "duplicate id shared-id (component, junction)",
    );
  });

  it("rejects a wire endpoint that refers to a missing terminal", () => {
    const fixture = readJson<CircuitFixture>(join(invalidFixturesDirectory, "dangling-endpoint.json"));

    expect(validateFixture({...fixture,document:{...fixture.document,version:2}}), formatSchemaErrors(validateFixture).join("\n")).toBe(true);
    expect(documentIntegrityErrors(fixture.document)).toContain(
      "wire W1 end references unknown terminal missing-terminal",
    );
  });
});
