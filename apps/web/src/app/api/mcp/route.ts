import { handleMcpRequest } from "@kompose/api/mcp/handler";

// Stateless MCP: every JSON-RPC message is its own POST. GET and DELETE get 405.
export const POST = handleMcpRequest;
