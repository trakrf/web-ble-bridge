name: "Phase 1 MCP Server for BLE Bridge - Debugging & Analysis Tools"
description: |

## Purpose
Implement a minimal MCP (Model Context Protocol) server that exposes BLE bridge debugging capabilities with a circular log buffer, protocol-agnostic raw data transmission, and 5 essential tools for connection management and packet analysis.

## Core Principles
1. **Protocol Agnostic**: No device-specific interpretation - pure transport layer
2. **In-Memory Only**: No persistence, circular buffer of 10k entries
3. **MCP Standards**: Works with standard MCP clients (mcp-cli, MCP Tools, Claude Code)
4. **Safety First**: Refuse scanning while connected to prevent adapter conflicts
5. **Global Sequence**: Universal packet ordering with sequence IDs

---

## Goal
Integrate MCP server directly into the bridge server to create a unified, MCP-first architecture:
- Bridge server exposes WebSocket, MCP stdio, AND MCP HTTP/SSE protocols
- MCP supports both local (stdio) and network (HTTP) clients simultaneously
- Shared circular log buffer (configurable size, default 10,000 TX/RX packets)
- 5 debugging tools available via MCP protocol
- Per-client position tracking for "since: last" queries
- Raw hex data without interpretation
- Simple bearer token authentication for HTTP transport
- Version bump to 0.3.0 with documentation updates
- Future CLI will be built as MCP client (not part of this phase)
- Target: ~1200 LOC total (triple protocol support adds complexity)

## Why
- **Debugging**: Real-time visibility into BLE communication for trakrf-handheld testing
- **Integration**: Works with any MCP-compatible client (Claude Code, CLI tools)
- **Analysis**: Search and correlate TX/RX packets with hex patterns
- **Observability**: Connection state monitoring without modifying bridge core

## What
The bridge server with integrated MCP protocol support, exposing via MCP:
1. Recent communication logs with filtering (shared buffer)
2. Hex pattern search across packets
3. Connection state and activity monitoring
4. Bridge server status
5. BLE device scanning (with conflict protection)

The same bridge server process handles:
- WebSocket clients (port 8080)
- MCP stdio clients (local development)
- MCP HTTP/SSE clients (port 3000, network access from VMs)

### Success Criteria
- [ ] All 5 MCP tools working via stdio transport
- [ ] All 5 MCP tools working via HTTP transport
- [ ] Bearer token authentication for HTTP transport
- [ ] Cross-machine testing (VM → Mac/Pi)
- [ ] Circular buffer respects configured size (default 10k)
- [ ] Per-client position tracking for "last" queries
- [ ] Hex pattern search with TX/RX correlation
- [ ] Proper error handling for scan-while-connected
- [ ] Integration tests pass with mock data
- [ ] Version 0.3.0 published to npm
- [ ] MCP registry submission ready
- [ ] All documentation updated with network examples
- [ ] Cloud deployments continue to work (WebSocket only)

## All Needed Context

### Documentation & References
```yaml
# MUST READ - Include these in your context window
- url: https://github.com/modelcontextprotocol/typescript-sdk
  why: Official TypeScript SDK for creating MCP servers
  
- url: https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse
  why: HTTP/SSE transport documentation for network access
  
- url: https://github.com/modelcontextprotocol/servers/tree/main/src/memory
  why: Reference implementation for in-memory storage pattern
  
- url: https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
  why: Tool registration and error handling patterns
  
- url: https://github.com/modelcontextprotocol/typescript-sdk#http-transport
  why: HTTP transport implementation examples
  
- file: src/bridge-server.ts
  why: Understand WebSocket server structure and log streaming
  lines: 32-45, 188-223
  
- file: src/utils.ts
  why: formatHex function for data display consistency
  
- file: prp/ref/SEQUENCE-NUMBERING-DESIGN.md
  why: Global sequence numbering implementation pattern
  
- file: package.json
  why: Current dependencies and script patterns
```

### Current Codebase tree
```bash
/home/mike/web-ble-bridge/
├── src/
│   ├── index.ts           # ~20 lines - exports only
│   ├── bridge-server.ts   # WebSocket server with log streaming
│   ├── noble-transport.ts # Noble BLE wrapper
│   ├── mock-bluetooth.ts  # navigator.bluetooth mock
│   ├── ws-transport.ts    # WebSocket client
│   ├── utils.ts          # Shared utilities
│   └── start-server.ts   # CLI entry point
├── tests/
│   ├── integration/
│   └── unit/
├── package.json
├── tsconfig.json
└── README.md
```

