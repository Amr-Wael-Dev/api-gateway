import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Auth Service",
      version: "1.0.0",
      description: "Authentication, token management, and JWKS.",
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
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
  apis: ["./src/app.ts", "./src/routes/*.ts"],
  failOnErrors: true,
});
