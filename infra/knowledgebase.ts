import * as awsNative from "@pulumi/aws-native";
import * as pulumi from "@pulumi/pulumi";
import * as time from "@pulumiverse/time";

const encryptionSecurityPolicy = new aws.opensearch.ServerlessSecurityPolicy(
  "EncryptionSecurityPolicy",
  {
    name: "bedrock-kb-collection-encryption",
    type: "encryption",
    policy: JSON.stringify({
      Rules: [
        {
          Resource: ["collection/bedrock-kb-collection"],
          ResourceType: "collection",
        },
      ],
      AWSOwnedKey: true,
    }),
  }
);

const networkSecurityPolicy = new aws.opensearch.ServerlessSecurityPolicy(
  "NetworkSecurityPolicy",
  {
    name: "bedrock-kb-collection-network",
    type: "network",
    description: "Public access",
    policy: JSON.stringify([
      {
        Description:
          "Public access to collection and Dashboards endpoint for example collection",
        Rules: [
          {
            ResourceType: "collection",
            Resource: ["collection/bedrock-kb-collection"],
          },
          {
            ResourceType: "dashboard",
            Resource: ["collection/bedrock-kb-collection"],
          },
        ],
        AllowFromPublic: true,
      },
    ]),
  }
);

const collection = new aws.opensearch.ServerlessCollection(
  "vectorCollection",
  {
    name: "bedrock-kb-collection",
    type: "VECTORSEARCH",
  },
  { dependsOn: [encryptionSecurityPolicy, networkSecurityPolicy] }
);

const knowledgeBaseBucket = new sst.aws.Bucket("KnowledgeBaseBucket");

const bedrockS3Policy = new aws.iam.Policy("BedrockKbRolePolicy", {
  policy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:ListBucket"],
        Resource: [
          knowledgeBaseBucket.arn,
          $interpolate`${knowledgeBaseBucket.arn}/*`,
        ],
      },
    ],
  },
});

const bedrockAossPolicy = new aws.iam.Policy("BedrockAossPolicy", {
  policy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["aoss:APIAccessAll"],
        Resource: [collection.arn],
      },
    ],
  },
});

export const bedrockRole = new aws.iam.Role("BedrockKbRole", {
  assumeRolePolicy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Service: "bedrock.amazonaws.com",
        },
        Action: "sts:AssumeRole",
      },
    ],
  },
  inlinePolicies: [
    {
      name: "BedrockKbRoleAossPolicyAttachment",
      policy: bedrockAossPolicy.policy,
    },
    {
      name: "BedrockKbRoleS3PolicyAttachment",
      policy: bedrockS3Policy.policy,
    },
  ],
});

// This is needed because there's a race condition between when AWS
// says a role has been created and when Bedrock can actually use it.
const knowledgebaseRoleCreationDelay = new time.Sleep(
  "Wait60Seconds",
  { createDuration: "60s" },
  {
    dependsOn: [bedrockRole],
  }
);

const current = aws.getCallerIdentity({});
const dataAccessPolicy = new aws.opensearch.ServerlessAccessPolicy(
  "dataAccessPolicy",
  {
    name: "bedrock-kb-collection",
    type: "data",
    description: "read and write permissions",
    policy: pulumi
      .all([current, bedrockRole.arn])
      .apply(([identity, bedrockRoleArn]) =>
        JSON.stringify([
          {
            Rules: [
              {
                ResourceType: "index",
                Resource: ["index/bedrock-kb-collection/*"],
                Permission: ["aoss:*"],
              },
              {
                ResourceType: "collection",
                Resource: ["collection/bedrock-kb-collection"],
                Permission: ["aoss:*"],
              },
            ],
            Principal: [identity.arn, bedrockRoleArn],
          },
        ])
      ),
  },
  { dependsOn: [bedrockRole] }
);

const bedrockIndex = new awsNative.opensearchserverless.Index(
  "bedrockIndex",
  {
    collectionEndpoint: collection.collectionEndpoint,
    indexName: "bedrock-knowledge-base-default-index",
    settings: {
      index: {
        knn: true,
      },
    },
    mappings: {
      properties: {
        "bedrock-knowledge-base-default-vector": {
          type: "knn_vector",
          dimension: 1024, // Adjust based on your embedding model
          method: {
            name: "hnsw",
            engine: "faiss",
            spaceType: "l2",
            parameters: {
              efConstruction: 512,
              m: 16,
            },
          },
        },
        AMAZON_BEDROCK_METADATA: {
          type: "text",
          index: false,
        },
        AMAZON_BEDROCK_TEXT_CHUNK: {
          type: "text",
        },
      },
    },
  },
  {
    dependsOn: [
      // collection\
      dataAccessPolicy,
    ],
  }
);

const knowledgebase = new aws.bedrock.AgentKnowledgeBase(
  "AgentKnowledgeBase",
  {
    name: "example",
    roleArn: bedrockRole.arn,
    knowledgeBaseConfiguration: {
      vectorKnowledgeBaseConfiguration: {
        embeddingModelArn:
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
      },
      type: "VECTOR",
    },
    storageConfiguration: {
      type: "OPENSEARCH_SERVERLESS",
      opensearchServerlessConfiguration: {
        collectionArn: collection.arn,
        vectorIndexName: "bedrock-knowledge-base-default-index",
        fieldMapping: {
          vectorField: "bedrock-knowledge-base-default-vector",
          textField: "AMAZON_BEDROCK_TEXT_CHUNK",
          metadataField: "AMAZON_BEDROCK_METADATA",
        },
      },
    },
  },
  {
    dependsOn: [dataAccessPolicy, bedrockIndex, knowledgebaseRoleCreationDelay],
  }
);

new aws.bedrock.AgentDataSource("S3DataSource", {
  knowledgeBaseId: knowledgebase.id,
  name: "my-s3-data-source",
  dataSourceConfiguration: {
    type: "S3",
    s3Configuration: {
      bucketArn: knowledgeBaseBucket.arn,
    },
  },
});
