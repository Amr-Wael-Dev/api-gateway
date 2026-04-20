import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Users Service",
      version: "1.0.0",
      description: "User profile management.",
    },
    components: {
      schemas: {
        ProblemDetail: {
          type: "object",
          required: ["type", "title", "status"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            correlationId: { type: "string" },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string", description: "Auth service user ID" },
            displayName: { type: "string" },
            bio: { type: "string" },
            avatarUrl: { type: "string" },
            role: {
              type: "string",
              enum: ["guest", "user", "moderator", "admin"],
            },
            isDeleted: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
  apis: ["./src/app.ts", "./src/routes/*.ts"],
  failOnErrors: true,
});
