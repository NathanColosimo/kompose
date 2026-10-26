import { ORPCError } from "@orpc/client";
import type { ErrorMap, Schema as ORPCSchema } from "@orpc/contract";
import { Schema } from "effect";
// Types the `httpApiStatus` annotation on error classes.
import type {} from "effect/http-api";

/**
 * Fields every error has that are not sent as `data`: the tag is the code,
 * the message is sent as the message, and the cause stays on the server.
 */
const NON_DATA_FIELDS = ["_tag", "cause", "message"] as const;
type NonDataField = (typeof NON_DATA_FIELDS)[number];

/**
 * A `Schema.TaggedError` class the client can receive. Annotate it with
 * `httpApiStatus` to choose its HTTP status; unannotated errors are 500s.
 */
type ClientErrorClass = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
  readonly fields: Schema.Struct.Fields;
  readonly identifier: string;
  readonly Type: { readonly _tag: string };
  new (props: never): Error;
};

type DataFields<C extends ClientErrorClass> = Omit<C["fields"], NonDataField>;

/** The `data` the client receives for an error of class `C`. */
type ClientErrorData<C extends ClientErrorClass> = Schema.Struct<
  DataFields<C>
>["Encoded"];

interface ClientErrorMapItem<C extends ClientErrorClass> {
  readonly data: ORPCSchema<ClientErrorData<C>, ClientErrorData<C>>;
  readonly errorClass: C;
  readonly status: number;
  readonly toData: (error: unknown) => ClientErrorData<C>;
}

type ClientErrorMap<C extends readonly ClientErrorClass[]> = {
  [K in C[number] as K["Type"]["_tag"]]: ClientErrorMapItem<K>;
};

/**
 * The oRPC error map for `classes`, for a contract's `.errors()`. Each class's
 * tag becomes an error code whose `data` is typed from the class's fields.
 */
export function clientErrors<const C extends readonly ClientErrorClass[]>(
  ...classes: C
): ClientErrorMap<C> {
  return Object.fromEntries(
    classes.map((errorClass) => {
      const data = Schema.Struct(
        Object.fromEntries(
          Object.entries(errorClass.fields).filter(
            ([field]) => !NON_DATA_FIELDS.includes(field as NonDataField)
          )
        )
      ) as unknown as Schema.Codec<Record<string, unknown>>;
      const item: ClientErrorMapItem<ClientErrorClass> = {
        // Validates the data and describes it in the OpenAPI reference.
        data: Schema.toStandardJSONSchemaV1(
          Schema.toStandardSchemaV1(Schema.toEncoded(data))
        ),
        errorClass,
        status: Schema.resolveAnnotations(errorClass)?.httpApiStatus ?? 500,
        toData: Schema.encodeUnknownSync(data),
      };
      return [errorClass.identifier, item];
    })
  ) as ClientErrorMap<C>;
}

function clientErrorItem(
  errorMap: ErrorMap,
  code: string
): ClientErrorMapItem<ClientErrorClass> | undefined {
  const item = Object.hasOwn(errorMap, code) ? errorMap[code] : undefined;
  return item && "errorClass" in item
    ? (item as ClientErrorMapItem<ClientErrorClass>)
    : undefined;
}

/**
 * Converts `error` into the `ORPCError` its procedure declares in `errorMap`.
 * Errors the procedure doesn't declare are returned unchanged, and oRPC sends
 * them as a generic 500.
 */
export function toORPCError(errorMap: ErrorMap, error: unknown): unknown {
  if (!(error instanceof Error && "_tag" in error)) {
    return error;
  }
  const item = clientErrorItem(errorMap, String(error._tag));
  if (!(item && error instanceof item.errorClass)) {
    return error;
  }
  return new ORPCError(item.errorClass.identifier, {
    cause: error,
    data: item.toData(error),
    message: error.message,
  });
}

/** HTTP status for each client error code in `errorMap`. */
export function clientErrorStatuses(
  errorMap: ErrorMap
): Record<string, number> {
  const statuses: Record<string, number> = {};
  for (const code of Object.keys(errorMap)) {
    const item = clientErrorItem(errorMap, code);
    if (item) {
      statuses[code] = item.status;
    }
  }
  return statuses;
}
