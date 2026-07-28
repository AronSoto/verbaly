#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createVerbalyMcp } from './server';

const { values } = parseArgs({ options: { root: { type: 'string' } } });

try {
  await createVerbalyMcp({ root: values.root }).connect(new StdioServerTransport());
  // stdout carries the protocol: any human-facing note goes to stderr
  console.error('[verbaly-mcp] ready (stdio)');
} catch (error) {
  console.error('[verbaly-mcp]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