### Desired Codebase tree with files to be added
```bash
/home/mike/web-ble-bridge/
├── src/
│   ├── bridge-server.ts  # MODIFY: Integrate MCP server (~450 lines total)
│   ├── mcp-tools.ts      # NEW: Tool definitions & handlers (~200 lines)
│   ├── log-buffer.ts     # NEW: Circular buffer implementation (~100 lines)
│   ├── start-server.ts   # MODIFY: Add MCP stdio transport
│   └── [existing files]
├── tests/
│   ├── unit/
│   │   └── log-buffer.test.ts    # NEW: Buffer tests
│   └── integration/
│       └── mcp-tools.test.ts      # NEW: MCP tools integration tests
├── docs/
│   ├── MCP-SERVER.md     # NEW: MCP server documentation
│   └── ARCHITECTURE.md   # UPDATE: Add MCP server section
├── CHANGELOG.md          # UPDATE: Version 0.3.0 entry
└── package.json          # UPDATE: Add MCP dependency, version 0.3.0
```

### Known Gotchas & Library Quirks
```typescript
// CRITICAL: Use pnpm exclusively - NEVER npm or npx
// CRITICAL: Node.js 24.x required for BLE compatibility
// CRITICAL: Noble async/await only - no callbacks except event handlers
// CRITICAL: MCP SDK requires Node.js v18.x or higher
// CRITICAL: WebSocket at port 8080 expects URL params for BLE config
// CRITICAL: Log streaming uses command=log-stream query param
// CRITICAL: formatHex from utils.ts for consistent hex display
// CRITICAL: BLE adapter conflicts if scanning while connected
// SECURITY: HTTP transport uses bearer token for basic auth
// NETWORK: Designed for local network use (VMs, containers, devices)
// CONFIG: LOG_BUFFER_SIZE env var (default 10000, min 100, max 1M)
// CONFIG: MCP_TOKEN env var optional (recommended for HTTP transport)
// CONFIG: MCP_PORT env var (default 3000) for HTTP transport
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/log-buffer.ts
interface LogEntry {
  id: number;              // Global sequence number
  timestamp: string;       // ISO timestamp
  direction: 'TX' | 'RX';  // Packet direction
  hex: string;             // Raw hex data (uppercase, space-separated)
  size: number;            // Byte count
}

class LogBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private sequenceCounter = 0;
  private clientPositions = new Map<string, number>(); // client_id -> last_seen_id
  
  constructor(maxSize?: number) {
    // Default 10k, configurable via env var or constructor
    this.maxSize = maxSize || parseInt(process.env.LOG_BUFFER_SIZE || '10000', 10);
    
    // Validate reasonable bounds (100 to 1M entries)
    if (this.maxSize < 100) this.maxSize = 100;
    if (this.maxSize > 1000000) this.maxSize = 1000000;
    
    console.log(`[LogBuffer] Initialized with max size: ${this.maxSize} entries`);
  }
  
  push(direction: 'TX' | 'RX', data: Uint8Array): void
  getLogsSince(since: string | number, limit: number): LogEntry[]
  searchPackets(hexPattern: string, limit: number): LogEntry[]
  getClientPosition(clientId: string): number
  updateClientPosition(clientId: string, lastSeenId: number): void
}

// src/mcp-server.ts
interface ConnectionState {
  connected: boolean;
  deviceName?: string;
  connectedAt?: string;
  lastActivity?: string;
  packetsTransmitted: number;
  packetsReceived: number;
}

// Tool input schemas using Zod
const GetLogsSchema = z.object({
  since: z.string().default('30s'),
  filter: z.string().optional(),
  limit: z.number().min(1).max(1000).default(100)
});
```

### List of tasks to be completed in order (17 total)

