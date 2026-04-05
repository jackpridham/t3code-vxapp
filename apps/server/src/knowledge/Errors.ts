import { Schema } from "effect";

export class KnowledgeClientError extends Schema.TaggedErrorClass<KnowledgeClientError>()(
  "KnowledgeClientError",
  {
    message: Schema.String,
    statusCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect),
  },
) {}
