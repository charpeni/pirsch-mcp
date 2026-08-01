#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.ts";

void serveStdio(() => createServer());
console.error("Pirsch MCP server running on stdio");