```yaml
Task 1: Create log buffer implementation
CREATE src/log-buffer.ts:
  - Implement circular buffer with 10k limit
  - Global sequence counter
  - Client position tracking Map
  - Time parsing for 'since' parameter (ISO, 'last', duration)
  - Hex pattern search with regex

Task 2: Create MCP tool definitions
CREATE src/mcp-tools.ts:
  - Define Zod schemas for all 5 tools
  - Create tool metadata objects
  - Export tool registration helper

Task 3: Create HTTP transport handler
CREATE src/mcp-http-transport.ts:
  - Implement HTTPServerTransport setup
  - Add bearer token authentication middleware
  - Configure CORS if needed
  - Handle SSE connections

Task 4: Integrate MCP into bridge server
MODIFY src/bridge-server.ts:
  - Add logBuffer instance to class
  - Initialize McpServer in constructor
  - Register all 5 MCP tools
  - Update TX/RX logging to use shared buffer
  - Add both stdio and HTTP transports
  - Add MCP server start/stop lifecycle

Task 5: Update server startup for MCP
MODIFY src/start-server.ts:
  - Add StdioServerTransport for local MCP
  - Add HTTPServerTransport for network MCP
  - Check for MCP_TOKEN env var
  - Handle both transports simultaneously
  - Update CLI to support --no-mcp flag

Task 6: Add unit tests for log buffer
CREATE tests/unit/log-buffer.test.ts:
  - Test circular buffer rotation
  - Test time parsing ('30s', '5m', 'last', ISO)
  - Test hex pattern search
  - Test client position tracking

Task 7: Add integration tests for MCP tools
CREATE tests/integration/mcp-tools.test.ts:
  - Test tool registration
  - Test tool calls with mock data
  - Test error handling scenarios
  - Test both stdio and HTTP transports

Task 8: Add HTTP transport tests
CREATE tests/integration/mcp-http.test.ts:
  - Test bearer token authentication
  - Test cross-origin requests
  - Test SSE streaming
  - Test network error handling

Task 9: Update package.json and build
MODIFY package.json:
  - Add "@modelcontextprotocol/sdk" dependency
  - Update version to 0.3.0
  - Update start script for MCP support

Task 10: Create MCP server documentation
CREATE docs/MCP-SERVER.md:
  - Installation instructions
  - Tool descriptions and examples
  - Claude Code configuration (both local and network)
  - mcp-cli usage examples
  - Environment variables (LOG_BUFFER_SIZE, MCP_TOKEN, MCP_PORT)
  - Network setup guide for VM → Mac/Pi

Task 11: Update main README
MODIFY README.md:
  - Add MCP Server section after Quick Start
  - Document triple-protocol architecture
  - Add MCP tools overview
  - Include Claude Code setup examples (local + network)
  - Add debugging with MCP section

Task 12: Update API documentation
MODIFY docs/API.md:
  - Add MCP Tools API section
  - Document all 5 tool schemas
  - Include request/response examples
  - Add HTTP transport authentication
  - Add error codes documentation

Task 13: Update migration guide
MODIFY docs/MIGRATION.md:
  - Add "Migrating to v0.3.0" section
  - Note: No breaking changes for WebSocket
  - Benefits of MCP integration
  - Example: Moving from console logs to MCP

Task 14: Update Claude.md instructions
MODIFY CLAUDE.md:
  - Add MCP tools availability note
  - Document how to use MCP for debugging
  - Update testing approach to use tools

Task 15: Update architecture documentation
MODIFY docs/ARCHITECTURE.md:
  - Add MCP Server section
  - Update system diagram with HTTP transport
  - Document unified architecture
  - Add sequence diagrams for MCP flow

Task 16: Create deployment documentation
CREATE docs/DEPLOYMENT.md:
  - MCP limitations in cloud environments
  - Docker considerations
  - Security best practices for HTTP transport
  - Environment variable configuration
  - TTY detection and --no-mcp flag

Task 17: Update changelog
MODIFY CHANGELOG.md:
  - Add version 0.3.0 section
  - List new MCP server features
  - Document breaking changes (none)
  - Note configuration options
```

### Per task pseudocode

