// kompose-fm: answers the Electron local AI handler with Apple's on-device
// Foundation Models. Speaks newline-delimited JSON on stdin/stdout:
//
//   → {"id":1,"type":"availability"}
//   ← {"id":1,"availability":"available","contextWindow":8192}
//   → {"id":2,"type":"respond","instructions":"…","prompt":"…","schema":{…}}
//   ← {"id":2,"text":"{\"title\":\"…\"}"}
//   → {"id":2,"type":"cancel"}
//
// Failures reply {"id":…,"error":"…"}. A JSON schema is decoded straight into
// a GenerationSchema, so the model's output is constrained to it.

import Foundation
import FoundationModels

struct Request: Decodable {
  let id: Int
  let type: String
  let instructions: String?
  let prompt: String?
  let schema: JSONValue?
}

/// Any JSON value, so the schema can be rewritten before decoding.
enum JSONValue: Codable {
  case object([String: JSONValue]), array([JSONValue]), string(String)
  case number(Double), bool(Bool), null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
    else { self = .object(try container.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .object(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }
}

/// GenerationSchema's decoder needs every object to carry `x-order` (property
/// order, which is also generation order), `title`, and `additionalProperties`.
/// Plain JSON Schema usually has none of them, so they are filled in here.
func prepareSchema(_ value: JSONValue, title: String = "Response") -> JSONValue {
  switch value {
  case .object(var object):
    if case .object(let properties) = object["properties"] {
      var prepared: [String: JSONValue] = [:]
      for (key, property) in properties {
        prepared[key] = prepareSchema(property, title: key)
      }
      object["properties"] = .object(prepared)
      if object["x-order"] == nil {
        // JSONSerialization loses key order, so the client sends it explicitly
        // when it matters; otherwise keep a stable order.
        object["x-order"] = .array(properties.keys.sorted().map { .string($0) })
      }
      if object["title"] == nil { object["title"] = .string(title) }
      if object["additionalProperties"] == nil { object["additionalProperties"] = .bool(false) }
    }
    if let items = object["items"] { object["items"] = prepareSchema(items, title: title) }
    return .object(object)
  default:
    return value
  }
}

let output = FileHandle.standardOutput
let writeLock = NSLock()
func reply(_ fields: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: fields) else { return }
  writeLock.lock()
  output.write(data)
  output.write(Data("\n".utf8))
  writeLock.unlock()
}

func availability() -> String {
  switch SystemLanguageModel.default.availability {
  case .available: return "available"
  // The model is still downloading after Apple Intelligence was turned on.
  case .unavailable(.modelNotReady): return "downloading"
  default: return "unavailable"
  }
}

func respond(_ request: Request) async {
  do {
    let session = LanguageModelSession(instructions: request.instructions)
    let prompt = request.prompt ?? ""
    // `samplingMode:` replaces this in the macOS 27 SDK; CI builds with Xcode 26.
    let options = GenerationOptions(sampling: .greedy)
    if let schema = request.schema {
      let data = try JSONEncoder().encode(prepareSchema(schema))
      let generationSchema = try JSONDecoder().decode(GenerationSchema.self, from: data)
      let response = try await session.respond(
        to: prompt, schema: generationSchema, options: options)
      reply(["id": request.id, "text": response.content.jsonString])
    } else {
      let response = try await session.respond(to: prompt, options: options)
      reply(["id": request.id, "text": response.content])
    }
  } catch is CancellationError {
    reply(["id": request.id, "error": "aborted"])
  } catch {
    reply(["id": request.id, "error": String(describing: error)])
  }
}

actor Running {
  var tasks: [Int: Task<Void, Never>] = [:]
  func start(_ request: Request) {
    tasks[request.id] = Task {
      await respond(request)
      self.finish(request.id)
    }
  }
  func finish(_ id: Int) { tasks[id] = nil }
  func cancel(_ id: Int) { tasks[id]?.cancel() }
}

let running = Running()
// Loads the model so the first request skips the cold start.
LanguageModelSession().prewarm()

while let line = readLine(strippingNewline: true) {
  guard let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else {
    continue
  }
  switch request.type {
  case "availability":
    let contextWindow = SystemLanguageModel.default.contextSize
    reply(["id": request.id, "availability": availability(), "contextWindow": contextWindow])
  case "respond":
    await running.start(request)
  case "cancel":
    await running.cancel(request.id)
  default:
    reply(["id": request.id, "error": "unknown request type \(request.type)"])
  }
}
