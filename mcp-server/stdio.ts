import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./index.js";

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("AWS KB Retrieval Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
