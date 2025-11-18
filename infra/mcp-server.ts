import { knowledgebase } from "./knowledgebase";

// Deploy the MCP server as a Lambda function with a function URL
export const mcpServer = new sst.aws.Function("McpServer", {
  handler: "mcp-server/lambda.handler",
  runtime: "nodejs22.x",
  timeout: "30 seconds",
  memory: "512 MB",
  url: {
    cors: {
      allowMethods: ["GET", "POST"],
      allowOrigins: ["*"],
      allowHeaders: ["*"],
    },
  },
  environment: {
    AWS_BEDROCK_KNOWLEDGE_BASE_ID: knowledgebase.id,
  },
  permissions: [
    {
      actions: ["bedrock:Retrieve", "bedrock:InvokeModel"],
      resources: ["*"],
    },
  ],
  nodejs: {
    install: ["express", "@aws-sdk/client-bedrock-agent-runtime"],
  },
});

// Output the function URL
export const mcpServerUrl = mcpServer.url;