```typescript
// Task 1: Log Buffer Implementation
class LogBuffer {
  private parseSince(since: string, clientId?: string): number {
    // Handle 'last' - return client's last position
    if (since === 'last' && clientId) {
      return this.clientPositions.get(clientId) || 0;
    }
    
    // Handle duration strings: '30s', '5m', '1h'
    const durationMatch = since.match(/^(\d+)([smh])$/);
    if (durationMatch) {
      const [, num, unit] = durationMatch;
      const multipliers = { s: 1000, m: 60000, h: 3600000 };
      const cutoffTime = Date.now() - (parseInt(num) * multipliers[unit]);
      // Find first entry after cutoff
      return this.buffer.findIndex(e => new Date(e.timestamp).getTime() > cutoffTime);
    }
    
    // Handle ISO timestamp
    try {
      const cutoffTime = new Date(since).getTime();
      return this.buffer.findIndex(e => new Date(e.timestamp).getTime() > cutoffTime);
    } catch {
      return 0; // Default to beginning
    }
  }
}

// Task 3: HTTP Transport Handler
import { HTTPServerTransport } from '@modelcontextprotocol/sdk/transport/http';

export function createHttpTransport(token?: string): HTTPServerTransport {
  return new HTTPServerTransport({
    port: parseInt(process.env.MCP_PORT || '3000'),
    path: '/mcp',
    
    // Optional authentication for local network
    authHandler: token ? (req) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${token}`) {
        return { authenticated: false };
      }
      return { authenticated: true };
    } : undefined,
    
    // Permissive CORS for local network usage
    corsOptions: {
      origin: '*', // Allow all origins on local network
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }
  });
}

// Task 4: Integrate MCP into BridgeServer
class BridgeServer {
  private logBuffer: LogBuffer;
  private mcpServer: McpServer;
  private httpTransport?: HTTPServerTransport;
  
  constructor(logLevel: LogLevel = 'debug') {
    this.logLevel = logLevel;
    this.logBuffer = new LogBuffer();
    
    // Initialize MCP server
    this.mcpServer = new McpServer({
      name: '@trakrf/web-ble-bridge',
      version: '0.3.0'
    });
    
    // Register all MCP tools
    registerMcpTools(this.mcpServer, this);
  }
  
  // Update existing methods to use shared buffer
  private async handleBleData(direction: 'TX' | 'RX', data: Uint8Array) {
    // Add to shared log buffer
    this.logBuffer.push(direction, data);
    
    // Existing console.log for backward compatibility
    if (this.logLevel === 'debug') {
      console.log(`[${direction}] ${formatHex(data)}`);
    }
  }
  
  // MCP tool handler for scan_devices
  async scanDevices(): Promise<DeviceInfo[]> {
    // CRITICAL: Check connection state first
    if (this.transport?.getState() === 'connected') {
      throw new Error('Cannot scan while connected to a device. Please disconnect first.');
    }
    
    // Use existing transport or create temporary one
    const scanTransport = this.transport || new NobleTransport(this.logLevel);
    const devices = await scanTransport.performQuickScan(5000);
    
    return devices.map(d => ({
      id: d.id,
      name: d.name || 'Unknown',
      rssi: d.rssi
    }));
  }
}
```

### Integration Points
```yaml
BRIDGE_SERVER:
  - Single process serves three protocols
  - WebSocket: ws://[host]:8080 (existing clients)
  - MCP stdio: Local development
  - MCP HTTP: http://[host]:3000/mcp (network clients)
  - Shared log buffer between all protocols
  
START_SCRIPT:
  - Default: All protocols enabled
  - --no-mcp flag: WebSocket only (for cloud/Docker)
  - Auto-detect: Disable MCP if no TTY (cloud/Docker)
  - Environment: WS_PORT, LOG_LEVEL, LOG_BUFFER_SIZE, MCP_PORT, MCP_TOKEN
  
NETWORK_ACCESS:
  - VMs: http://macbook.local:3000/mcp
  - Containers: http://host.docker.internal:3000/mcp
  - Mobile devices: http://192.168.1.x:3000/mcp
  
PACKAGE.JSON:
  - script: "start": "node dist/start-server.js"
  - bin: "web-ble-bridge": "./dist/start-server.js"
  
MCP_REGISTRATION:
  - Name: "@trakrf/web-ble-bridge"
  - Version: "0.3.0"
  - Tools: 5 (get_logs, search_packets, get_connection_state, status, scan_devices)
```

## Validation Loop

### Level 1: Syntax & Style
```bash
# Run these FIRST - fix any errors before proceeding
pnpm run lint              # ESLint with auto-fix
pnpm run typecheck         # TypeScript type checking

