import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { server } from "./index.js";

export const app = express();
const port = parseInt(process.env.PORT || "3000", 10);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

await server.connect(transport);

// Handle MCP requests
app.all("/mcp", async (req, res) => {
  await transport.handleRequest(req, res);
});

// Only run server if not in Lambda environment
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(port, () => {
    console.info(`AWS KB Retrieval Server running on HTTP at port ${port}`);
  });
}
