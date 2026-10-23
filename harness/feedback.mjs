// Feedback loop: a concrete observation becomes a proposal (design/proposals/), a recorded decision,
// and — only when accepted — a rule in design/rules.json with an adoption receipt. Proposals are
// never loaded as guidance. Only rules the static checker can execute are applied automatically;
// other lessons go through an ordinary reviewed edit of the owning contract.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import * as z from "zod";
import {
  decisionSchema,
  digest,
  json,
  loadHarness,
  localPath,
  skillName,
  sourceRuleSchema,
  validateRules,
} from "./core.mjs";

const text = z.string().trim().min(1);
const draftSchema = z.strictObject({
  id: skillName,
  observation: text,
  scope: text,
  evidence: z.array(text).min(1),
  target: z.literal("design/rules.json"),
  rule: sourceRuleSchema,
});
const proposalSchema = draftSchema.extend({
  baseRevision: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceDigests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  decision: z.union([z.strictObject({ status: z.literal("proposed") }), decisionSchema]),
});
const candidateDigest = ({ decision, ...candidate }) => digest(json(candidate));
const evidenceDigests = (root, paths) =>
  Object.fromEntries(paths.map((path) => [path, digest(readFileSync(localPath(root, path)))]));

export function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function listProposals(root) {
  const dir = resolve(root, "design/proposals");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => proposalSchema.parse(JSON.parse(readFileSync(resolve(dir, file), "utf8"))))
    .map(({ id, rule, decision }) => ({ id, ruleId: rule.id, status: decision.status }));
}

export function updateFeedback(root, action, args, cwd = root) {
  const proposals = resolve(root, "design/proposals");
  mkdirSync(proposals, { recursive: true });
  // Serializes local maintenance; distributed writers go through repository review.
  const lock = resolve(proposals, ".lock");
  const fd = openSync(lock, "wx");
  try {
    const harness = loadHarness(root);
    if (action === "list") return listProposals(root);
    if (action === "propose") {
      assert.equal(args.length, 1, "Usage: feedback propose DRAFT.json");
      const draft = draftSchema.parse(JSON.parse(readFileSync(resolve(cwd, args[0]), "utf8")));
      assert(
        !harness.rules.some((rule) => rule.id === draft.rule.id),
        `${draft.rule.id} already exists; review its authority instead`,
      );
      validateRules(
        { version: 1, rules: [...harness.rules, draft.rule] },
        new Set(harness.resources.map((r) => r.id).concat(harness.documents.map((d) => d.id))),
      );
      const path = resolve(proposals, `${draft.id}.json`);
      assert(!existsSync(path), `Proposal ${draft.id} already exists`);
      // Keep immutable copies so later fixes to the artifact cannot rewrite the evidence.
      const evidenceDir = resolve(proposals, draft.id);
      mkdirSync(evidenceDir);
      const evidence = draft.evidence.map((file) => {
        const copy = `design/proposals/${draft.id}/${basename(file)}`;
        copyFileSync(resolve(cwd, file), resolve(root, copy));
        return copy;
      });
      const proposal = {
        ...draft,
        evidence,
        baseRevision: harness.contractRevision,
        evidenceDigests: evidenceDigests(root, evidence),
        decision: { status: "proposed" },
      };
      atomicWrite(path, json(proposal));
      return proposal;
    }
    assert(["decide", "apply"].includes(action), "Usage: feedback list|propose|decide|apply");
    const proposalId = skillName.parse(args[0]);
    const path = resolve(proposals, `${proposalId}.json`);
    const proposal = proposalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    assert.equal(proposal.id, proposalId, "Proposal ID mismatch");
    const receipt = harness.adoptions.find((item) => item.proposalId === proposalId);
    if (action === "decide") {
      assert.equal(args.length, 4, "Usage: feedback decide ID accepted|rejected REVIEWER REASON");
      assert(!receipt, "Applied proposals cannot be re-decided");
      assert.equal(proposal.decision.status, "proposed", "Already decided; create a new proposal");
      assert.deepEqual(
        evidenceDigests(root, proposal.evidence),
        proposal.evidenceDigests,
        "Evidence changed; create a fresh proposal",
      );
      proposal.decision = decisionSchema.parse({
        status: args[1],
        reviewer: args[2],
        reason: args[3],
        reviewedDigest: candidateDigest(proposal),
      });
      atomicWrite(path, json(proposal));
      return proposal;
    }
    assert.equal(args.length, 1, "Usage: feedback apply ID");
    assert.equal(proposal.decision.status, "accepted", "Only accepted proposals can be applied");
    assert.equal(
      proposal.decision.reviewedDigest,
      candidateDigest(proposal),
      "The proposal changed after review; create a fresh proposal",
    );
    const proposalDigest = digest(json(proposal));
    if (receipt) {
      assert.equal(receipt.proposalDigest, proposalDigest, "Applied proposal has changed");
      return { status: "already-applied", receipt };
    }
    assert.equal(
      proposal.baseRevision,
      harness.contractRevision,
      "The design authority changed since the proposal; reassess and create a fresh proposal",
    );
    assert.deepEqual(
      evidenceDigests(root, proposal.evidence),
      proposal.evidenceDigests,
      "Evidence changed; create a fresh proposal",
    );
    const adoption = {
      proposalId,
      proposalDigest,
      ruleId: proposal.rule.id,
      decision: proposal.decision,
      appliedAt: new Date().toISOString(),
    };
    const rulesPath = resolve(root, "design/rules.json");
    const current = JSON.parse(readFileSync(rulesPath, "utf8"));
    const updated = {
      ...current,
      rules: [...current.rules, proposal.rule],
      adoptions: [...(current.adoptions ?? []), adoption],
    };
    validateRules(updated, new Set(harness.resources.map((r) => r.id)));
    // The rule and its receipt share one atomic write.
    atomicWrite(rulesPath, json(updated));
    return {
      status: "applied",
      receipt: adoption,
      nextAction:
        "Run pnpm design:catalog, restart the MCP server, and rerun design:resolve/check on a fresh task.",
    };
  } finally {
    closeSync(fd);
    rmSync(lock);
  }
}