# Expected: No errors. If errors, READ the error and fix.
```

### Level 2: Unit Tests
```typescript
// tests/unit/log-buffer.test.ts
describe('LogBuffer', () => {
  it('should maintain max 10k entries by default', () => {
    const buffer = new LogBuffer();
    for (let i = 0; i < 11000; i++) {
      buffer.push('TX', new Uint8Array([i & 0xFF]));
    }
    expect(buffer.getLogsSince('0', 20000).length).toBe(10000);
  });
  
  it('should respect custom buffer size', () => {
    const buffer = new LogBuffer(5000);
    for (let i = 0; i < 6000; i++) {
      buffer.push('TX', new Uint8Array([i & 0xFF]));
    }
    expect(buffer.getLogsSince('0', 10000).length).toBe(5000);
  });
  
  it('should respect LOG_BUFFER_SIZE env var', () => {
    process.env.LOG_BUFFER_SIZE = '2000';
    const buffer = new LogBuffer();
    delete process.env.LOG_BUFFER_SIZE;
    
    for (let i = 0; i < 3000; i++) {
      buffer.push('TX', new Uint8Array([i & 0xFF]));
    }
    expect(buffer.getLogsSince('0', 5000).length).toBe(2000);
  });
  
  it('should parse duration strings correctly', () => {
    const buffer = new LogBuffer();
    const now = Date.now();
    // Add entries at different times
    // Test '30s', '5m', '1h' parsing
  });
  
  it('should track client positions', () => {
    const buffer = new LogBuffer();
    buffer.updateClientPosition('client1', 100);
    const logs = buffer.getLogsSince('last', 10, 'client1');
    // Verify returns entries after position 100
  });
});
```

```bash
# Run and iterate until passing:
pnpm run test log-buffer.test.ts
```

### Level 3: Integration Test
```bash
# Build the project
pnpm run build

# Start the unified server (WebSocket + MCP)
pnpm run start

# In another terminal, test MCP tools
mcp call get_logs node dist/start-server.js
mcp call search_packets --params '{"hex_pattern":"A7B3"}' node dist/start-server.js
mcp call get_connection_state node dist/start-server.js

# Or use interactive shell
mcp shell node dist/start-server.js
> get_logs since=1m
> status

# Expected: Valid JSON responses
```

### Level 4: Manual MCP Client Test
```bash
# Configure Claude Code settings.json
{
  "mcpServers": {
    "web-ble-bridge": {
      "command": "node",
      "args": ["/path/to/dist/start-server.js"],
      "env": {
        "WS_PORT": "8080",
        "LOG_LEVEL": "debug"
      }
    }
  }
}

# Then verify tools appear in Claude Code
# Tools should be available for debugging BLE communication
```

### Documentation Examples

```markdown
# README.md - MCP Server Section
## MCP Server Integration

web-ble-bridge now includes an integrated MCP (Model Context Protocol) server, 
enabling powerful debugging capabilities through standardized tools.

> ⚠️ **Security Note**: The MCP HTTP transport is designed for local network 
> use only. Do not expose port 3000 to the public internet as authentication 
> is minimal.

### Available MCP Tools

1. **get_logs** - Retrieve recent BLE communication logs
2. **search_packets** - Search for hex patterns in packets
3. **get_connection_state** - Monitor connection status
4. **status** - Get bridge server status
5. **scan_devices** - Scan for nearby BLE devices

### Using with Claude Code

