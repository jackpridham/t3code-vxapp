import { Schema } from "effect";

export const TrimmedString = Schema.Trim;
export const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const RuntimeSessionId = makeEntityId("RuntimeSessionId");
export type RuntimeSessionId = typeof RuntimeSessionId.Type;

export const ConversationId = makeEntityId("ConversationId");
export type ConversationId = typeof ConversationId.Type;

export const TurnId = makeEntityId("TurnId");
export type TurnId = typeof TurnId.Type;

export const EventId = makeEntityId("EventId");
export type EventId = typeof EventId.Type;

export const RequestId = makeEntityId("RequestId");
export type RequestId = typeof RequestId.Type;

export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;

export const TenantId = makeEntityId("TenantId");
export type TenantId = typeof TenantId.Type;

export const UserId = makeEntityId("UserId");
export type UserId = typeof UserId.Type;
