#!/usr/bin/env node
// stdio MCP server over the same loader and checker as harness/cli.mjs. A process serves one
// validated snapshot; restart it after changing DESIGN.md, tokens.css, design/, or the Skills.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { loadHarness, readResource, resolveContext, searchDesign } from "./core.mjs";
import { checkSource, sourceInput } from "./source-check.mjs";

const harness = loadHarness();
const server = new McpServer(
  { name: "gdg-design", version: "0.1.0" },
  {
    instructions:
      "GDG Apps design system knowledge. Read gdg-design://design.harness first. Before building a screen, call resolve_design_context with its scenario and read the returned resources. Call check_source on TSX you write; it covers static rules only — run `pnpm design:check <scenario>` for browser and review rules. Mechanical success never approves a design.",
  },
);
for (const resource of harness.resources) {
  server.registerResource(
    resource.id,
    resource.uri,
    { title: resource.title, description: resource.description, mimeType: resource.mimeType },
    async () => ({ contents: [readResource(harness, resource.uri)] }),
  );
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema, annotations }, async (input) => {
    try {
      const result = run(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });
}

tool(
  "search_design",
  "Search design resource IDs, titles, and descriptions (all terms must match). Returns up to 20 resource descriptors with gdg-design:// URIs and a truncated flag.",
  { query: z.string().trim().min(1).max(200) },
  ({ query }) => searchDesign(harness, query),
);
tool(
  "resolve_design_context",
  "Resolve a scenario ID (for example scenario.profile-edit) to the DESIGN.md sections, component and pattern contracts, rules, and Agent Skills it needs, plus the contract revision. Unknown IDs are errors.",
  { scenarioId: z.string().min(1) },
  ({ scenarioId }) => resolveContext(harness, scenarioId),
);
tool(
  "check_source",
  "Run the static source rules (raw colors, forbidden imports, IconButton/RadioGroup names, ...) on one TSX/TS source string. filename only labels findings and selects the parser. With scenarioId, only rules in that scenario's scope run. Same checker and result shape as `pnpm design:check-source`.",
  sourceInput.shape,
  (input) => checkSource(harness, input),
);

await server.connect(new StdioServerTransport());