For local development (same machine):
\`\`\`json
{
  "mcpServers": {
    "web-ble-bridge": {
      "command": "node",
      "args": ["/path/to/node_modules/@trakrf/web-ble-bridge/dist/start-server.js"]
    }
  }
}
\`\`\`

For network access (VM → Mac/Pi):
\`\`\`json
{
  "mcpServers": {
    "web-ble-bridge": {
      "transport": "http",
      "url": "http://macbook.local:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-optional-token"
      }
    }
  }
}
\`\`\`

# docs/API.md - MCP Tools Section
## MCP Tools API

### get_logs

Retrieve recent BLE communication logs with filtering options.

**Schema:**
\`\`\`typescript
{
  since?: string;    // ISO timestamp, 'last', or duration ('30s', '5m', '1h')
  filter?: string;   // Filter by 'TX', 'RX', or hex pattern
  limit?: number;    // Max entries (default: 100, max: 1000)
}
\`\`\`

**Example Response:**
\`\`\`json
{
  "logs": [{
    "id": 1234,
    "timestamp": "2024-01-15T10:23:45.123Z",
    "direction": "TX",
    "hex": "A7 B3 01 00",
    "size": 4
  }],
  "count": 1,
  "truncated": false
}
\`\`\`

# docs/DEPLOYMENT.md - New file
## Deployment Guide

### ⚠️ SECURITY WARNING

**DO NOT EXPOSE TO PUBLIC INTERNET**

The MCP HTTP transport has minimal authentication (optional bearer token) 
designed for local network use only. Exposing this service to the internet
would allow anyone to:
- Read all BLE communication logs
- Scan for nearby BLE devices
- Access device connection states

This tool is designed for trusted local networks only (VMs, containers, 
development devices on the same network).

### MCP Limitations

MCP features are designed for local development and debugging. They are 
**not available** in typical cloud deployments because:

- MCP uses stdio (standard input/output) for communication
- Cloud platforms typically only expose HTTP/WebSocket ports
- No TTY available in most cloud/container environments

### Running Modes

\`\`\`bash
# Full functionality with MCP (local development)
pnpm start

# WebSocket only (for cloud/Docker deployments)
pnpm start --no-mcp

# Auto-detection: MCP disabled if no TTY detected
\`\`\`

### Docker Deployment

When using Docker, MCP is automatically disabled unless you specifically
map stdin/stdout:

\`\`\`dockerfile
# Default: WebSocket only
CMD ["node", "dist/start-server.js"]

# Force WebSocket only
CMD ["node", "dist/start-server.js", "--no-mcp"]

# Enable MCP in Docker (advanced users only):
# docker run -it --init your-image
\`\`\`

### Environment Variables

\`\`\`bash
# Core configuration
WS_PORT=8080              # WebSocket server port
LOG_LEVEL=debug           # Logging verbosity
LOG_BUFFER_SIZE=50000     # Circular buffer size

# MCP HTTP configuration
MCP_PORT=3000             # MCP HTTP port (default: 3000)
MCP_TOKEN=secret123       # Optional bearer token for HTTP auth

# Running without authentication (local network only!)
pnpm start

# Running with authentication
MCP_TOKEN=secret123 pnpm start
\`\`\`
```

## Final Validation Checklist
- [ ] All tests pass: `pnpm run test`
- [ ] No linting errors: `pnpm run lint`
- [ ] No type errors: `pnpm run typecheck`
- [ ] Build succeeds: `pnpm run build`
- [ ] MCP tools work via stdio transport
- [ ] MCP tools work via HTTP transport
- [ ] Cross-machine access works (VM → Mac/Pi)
- [ ] Optional auth token works when set
- [ ] --no-mcp flag disables MCP properly
- [ ] Auto-detects non-TTY environments
- [ ] Circular buffer respects configured size
- [ ] Client position tracking works
- [ ] Scan-while-connected returns proper error
- [ ] Version updated to 0.3.0
- [ ] All documentation updated (8 files)
- [ ] Security warnings prominently displayed

---

## Anti-Patterns to Avoid
- ❌ Don't interpret packet data - stay protocol-agnostic
- ❌ Don't persist logs to disk - memory only
- ❌ Don't allow scanning while connected
- ❌ Don't use npm/npx - always use pnpm
- ❌ Don't mix callbacks and promises in Noble
- ❌ Don't hardcode WebSocket URLs - use config
- ❌ Don't exceed configured buffer size (LOG_BUFFER_SIZE)
- ❌ Don't forget client position tracking

## Timeline Estimate
- Implementation: 3 hours (added HTTP transport)
- Testing: 1.5 hours (cross-machine testing)
- Documentation: 1 hour (8 files to update)
- Total: ~5.5 hours

## Confidence Score: 9/10
High confidence due to:
- Clear requirements and examples
- Existing WebSocket log streaming
- Well-documented MCP SDK with HTTP examples
- Simple in-memory storage pattern
- Reference implementations available
- Local network focus simplifies security