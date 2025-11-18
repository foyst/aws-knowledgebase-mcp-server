import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type RetrieveCommandInput,
} from "@aws-sdk/client-bedrock-agent-runtime";

export const server = new McpServer({
  name: "aws-knowledge-base",
  version: "1.0.0",
});

// Define the RAGSource schema using Zod for type safety
const RAGSourceSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  snippet: z.string(),
  score: z.number(),
});

// Infer TypeScript type from Zod schema
type RAGSource = z.infer<typeof RAGSourceSchema>;

server.registerTool(
  "search_knowledge_base",
  {
    description:
      "Search knowledge base for any information that may be of use for the current task.",
    inputSchema: {
      query: z
        .string()
        .describe("The query to search the knowledge base with."),
    },
    outputSchema: {
      context: z
        .string()
        .describe("The retrieved context from the knowledge base."),
      isRagWorking: z
        .boolean()
        .describe("Indicates if RAG retrieval was successful."),
      ragSources: z
        .array(RAGSourceSchema)
        .describe("List of RAG sources used for retrieval."),
    },
  },
  async ({ query }) => {
    const results = await retrieveContext(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
      structuredContent: results,
    };
  }
);

if (!process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID) {
  console.error(
    "AWS_BEDROCK_KNOWLEDGE_BASE_ID is not set in environment variables."
  );
  process.exit(1);
}
if (!process.env.AWS_REGION) {
  console.error("AWS_REGION is not set in environment variables.");
  process.exit(1);
}

// Check for explicit credentials only when not in Lambda
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda) {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error("AWS_ACCESS_KEY_ID is not set in environment variables.");
    process.exit(1);
  }
  if (!process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("AWS_SECRET_ACCESS_KEY is not set in environment variables.");
    process.exit(1);
  }
  if (!process.env.AWS_SESSION_TOKEN) {
    console.error("AWS_SESSION_TOKEN is not set in environment variables.");
    process.exit(1);
  }
}

// AWS client initialization
// In Lambda, credentials are automatically provided via IAM role
const bedrockClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  ...(isLambda
    ? {}
    : {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        },
      }),
});

const knowledgeBaseId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;

async function retrieveContext(
  query: string,
  n: number = 3
): Promise<{
  context: string;
  isRagWorking: boolean;
  ragSources: RAGSource[];
}> {
  try {
    if (!knowledgeBaseId) {
      console.error("knowledgeBaseId is not provided");
      return {
        context: "",
        isRagWorking: false,
        ragSources: [],
      };
    }

    const input: RetrieveCommandInput = {
      knowledgeBaseId: knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: n },
      },
    };

    const command = new RetrieveCommand(input);
    const response = await bedrockClient.send(command);
    const rawResults = response?.retrievalResults || [];
    const ragSources: RAGSource[] = rawResults
      .filter((res) => res?.content?.text)
      .map((result, index) => {
        const uri = result?.location?.s3Location?.uri || "";
        const fileName = uri.split("/").pop() || `Source-${index}.txt`;
        return {
          id:
            (result.metadata?.["x-amz-bedrock-kb-chunk-id"] as string) ||
            `chunk-${index}`,
          fileName: fileName.replace(/_/g, " ").replace(".txt", ""),
          snippet: result.content?.text || "",
          score: (result.score as number) || 0,
        };
      })
      .slice(0, 3);

    const context = rawResults
      .filter(
        (res): res is { content: { text: string } } =>
          res?.content?.text !== undefined
      )
      .map((res) => res.content.text)
      .join("\n\n");

    return {
      context,
      isRagWorking: true,
      ragSources,
    };
  } catch (error) {
    console.error("RAG Error:", error);
    return { context: "", isRagWorking: false, ragSources: [] };
  }
}
